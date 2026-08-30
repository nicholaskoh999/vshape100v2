/**
 * Holiday Mode client.
 *
 * D1 is the durable source of truth. Nothing is mirrored into browser storage,
 * and the session travels in the existing HttpOnly cookie, which React can
 * never see. The account is never part of any payload.
 */

import type { HolidayRecord } from '@shared/holiday'

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

/** Returns null for anything that is not a full record. */
function toRecord(raw: unknown): HolidayRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string') return null
  if (typeof row.startDate !== 'string' || typeof row.endDate !== 'string') return null
  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
  }
}

async function ensureOk(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) return body

  // A 409 carries the range it clashed with, so the editor can say which one.
  throw new HolidayApiError(
    `Holiday request failed (${response.status})`,
    response.status,
    toRecord(body.conflict),
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
  return Array.isArray(body.holidays)
    ? body.holidays.map(toRecord).filter((row): row is HolidayRecord => row !== null)
    : []
}

/** Create a Holiday. Throws `HolidayApiError` with status 409 on overlap. */
export async function createHoliday(
  input: { startDate: string; endDate: string },
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
  return toRecord(body.holiday)
}

/** Move, shorten or extend an existing Holiday. */
export async function updateHoliday(
  id: string,
  input: { startDate: string; endDate: string },
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
  return toRecord(body.holiday)
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
