/**
 * Holiday Mode contract and validation.
 *
 * Shared by the Worker (which decides what may be stored) and the React
 * calendar (which must not offer to save something the server will reject),
 * following shared/exerciseMedia.ts and shared/workoutLog.ts.
 *
 * ## What Holiday means
 *
 * Holiday is EXEMPT, not missed. A Holiday date suspends the normal routine's
 * pressure; it never marks anything failed, completed, or skipped, and it
 * never touches Foundation — the day number keeps advancing by real calendar
 * date whether or not the day is a Holiday.
 *
 * ## Only two modes
 *
 * Home and Holiday. There is no Work Trip, Sick, Busy or custom type, and a
 * record carries no label for that reason: a stored range simply *is* Holiday.
 */

import { daysBetween, isLocalDate, rangesOverlap } from './localDate'

/** Longest id accepted. Ids are server-generated UUIDs. */
export const MAX_HOLIDAY_ID_LENGTH = 64
/**
 * Widest span a single list read may ask for.
 *
 * A month view needs ~6 weeks; a year of context is generous. Bounded so a
 * caller cannot ask the database to walk everything.
 */
export const MAX_HOLIDAY_RANGE_DAYS = 366
/** Longest single Holiday a record may span. */
export const MAX_HOLIDAY_LENGTH_DAYS = 366

/** One stored Holiday range. Identity is never part of the public shape. */
export type HolidayRecord = {
  id: string
  /** Inclusive local start date, `YYYY-MM-DD`. */
  startDate: string
  /** Inclusive local end date. Equal to `startDate` for a single day. */
  endDate: string
  createdAt: number
  updatedAt: number
}

/** The validated body of a create or update. */
export type HolidayInput = {
  startDate: string
  endDate: string
}

/** Which part of a payload was rejected. Never echoes the offending value. */
export type HolidayField = 'body' | 'startDate' | 'endDate' | 'order' | 'length'

export type ParsedHoliday =
  | { ok: true; value: HolidayInput }
  | { ok: false; field: HolidayField }

/** Validate a server-generated id's shape. */
export function parseHolidayId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_HOLIDAY_ID_LENGTH) return null
  // Ids come from crypto.randomUUID(); accept that alphabet only.
  return /^[A-Za-z0-9-]+$/.test(raw) ? raw : null
}

/**
 * Validate a create/update body.
 *
 * A single-day Holiday is `startDate === endDate`; a range is inclusive of
 * both ends. `start > end` is rejected rather than silently swapped, because
 * swapping would store a range the user did not ask for.
 */
export function parseHolidayInput(body: unknown): ParsedHoliday {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  if (!isLocalDate(raw.startDate)) return { ok: false, field: 'startDate' }
  if (!isLocalDate(raw.endDate)) return { ok: false, field: 'endDate' }
  if (raw.startDate > raw.endDate) return { ok: false, field: 'order' }

  if (!withinLengthBound(raw.startDate, raw.endDate)) {
    return { ok: false, field: 'length' }
  }

  return { ok: true, value: { startDate: raw.startDate, endDate: raw.endDate } }
}

/** Is the inclusive range within the accepted maximum length? */
export function withinLengthBound(startDate: string, endDate: string): boolean {
  const gap = daysBetween(startDate, endDate)
  if (gap === null) return false
  const days = gap + 1
  return days >= 1 && days <= MAX_HOLIDAY_LENGTH_DAYS
}

/**
 * Does a candidate range clash with an existing record?
 *
 * Ranges for one account must not overlap. Adjacent ranges are fine — this is
 * deliberately the whole rule. Nothing merges, splits or deletes another
 * record on the user's behalf, so an edit or delete always does exactly what
 * it says.
 *
 * `excludeId` lets an edit ignore the record being edited, so saving a range
 * unchanged is never a false conflict with itself.
 */
export function findHolidayConflict(
  candidate: HolidayInput,
  existing: readonly HolidayRecord[],
  excludeId?: string,
): HolidayRecord | null {
  for (const record of existing) {
    if (excludeId !== undefined && record.id === excludeId) continue
    if (
      rangesOverlap(candidate.startDate, candidate.endDate, record.startDate, record.endDate)
    ) {
      return record
    }
  }
  return null
}
