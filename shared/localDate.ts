/**
 * Local calendar dates, as plain `YYYY-MM-DD` text.
 *
 * The whole app agrees that a date like `2026-08-31` is a DAY on the user's
 * own calendar, not an instant. Nothing here converts a timezone, and nothing
 * here goes through `Date.parse` or `new Date(string)` — both interpret a bare
 * date as UTC midnight, which lands on the previous day for anyone west of
 * UTC and silently shifts the day the user picked.
 *
 * `Date.UTC` appears only as a fixed frame for counting whole days between two
 * dates that are *already* local. No offset can leak in through it.
 */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** A real calendar date in `YYYY-MM-DD`. Rejects 2026-02-30 and 2026-13-01. */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number) as [number, number, number, number]
  const utc = new Date(Date.UTC(year, month - 1, day))
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  )
}

/** Validate a local date, returning it or null. */
export function parseLocalDate(raw: unknown): string | null {
  return isLocalDate(raw) ? raw : null
}

/**
 * A local date as a whole-day index, for counting only.
 *
 * Returns null for anything that is not a real calendar date, so a caller can
 * say it does not know rather than compute a wrong answer.
 */
export function toDayIndex(date: string): number | null {
  if (!isLocalDate(date)) return null
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

/** A day index back to `YYYY-MM-DD`. */
export function fromDayIndex(index: number): string {
  const date = new Date(index * MS_PER_DAY)
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Whole days from `from` to `to`. Null when either is not a calendar date. */
export function daysBetween(from: string, to: string): number | null {
  const a = toDayIndex(from)
  const b = toDayIndex(to)
  if (a === null || b === null) return null
  return b - a
}

/** Shift a local date by whole days. Null when the input is not a date. */
export function addLocalDays(date: string, days: number): string | null {
  const index = toDayIndex(date)
  return index === null ? null : fromDayIndex(index + days)
}

/**
 * Today on the device's own calendar.
 *
 * Built from local date parts, never `toISOString()`: the UTC date is a
 * different day for much of the world for part of every day.
 */
export function localDateOf(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Weekday of a local date: 0 = Sunday … 6 = Saturday.
 *
 * Read from the calendar parts, so it is the weekday the user's own calendar
 * shows. Returns null for anything that is not a real date.
 */
export function weekdayOf(date: string): number | null {
  const index = toDayIndex(date)
  if (index === null) return null
  return new Date(index * MS_PER_DAY).getUTCDay()
}

/**
 * Do two inclusive date ranges share at least one day?
 *
 * Both ranges are inclusive of their end date, so touching ends overlap and
 * merely adjacent ranges (`…-05` then `-06…`) do not. Lexicographic
 * comparison is exact for zero-padded `YYYY-MM-DD`.
 */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

/** Is `date` inside the inclusive range? */
export function isWithinRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}
