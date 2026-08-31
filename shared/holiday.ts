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

import { addLocalDays, daysBetween, isLocalDate, rangesOverlap, weekdayOf } from './localDate'

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

/** Longest human-readable Holiday name accepted. */
export const MAX_HOLIDAY_NAME_LENGTH = 80

/**
 * Where a Holiday came from.
 *
 *   company — an approved company date. Canonical: its date and name are not
 *             the user's to move, rename or delete. Only its Training
 *             preference is theirs.
 *   custom  — the user created it and owns all of it.
 */
export type HolidaySource = 'company' | 'custom'

/**
 * One Holiday, whatever its source. Identity is never part of the public shape.
 *
 * `trainingOn` is the whole of Round 13's product change: a Holiday suspends
 * the WORK day, not necessarily the training day. Off (the default) is fully
 * exempt; On restores only that weekday's planned gym session.
 */
export type HolidayRecord = {
  id: string
  /** Inclusive local start date, `YYYY-MM-DD`. */
  startDate: string
  /** Inclusive local end date. Equal to `startDate` for a single day. */
  endDate: string
  /** Human-readable name. Empty string when the user named nothing. */
  name: string
  source: HolidaySource
  /** Does the user still intend to train on this Holiday? Default false. */
  trainingOn: boolean
  createdAt: number
  updatedAt: number
}

/** The validated body of a create or update. */
export type HolidayInput = {
  startDate: string
  endDate: string
  name: string
  trainingOn: boolean
}

/** May the user move, rename or delete this record's dates? */
export function canEditDates(record: Pick<HolidayRecord, 'source'>): boolean {
  return record.source === 'custom'
}

/**
 * Does this inclusive range contain any day that could actually be trained?
 *
 * Only Monday to Friday plan a session. A Saturday/Sunday-only Holiday has no
 * underlying session to restore, so Training On is meaningless there and is
 * refused rather than stored as a preference that can never apply.
 */
export function rangeCanTrain(startDate: string, endDate: string): boolean {
  if (!isLocalDate(startDate) || !isLocalDate(endDate) || startDate > endDate) return false
  for (
    let date: string | null = startDate;
    date !== null && date <= endDate;
    date = addLocalDays(date, 1)
  ) {
    const weekday = weekdayOf(date)
    if (weekday !== null && weekday >= 1 && weekday <= 5) return true
  }
  return false
}

/**
 * Does Training On actually apply to THIS date of the record?
 *
 * Fail-safe, and deliberately re-derived at read time rather than trusted from
 * storage: a weekend date inside a Training-On range is still exempt, so even
 * corrupted or forged data cannot make Saturday a scheduled training day.
 */
export function trainingAppliesOn(
  date: string,
  record: Pick<HolidayRecord, 'trainingOn'>,
): boolean {
  if (!record.trainingOn) return false
  const weekday = weekdayOf(date)
  return weekday !== null && weekday >= 1 && weekday <= 5
}

/** Validate a Holiday name. Absent is an empty name, not an error. */
export function parseHolidayName(raw: unknown): string | null {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > MAX_HOLIDAY_NAME_LENGTH ? null : trimmed
}

/** Which part of a payload was rejected. Never echoes the offending value. */
export type HolidayField =
  | 'body'
  | 'startDate'
  | 'endDate'
  | 'order'
  | 'length'
  | 'name'
  | 'training'

export type ParsedHoliday =
  | { ok: true; value: HolidayInput }
  | { ok: false; field: HolidayField }

/** Validate a server-generated id's shape. */
export function parseHolidayId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_HOLIDAY_ID_LENGTH) return null
  // Custom ids come from crypto.randomUUID(); company ids are the derived
  // `company:YYYY-MM-DD`. Both alphabets, and nothing else — no path
  // separators, no wildcards, nothing that could travel anywhere it should not.
  return /^[A-Za-z0-9:-]+$/.test(raw) ? raw : null
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

  const name = parseHolidayName(raw.name)
  if (name === null) return { ok: false, field: 'name' }

  const trainingOn = raw.trainingOn === undefined ? false : raw.trainingOn
  if (typeof trainingOn !== 'boolean') return { ok: false, field: 'training' }
  // Refused rather than silently downgraded: a weekend-only range has no
  // session to restore, so accepting it would store a preference that can
  // never apply and would read back as a promise the app cannot keep.
  if (trainingOn && !rangeCanTrain(raw.startDate, raw.endDate)) {
    return { ok: false, field: 'training' }
  }

  return {
    ok: true,
    value: { startDate: raw.startDate, endDate: raw.endDate, name, trainingOn },
  }
}

/** Validate a Training-preference body: `{ trainingOn: boolean }`. */
export function parseTrainingPreference(body: unknown): boolean | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const raw = body as Record<string, unknown>
  return typeof raw.trainingOn === 'boolean' ? raw.trainingOn : null
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
