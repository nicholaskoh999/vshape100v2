/**
 * IANA timezones, and the local calendar date inside one.
 *
 * Round 14 needed this to decide when 20:30 is for a device. Round 15 needs the
 * same truth for a different reason: a weight measurement is filed under the
 * user's LOCAL calendar date, so the server has to know which date "today" is
 * where the person actually is before it can refuse a future one.
 *
 * The two uses are unrelated in every other way — weight tracking must work
 * with notifications switched off, and nothing here reads a subscription — so
 * the definition lives on its own rather than inside either feature. There is
 * exactly one implementation, and both callers import it.
 */

/** Longest IANA zone name accepted, e.g. 'America/Argentina/Buenos_Aires'. */
export const MAX_TIMEZONE_LENGTH = 64

/**
 * Is this a real IANA timezone?
 *
 * Asked of the platform rather than matched against a list: `Intl` already
 * carries the zone database and throws for anything it does not know, which is
 * exactly the check we want and cannot go stale.
 */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_TIMEZONE_LENGTH) return false
  // 'UTC' and 'Area/Location' shapes only; no offsets, no free text.
  if (!/^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_-]+)*$/.test(value)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * The calendar date, as `YYYY-MM-DD`, that an instant falls on in a zone.
 *
 * Built from formatted parts rather than from an offset, and never through
 * `toISOString()`, which answers for UTC — a different day from the user's for
 * part of every day, which is exactly the window where a valid "today" would
 * be rejected as being in the future.
 *
 * Returns null for a zone the platform does not recognise, so a caller must
 * decide what to do rather than silently landing in UTC.
 */
export function localDateIn(instant: Date, timeZone: string): string | null {
  if (!isIanaTimeZone(timeZone)) return null

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant)

    const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    const year = read('year')
    const month = read('month')
    const day = read('day')

    if (year.length !== 4 || month.length !== 2 || day.length !== 2) return null
    const date = `${year}-${month}-${day}`
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
  } catch {
    return null
  }
}
