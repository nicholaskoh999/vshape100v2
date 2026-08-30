/**
 * The Foundation 100 calendar.
 *
 * Day 1 is 2026-08-31 and Day 100 is 2026-12-08. Both are fixed LOCAL calendar
 * dates: the day number is derived from the date the user's own device is
 * showing, never from a UTC instant. Deriving it from UTC would move the
 * boundary across midnight for most of the world, so someone training on the
 * evening of Day 7 could be told it is Day 8.
 *
 * The arithmetic below works on the calendar parts only. `Date.UTC` is used as
 * a fixed frame for counting whole days between two already-local dates — it
 * never converts a timezone, so no offset can leak in.
 *
 * Reaching Day 100 does not end anything. The count keeps going afterwards, so
 * long-term history stays continuous rather than resetting or implying the
 * training is finished.
 */

/** Day 1 of Foundation, as a local calendar date. */
export const FOUNDATION_START = '2026-08-31'
/** Day 100 of Foundation, as a local calendar date. */
export const FOUNDATION_END = '2026-12-08'
/** How many days Foundation spans. */
export const FOUNDATION_TOTAL_DAYS = 100

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** A local calendar date as a day index, for counting only. */
function toDayIndex(date: string): number | null {
  const match = DAY_PATTERN.exec(date)
  if (!match) return null
  const [, year, month, day] = match.map(Number) as [number, number, number, number]
  const utc = Date.UTC(year, month - 1, day)
  const check = new Date(utc)
  // Rejects impossible dates like 2026-02-30, which would otherwise roll over.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return Math.round(utc / MS_PER_DAY)
}

export type FoundationPhase =
  /** The start date has not arrived yet. There is no Day 0. */
  | 'upcoming'
  /** Day 1 through Day 100 inclusive. */
  | 'foundation'
  /** Past Day 100 — still counting, still training. */
  | 'beyond'

export type FoundationStatus = {
  phase: FoundationPhase
  /**
   * Days since the start, 1 on the start date. Null before it begins, because
   * "Day 0" would present an inactive Foundation as if it were running.
   */
  day: number | null
  total: number
  /** Whole days until Day 1. Only set while upcoming. */
  daysUntilStart: number | null
}

/**
 * Where a local calendar date sits in Foundation.
 *
 * Returns null for a date that is not a real calendar date, so a caller can
 * say it does not know rather than render a wrong day number.
 */
export function foundationStatus(localDate: string): FoundationStatus | null {
  const today = toDayIndex(localDate)
  const start = toDayIndex(FOUNDATION_START)
  if (today === null || start === null) return null

  const day = today - start + 1

  if (day < 1) {
    return {
      phase: 'upcoming',
      day: null,
      total: FOUNDATION_TOTAL_DAYS,
      daysUntilStart: start - today,
    }
  }

  return {
    phase: day <= FOUNDATION_TOTAL_DAYS ? 'foundation' : 'beyond',
    day,
    total: FOUNDATION_TOTAL_DAYS,
    daysUntilStart: null,
  }
}

/** The headline line for the overview, e.g. "Day 7 / 100". */
export function foundationLabel(status: FoundationStatus): string {
  if (status.phase === 'upcoming') return 'Foundation upcoming'
  if (status.phase === 'foundation') return `Day ${status.day} / ${status.total}`
  // Past Day 100: keep counting rather than stopping at the cap.
  return `Day ${status.day}`
}
