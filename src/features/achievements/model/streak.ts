/**
 * Training streaks, derived — never stored.
 *
 * A streak counts SCHEDULED TRAINING DAYS, not calendar days. Saturday, Sunday
 * and Holiday are neutral: they neither extend a streak nor break one, so a
 * planned rest or a planned Holiday can never read as a miss.
 *
 * Nothing here writes. Everything is a pure function of facts that already
 * exist: recorded workout logs, Holiday records, and the local calendar date.
 */

import { sessionIdForWeekday } from '@/features/today/model/routines'
import type { HolidayRecord } from '@shared/holiday'
import { addLocalDays, isLocalDate, weekdayOf } from '@shared/localDate'
import { isFullyResolved, type WorkoutHistoryEntry } from '@shared/workoutLog'

import { scheduledDayFor } from './schedule'

/**
 * What one date contributed.
 *
 *   success  — the day's planned session was genuinely finished
 *   failure  — a past training day that was not
 *   pending  — today's training day, not finished YET; it must not break
 *              anything before the local day is over
 *   neutral  — Saturday, Sunday or Holiday
 *   future   — after today; never judged
 */
export type DayOutcome = 'success' | 'failure' | 'pending' | 'neutral' | 'future'

/**
 * Did this workout genuinely finish the session it claims?
 *
 * All four conditions are required:
 *   - it is the session that date planned (a Tuesday log cannot satisfy Monday)
 *   - it has sets at all
 *   - every set is resolved
 *   - at least one set was actually COMPLETED
 *
 * The last one is the important one: `resolved` counts skips, so a workout
 * whose every set was skipped is fully traversed and was not trained. Starting
 * a workout is likewise not enough — pending sets mean it is unfinished.
 */
export function isQualifyingWorkout(
  entry: WorkoutHistoryEntry,
  date: string,
  sessionId: string,
): boolean {
  if (entry.date !== date || entry.sessionId !== sessionId) return false
  return isFullyResolved(entry.progress) && entry.progress.completed > 0
}

/** `date|sessionId` — the identity a streak day is satisfied by. */
function keyOf(date: string, sessionId: string): string {
  return `${date}|${sessionId}`
}

/**
 * The set of (date, session) pairs that were genuinely finished.
 *
 * Built once so a walk across the window is a membership test rather than a
 * scan per day.
 */
export function buildQualifyingIndex(
  entries: readonly WorkoutHistoryEntry[],
): ReadonlySet<string> {
  const index = new Set<string>()
  for (const entry of entries) {
    if (isQualifyingWorkout(entry, entry.date, entry.sessionId)) {
      index.add(keyOf(entry.date, entry.sessionId))
    }
  }
  return index
}

/**
 * Is this the session the weekday plans?
 *
 * Reads the same mapping Today uses. Holiday is deliberately NOT consulted:
 * this answers "was a planned session trained", which stays true even on a day
 * whose routine pressure was suspended.
 */
export function isPlannedSessionFor(date: string, sessionId: string): boolean {
  const weekday = weekdayOf(date)
  return weekday !== null && sessionIdForWeekday(weekday) === sessionId
}

/**
 * How many planned sessions were genuinely finished.
 *
 * Counted from the logs themselves rather than from a walk of the calendar, so
 * training done on a Holiday still counts as training that happened — it just
 * does not move a streak, which is what "exempt" means.
 */
export function countQualifyingSessions(
  entries: readonly WorkoutHistoryEntry[],
): number {
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!isQualifyingWorkout(entry, entry.date, entry.sessionId)) continue
    if (!isPlannedSessionFor(entry.date, entry.sessionId)) continue
    seen.add(keyOf(entry.date, entry.sessionId))
  }
  return seen.size
}

export type OutcomeContext = {
  /** Today's local calendar date. */
  today: string
  holidays: readonly HolidayRecord[]
  qualifying: ReadonlySet<string>
}

/** What one date contributed to a streak. */
export function outcomeFor(date: string, context: OutcomeContext): DayOutcome {
  if (date > context.today) return 'future'

  const planned = scheduledDayFor(date, context.holidays)
  // An unreadable date is not silently neutral — it is not judged either.
  if (planned === null) return 'future'
  if (planned.kind === 'neutral') return 'neutral'

  if (context.qualifying.has(keyOf(planned.date, planned.sessionId))) return 'success'
  // Today's session still has the rest of the local day to be finished.
  return date === context.today ? 'pending' : 'failure'
}

