/**
 * What a local calendar date PLANS.
 *
 * This module deliberately owns no schedule of its own. A day's shape comes
 * from the two places that already decide it:
 *
 *   - `dayTypeFor` (Calendar) — Holiday overrides the weekday, then Saturday
 *     and Sunday, then a normal training weekday.
 *   - `sessionIdForWeekday` (Today's routine) — which session Monday to Friday
 *     plans.
 *
 * Achievements therefore cannot disagree with Today or the Calendar about what
 * a date is: there is one mapping, read from here.
 *
 * Round 19.2 adds a third input, and its position in the order is the whole of
 * its semantics: a training flex choice is applied LAST and can only ever turn
 * a training day NEUTRAL. It cannot create a training day, cannot override a
 * Holiday, and cannot make a weekend into a session — so Holiday Training
 * Off/On remains the authority on what a day plans, and flex only answers what
 * the user did about a day that already planned a session.
 */

import { dayTypeFor, holidayFor } from '@/features/calendar/calendarModel'
import { sessionIdForWeekday } from '@/features/today/model/routines'
import { trainingAppliesOn, type HolidayRecord } from '@shared/holiday'
import { isLocalDate, weekdayOf } from '@shared/localDate'
import type { TrainingFlexKind } from '@shared/trainingFlex'

/**
 * A scheduled day.
 *
 * `training` carries the session the day plans, because a streak only counts a
 * workout logged against THAT session. `neutral` carries why, so the UI can
 * explain a gap instead of implying a miss.
 */
export type ScheduledDay =
  | { kind: 'training'; date: string; sessionId: string }
  | { kind: 'neutral'; date: string; reason: 'saturday' | 'sunday' | 'holiday' }
  /**
   * The user explicitly resolved this day as something other than the session.
   *
   * Neutral, exactly like a weekend or an exempt Holiday: it neither extends
   * nor breaks a streak. Extending would reward not doing the session; breaking
   * would punish the honest choice the product asked for.
   */
  | { kind: 'neutral'; date: string; reason: 'flex'; flex: TrainingFlexKind }

/**
 * The plan for a date, or null when the date is not a real calendar date.
 *
 * Null is "we cannot say", never "nothing was planned" — a caller must not
 * turn an unparseable date into a neutral day and quietly skip it.
 */
/** The flex choices in force, by local date. */
export type TrainingFlexDays = ReadonlyMap<string, TrainingFlexKind>

export function scheduledDayFor(
  date: string,
  holidays: readonly HolidayRecord[],
  flex: TrainingFlexDays,
): ScheduledDay | null {
  if (!isLocalDate(date)) return null

  /**
   * Applied to a day that WOULD plan a session, and only then.
   *
   * Written as a wrapper around the training result rather than as an early
   * return, so there is no path where a flex choice is consulted before the
   * schedule has decided there was something to flex away from.
   */
  const withFlex = (day: ScheduledDay): ScheduledDay => {
    if (day.kind !== 'training') return day
    const chosen = flex.get(date)
    return chosen ? { kind: 'neutral', date, reason: 'flex', flex: chosen } : day
  }

  // Holiday wins over the weekday here exactly as it does on the Calendar —
  // but a Holiday is no longer automatically exempt from TRAINING.
  const covering = holidayFor(date, holidays)
  if (covering) {
    // Fail-safe, and re-derived rather than trusted: `trainingAppliesOn`
    // rejects Saturday and Sunday whatever the stored preference says, so
    // corrupted or forged data can never make a weekend a scheduled day.
    if (!trainingAppliesOn(date, covering)) {
      return { kind: 'neutral', date, reason: 'holiday' }
    }
    const holidayWeekday = weekdayOf(date)
    const holidaySession =
      holidayWeekday === null ? null : sessionIdForWeekday(holidayWeekday)
    // No session to restore means nothing was scheduled, so still neutral.
    if (holidaySession === null) return { kind: 'neutral', date, reason: 'holiday' }
    return withFlex({ kind: 'training', date, sessionId: holidaySession })
  }

  const type = dayTypeFor(date, holidays)
  if (type === 'saturday') return { kind: 'neutral', date, reason: 'saturday' }
  if (type === 'sunday') return { kind: 'neutral', date, reason: 'sunday' }

  const weekday = weekdayOf(date)
  const sessionId = weekday === null ? null : sessionIdForWeekday(weekday)
  // A training day with no session would be a schedule the app cannot name.
  // Treating it as neutral is safer than inventing a session id to match.
  if (sessionId === null) return { kind: 'neutral', date, reason: 'saturday' }

  return withFlex({ kind: 'training', date, sessionId })
}

/** Does this date plan a gym session? */
export function isScheduledTrainingDay(
  date: string,
  holidays: readonly HolidayRecord[],
  flex: TrainingFlexDays,
): boolean {
  return scheduledDayFor(date, holidays, flex)?.kind === 'training'
}
