/**
 * The Foundation 100 calendar.
 *
 * Day 1 is whatever start date the ACCOUNT has chosen, and Day 100 is 99 local
 * days after it. Both are LOCAL calendar dates: the day number is derived from
 * the date the user's own device is showing, never from a UTC instant. Deriving
 * it from UTC would move the boundary across midnight for most of the world, so
 * someone training on the evening of Day 7 could be told it is Day 8.
 *
 * ROUND 18: THE START DATE IS NO LONGER A CONSTANT HERE.
 *
 * It was `FOUNDATION_START`, a source constant, and `FOUNDATION_END` was a
 * fixed calendar date beside it. That made a per-person calendar fact something
 * only a redeploy could change, and it meant every page importing the constant
 * was its own quiet authority. Both are gone: `foundationStatus` now REQUIRES
 * the start date, so a caller cannot forget to pass one and silently fall back
 * to a hard-coded day. The only default lives in shared/settings.ts, applied by
 * `effectiveFoundationStart`, and it exists purely so accounts that never chose
 * a date keep reading exactly as they always have.
 *
 * Day 100 is derived, not stored. There is no end date to drift out of step
 * with the start.
 *
 * The arithmetic below works on the calendar parts only. `Date.UTC` is used as
 * a fixed frame for counting whole days between two already-local dates — it
 * never converts a timezone, so no offset can leak in.
 *
 * Reaching Day 100 does not end anything. The count keeps going afterwards, so
 * long-term history stays continuous rather than resetting or implying the
 * training is finished.
 */

import { addLocalDays, toDayIndex } from '@shared/localDate'
import { FOUNDATION_TOTAL_DAYS } from '@shared/settings'

export { DEFAULT_FOUNDATION_START, FOUNDATION_TOTAL_DAYS } from '@shared/settings'

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
  /** The start date this status was derived from, echoed for display. */
  startDate: string
  /**
   * Day 100, derived as start + 99 local days. Null only when the start date
   * is unreadable, in which case nothing else here is stated either.
   */
  endDate: string | null
}

/**
 * Where a local calendar date sits in Foundation, given the account's start.
 *
 * Returns null when either date is not a real calendar date, so a caller can
 * say it does not know rather than render a wrong day number.
 */
export function foundationStatus(
  localDate: string,
  startDate: string,
): FoundationStatus | null {
  const today = toDayIndex(localDate)
  const start = toDayIndex(startDate)
  if (today === null || start === null) return null

  const day = today - start + 1
  // Day 1 is the start date itself, so Day 100 is 99 days later — not 100.
  const endDate = addLocalDays(startDate, FOUNDATION_TOTAL_DAYS - 1)

  if (day < 1) {
    return {
      phase: 'upcoming',
      day: null,
      total: FOUNDATION_TOTAL_DAYS,
      daysUntilStart: start - today,
      startDate,
      endDate,
    }
  }

  return {
    phase: day <= FOUNDATION_TOTAL_DAYS ? 'foundation' : 'beyond',
    day,
    total: FOUNDATION_TOTAL_DAYS,
    daysUntilStart: null,
    startDate,
    endDate,
  }
}

/** The headline line for the overview, e.g. "Day 7 / 100". */
export function foundationLabel(status: FoundationStatus): string {
  if (status.phase === 'upcoming') return 'Foundation upcoming'
  if (status.phase === 'foundation') return `Day ${status.day} / ${status.total}`
  // Past Day 100: keep counting rather than stopping at the cap.
  return `Day ${status.day}`
}
