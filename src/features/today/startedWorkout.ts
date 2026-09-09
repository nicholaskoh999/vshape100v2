import { workoutSessionFromSnapshot } from '@/features/training/extra'
import type { WorkoutLog, WorkoutProgress } from '@/features/training/workoutApi'
import type { SessionIntensity } from '@/features/training/sessions'

/**
 * WHAT A STARTED WORKOUT SAYS ABOUT ITSELF.
 *
 * Round 24 correction. Today's training hero used to describe the session with
 * the CURRENT programme — focus, intensity, exercise count, set total — while
 * showing progress read from the STARTED workout. Before Start those two agree,
 * so nothing looked wrong. Edit the programme after a Start and they diverge,
 * and the card presents the difference as one coherent workout:
 *
 *     Light Back + Rear Delts + Core
 *     4 exercises · 11 sets to log
 *     6 / 15 sets resolved · 5 completed · 1 skipped
 *
 * Every number there is real. None of them describe the same thing. A started
 * workout is frozen historical truth: editing Wednesday's programme does not
 * retroactively make the workout begun this morning shorter, and a screen that
 * says otherwise is telling the user something false about training they have
 * already done.
 *
 * So once an occurrence exists, this is what Today reads instead — derived from
 * the SAME `fetchWorkout` response the hook already makes, with no second
 * request, no schema change and nothing inferred from the programme.
 *
 * THE EXERCISE COUNT IS NOT COUNTED HERE. It comes from
 * `workoutSessionFromSnapshot`, which is the function the session page rebuilds
 * the frozen exercise list with. Today and the session page therefore cannot
 * disagree about how many exercises the workout has, because they ask the same
 * function the same question.
 */

export type StartedWorkoutSummary = {
  /** The focus stored at Start. A later programme edit cannot move it. */
  focus: string
  /** The stored intensity, or null when this build has no chip for it. */
  intensity: SessionIntensity | null
  /**
   * The frozen size of the workout, or NULL when the snapshot cannot establish
   * it.
   *
   * Null is a real answer and must stay one. The caller may not substitute the
   * current programme's counts here — that is exactly the substitution this
   * module exists to remove, and doing it under a "started" heading would turn
   * an unknown into a confident falsehood.
   */
  counts: { exercises: number; sets: number } | null
  /** The workout's own progress, or null when the server did not report it. */
  progress: WorkoutProgress | null
}

/**
 * Does this stored intensity have a chip in this build?
 *
 * A snapshot may carry an intensity written under an older vocabulary. Rather
 * than force it into a style it does not have, the badge is simply not drawn.
 *
 * (`TrainingSessionPage` holds an identical predicate for the same reason.
 * Unifying them is a follow-up, deliberately not taken here: this correction is
 * about which source Today reads, and widening it to touch the session page
 * would make the diff harder to review than the bug is to fix.)
 */
function isSessionIntensity(value: string): value is SessionIntensity {
  return value === 'HARD' || value === 'LIGHT' || value === 'PUMP'
}

/**
 * The frozen summary of a started workout, or null when none has been started.
 *
 * Null means "no occurrence exists" — which is the only case in which the
 * caller may describe the day from the current programme.
 */
export function summariseStartedWorkout(log: WorkoutLog): StartedWorkoutSummary | null {
  const { occurrence, sets, progress } = log
  // An occurrence exists only once Start has been called, so its presence IS
  // "started" — and a finished workout is a started one.
  if (occurrence === null) return null

  const exercises = workoutSessionFromSnapshot(occurrence.sessionId, sets).exercises.length

  /*
   * FAIL CLOSED ON THE COUNTS, SEPARATELY FROM THE IDENTITY.
   *
   * The focus and intensity of a started workout are stored on the occurrence
   * and are always available. The SIZE is derived from the rows, so it is
   * claimed only when the rows and the server's own total agree with each
   * other. A disagreement between them is not something to average or to
   * prefer one side of — it means the snapshot cannot be described honestly,
   * and an unstated number is better than a confident wrong one.
   */
  const counts =
    progress !== null &&
    sets.length > 0 &&
    exercises > 0 &&
    progress.total === sets.length
      ? { exercises, sets: progress.total }
      : null

  return {
    focus: occurrence.focus,
    intensity: isSessionIntensity(occurrence.intensity) ? occurrence.intensity : null,
    counts,
    progress,
  }
}
