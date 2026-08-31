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
 */

import { dayTypeFor, holidayFor } from '@/features/calendar/calendarModel'
import { sessionIdForWeekday } from '@/features/today/model/routines'
import { trainingAppliesOn, type HolidayRecord } from '@shared/holiday'
import { isLocalDate, weekdayOf } from '@shared/localDate'

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
 * The plan for a date, or null when the date is not a real calendar date.
 *
 * Null is "we cannot say", never "nothing was planned" — a caller must not
 * turn an unparseable date into a neutral day and quietly skip it.
 */
export function scheduledDayFor(
  date: string,
  holidays: readonly HolidayRecord[],
): ScheduledDay | null {
  if (!isLocalDate(date)) return null

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
    return { kind: 'training', date, sessionId: holidaySession }
  }

  const type = dayTypeFor(date, holidays)
  if (type === 'saturday') return { kind: 'neutral', date, reason: 'saturday' }
  if (type === 'sunday') return { kind: 'neutral', date, reason: 'sunday' }

  const weekday = weekdayOf(date)
  const sessionId = weekday === null ? null : sessionIdForWeekday(weekday)
  // A training day with no session would be a schedule the app cannot name.
  // Treating it as neutral is safer than inventing a session id to match.
  if (sessionId === null) return { kind: 'neutral', date, reason: 'saturday' }

  return { kind: 'training', date, sessionId }
}

/** Does this date plan a gym session? */
export function isScheduledTrainingDay(
  date: string,
  holidays: readonly HolidayRecord[],
): boolean {
  return scheduledDayFor(date, holidays)?.kind === 'training'
}
