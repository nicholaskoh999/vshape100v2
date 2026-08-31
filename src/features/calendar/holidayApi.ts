/**
 * Holiday Mode client.
 *
 * D1 is the durable source of truth. Nothing is mirrored into browser storage,
 * and the session travels in the existing HttpOnly cookie, which React can
 * never see. The account is never part of any payload.
 */

import type { HolidayRecord } from '@shared/holiday'
import { isLocalDate } from '@shared/localDate'

export type { HolidayRecord }

export class HolidayApiError extends Error {
  status: number
  /** The record a 409 clashed with, when the server named one. */
  conflict: HolidayRecord | null

  constructor(message: string, status: number, conflict: HolidayRecord | null = null) {
    super(message)
    this.name = 'HolidayApiError'
    this.status = status
    this.conflict = conflict
  }
}

const BASE = '/api/holidays'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' }

/** Status used when the server answered, but not with a Holiday we can trust. */
export const MALFORMED_HOLIDAY_STATUS = 502

/**
 * One record, or null when ANY required field is missing or the wrong shape.
 *
 * Deliberately strict. Two of these fields decide things a default must never
 * decide for the user:
 *
 *   `source`     grants or withholds permission to rename, move and delete.
 *                Defaulting it to "custom" would hand the editor control of a
 *                canonical company date.
 *   `trainingOn` decides whether the day is a scheduled training day at all.
 *                Defaulting it to false would silently discard an explicit
 *                Training On and could turn a trained day into a missed one.
 *
 * Neither is guessed. Nothing here is inferred from absence.
 */
function parseRecord(raw: unknown): HolidayRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>

  if (typeof row.id !== 'string' || row.id.length === 0) return null
  if (!isLocalDate(row.startDate) || !isLocalDate(row.endDate)) return null
  if (row.startDate > row.endDate) return null
  if (typeof row.name !== 'string') return null
  // Exactly one of the two known sources. An unknown value is not "custom".
  if (row.source !== 'company' && row.source !== 'custom') return null
  if (typeof row.trainingOn !== 'boolean') return null
  if (typeof row.createdAt !== 'number' || typeof row.updatedAt !== 'number') return null

  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    name: row.name,
    source: row.source,
    trainingOn: row.trainingOn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * The record a 409 names, read leniently.
 *
 * Deliberately NOT strict: the server documents that the blocking range may
 * already be gone by the time it is described. The refusal still stands, so an
 * unreadable description degrades to "an existing Holiday" rather than turning
 * a correct refusal into an error.
 */
function parseConflict(raw: unknown): HolidayRecord | null {
  return parseRecord(raw)
}

async function ensureOk(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) return body

  // A 409 carries the range it clashed with, so the editor can say which one.
  throw new HolidayApiError(
    `Holiday request failed (${response.status})`,
    response.status,
    parseConflict(body.conflict),
  )
}

/** Every Holiday intersecting an inclusive local-date span. */
export async function fetchHolidays(
  span: { from: string; to: string },
  signal?: AbortSignal,
): Promise<HolidayRecord[]> {
  const query = new URLSearchParams({ from: span.from, to: span.to })
  const body = await ensureOk(
    await fetch(`${BASE}?${query.toString()}`, { ...REQUEST_INIT, signal }),
  )
  // Fail closed. A malformed row is NOT dropped from the list: doing so would
  // turn "we cannot read this Holiday" into "there is no Holiday here", and a
  // resolved empty span is exactly what makes Today claim Home, the Calendar
  // become actionable, and Achievements judge the day. The whole read fails
  // instead, and flows through the hook's existing error state.
  if (!Array.isArray(body.holidays)) {
    throw new HolidayApiError('Holiday response was malformed', MALFORMED_HOLIDAY_STATUS)
  }

  const records: HolidayRecord[] = []
  for (const raw of body.holidays) {
    const record = parseRecord(raw)
    if (record === null) {
      throw new HolidayApiError('Holiday response was malformed', MALFORMED_HOLIDAY_STATUS)
    }
    records.push(record)
  }
  return records
}

/** Create a Holiday. Throws `HolidayApiError` with status 409 on overlap. */
export async function createHoliday(
  input: { startDate: string; endDate: string; name?: string; trainingOn?: boolean },
  signal?: AbortSignal,
): Promise<HolidayRecord | null> {
  const body = await ensureOk(
    await fetch(BASE, {
      ...REQUEST_INIT,
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
      signal,
    }),
  )
  // Advisory only. Every caller reloads afterwards, and THAT read is strict,
  // so an unreadable echo cannot become trusted state.
  return parseRecord(body.holiday)
}

/** Move, shorten or extend an existing Holiday. */
export async function updateHoliday(
  id: string,
  input: { startDate: string; endDate: string; name?: string; trainingOn?: boolean },
  signal?: AbortSignal,
): Promise<HolidayRecord | null> {
  const body = await ensureOk(
    await fetch(`${BASE}/${encodeURIComponent(id)}`, {
      ...REQUEST_INIT,
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
      signal,
    }),
  )
  // Advisory only. Every caller reloads afterwards, and THAT read is strict,
  // so an unreadable echo cannot become trusted state.
  return parseRecord(body.holiday)
}

/** Delete a Holiday. Its dates fall back to the normal Home-derived route. */
export async function deleteHoliday(id: string, signal?: AbortSignal): Promise<void> {
  await ensureOk(
    await fetch(`${BASE}/${encodeURIComponent(id)}`, {
      ...REQUEST_INIT,
      method: 'DELETE',
      signal,
    }),
  )
}

/**
 * Turn training on or off for a Holiday.
 *
 * One call for both sources: a company date and a custom range are the same
 * question here, so the rule that a weekend-only Holiday cannot train lives on
 * the server in exactly one place and cannot be reached around.
 */
export async function setHolidayTraining(
  id: string,
  trainingOn: boolean,
  signal?: AbortSignal,
): Promise<HolidayRecord | null> {
  const body = await ensureOk(
    await fetch(`${BASE}/${encodeURIComponent(id)}/training`, {
      ...REQUEST_INIT,
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ trainingOn }),
      signal,
    }),
  )
  // Advisory only. Every caller reloads afterwards, and THAT read is strict,
  // so an unreadable echo cannot become trusted state.
  return parseRecord(body.holiday)
}