export type StreakWindow = {
  /** First date the evaluation can see. */
  from: string
  /** Today's local calendar date; the window's last day. */
  today: string
  holidays: readonly HolidayRecord[]
  qualifying: ReadonlySet<string>
}

/**
 * Consecutive finished training days ending at today.
 *
 * Walks backwards, stepping over neutral days entirely. Today counts only when
 * it is already finished; while it is still pending it is skipped, so an
 * unfinished today never erases what came before it.
 */
export function currentStreak(window: StreakWindow): number {
  let streak = 0
  for (
    let date: string | null = window.today;
    date !== null && date >= window.from;
    date = addLocalDays(date, -1)
  ) {
    const outcome = outcomeFor(date, window)
    if (outcome === 'neutral' || outcome === 'pending' || outcome === 'future') continue
    if (outcome === 'failure') break
    streak += 1
  }
  return streak
}

/**
 * The longest run of finished training days inside the window.
 *
 * A failure ends a run and lets a later one begin. Neutral days separate
 * without ending, so a run spans a weekend or a Holiday intact.
 */
export function bestStreak(window: StreakWindow): number {
  let best = 0
  let run = 0
  for (
    let date: string | null = window.from;
    date !== null && date <= window.today;
    date = addLocalDays(date, 1)
  ) {
    const outcome = outcomeFor(date, window)
    if (outcome === 'neutral' || outcome === 'pending' || outcome === 'future') continue
    if (outcome === 'failure') {
      run = 0
      continue
    }
    run += 1
    if (run > best) best = run
  }
  return best
}

/* ------------------------------------------------------------------ */
/* Evaluation, including refusing to answer                            */
/* ------------------------------------------------------------------ */

export type StreakFacts = {
  current: number
  best: number
  qualifyingSessions: number
}

/**
 * Why no streak can be stated.
 *
 *   holidays — Holiday truth is loading or failed; an unknown historical date
 *              must never be assumed to be a normal Home training day
 *   workouts — the log read is loading or failed
 *   coverage — the log read did not prove the whole window, so an absent
 *              workout might simply be outside what was returned
 *   range    — the window itself is not a usable pair of local dates
 */
export type StreakUnavailableReason = 'holidays' | 'workouts' | 'coverage' | 'range'

export type StreakEvaluation =
  | { status: 'ready'; facts: StreakFacts }
  /** A source is still in flight. Not a failure, and not a number yet. */
  | { status: 'checking' }
  | { status: 'unavailable'; reason: StreakUnavailableReason }

export type SourceStatus = 'loading' | 'ready' | 'error'
/** Whether a log read proved every workout in the window. */
export type Coverage = 'complete' | 'partial' | 'unknown'

export type StreakSources = {
  today: string
  from: string
  holidayStatus: SourceStatus
  holidays: readonly HolidayRecord[]
  historyStatus: SourceStatus
  entries: readonly WorkoutHistoryEntry[]
  coverage: Coverage
}

/**
 * Streak facts, or an honest refusal.
 *
 * Every source must be settled AND complete before a number is stated. A
 * missing workout only means "not trained" when the read is known to have
 * covered that date; otherwise absence proves nothing, and claiming a broken
 * streak from it would be a fabrication.
 */
export function evaluateStreaks(sources: StreakSources): StreakEvaluation {
  if (!isLocalDate(sources.today) || !isLocalDate(sources.from)) {
    return { status: 'unavailable', reason: 'range' }
  }
  if (sources.from > sources.today) {
    return { status: 'unavailable', reason: 'range' }
  }
  // Still arriving is not the same as failed: say "checking", not "broken".
  if (sources.holidayStatus === 'loading' || sources.historyStatus === 'loading') {
    return { status: 'checking' }
  }
  // Holiday first: without it, a rest day and a missed day look identical.
  if (sources.holidayStatus !== 'ready') {
    return { status: 'unavailable', reason: 'holidays' }
  }
  if (sources.historyStatus !== 'ready') {
    return { status: 'unavailable', reason: 'workouts' }
  }
  // A read that did not cover the window cannot turn an absent workout into a
  // missed day, so no streak may be stated from it.
  if (sources.coverage !== 'complete') {
    return { status: 'unavailable', reason: 'coverage' }
  }

  const qualifying = buildQualifyingIndex(sources.entries)
  const window: StreakWindow = {
    from: sources.from,
    today: sources.today,
    holidays: sources.holidays,
    qualifying,
  }

  return {
    status: 'ready',
    facts: {
      current: currentStreak(window),
      best: bestStreak(window),
      qualifyingSessions: countQualifyingSessions(sources.entries),
    },
  }
}
