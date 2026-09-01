/**
 * Today's three choices are ALTERNATIVES, not states that may coexist.
 *
 *   1. Do the scheduled workout
 *   2. Recovery today
 *   3. Nintendo Fitness Boxing 2
 *
 * Round 19 Correction 1: hiding a button is not a rule. The exclusion is
 * enforced in DURABLE SERVER TRUTH, on both sides, so it holds for the Today
 * card, the Training route and a direct API call alike:
 *
 *   - a day whose scheduled workout has already STARTED cannot then be flexed
 *   - a day that is flexed cannot then START its scheduled workout
 *
 * Neither direction ever repairs the conflict by writing. A started workout is
 * real history and is left exactly as it is; the flex row, if any, is left
 * exactly as it is. The refusal is the whole response — the user resolves it by
 * choosing "Do scheduled workout", which CLEARS the flex row, and clearing is
 * always allowed precisely so there is a way out.
 *
 * WHY THE WEEKDAY SESSION, AND ONLY IT.
 *
 * "Today's corresponding scheduled workout" is the session the weekday plans,
 * read from the one mapping the whole app uses. An Extra lives in its own
 * reserved slug and is deliberately NOT covered: Round 17 made Extra a separate
 * voluntary thing that is not the day's obligation, and this correction does not
 * change that.
 */

import { weekdayOf } from '../../shared/localDate.ts'
import { sessionIdForWeekday } from '../../shared/today/routines.ts'
import type { WorkoutStore } from '../workouts/workouts.ts'

/**
 * The scheduled session a date plans, or null when it plans none.
 *
 * Weekends answer null, which is correct and harmless here: a day with no
 * scheduled session has no conflict to detect in either direction.
 */
export function scheduledSessionFor(date: string): string | null {
  const weekday = weekdayOf(date)
  return weekday === null ? null : sessionIdForWeekday(weekday)
}

/**
 * Has this account already STARTED the scheduled workout for this date?
 *
 * An occurrence row exists only once Start has been called, so its presence IS
 * "started" — and a completed workout is a started one, so this covers both.
 *
 * The stored `kind` is re-checked rather than assumed: only a genuinely
 * scheduled occurrence blocks a flex choice, so an Extra recorded on the same
 * date cannot be mistaken for the day's obligation.
 */
export async function scheduledWorkoutStarted(
  store: WorkoutStore,
  googleSub: string,
  date: string,
): Promise<boolean> {
  const sessionId = scheduledSessionFor(date)
  if (sessionId === null) return false

  const occurrence = await store.findOccurrence(googleSub, date, sessionId)
  return occurrence !== null && occurrence.kind === 'scheduled'
}
