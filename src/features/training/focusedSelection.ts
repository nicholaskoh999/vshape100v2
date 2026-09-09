import type { WorkoutSet } from './workoutApi'

/**
 * WHICH EXERCISE FOCUSED MODE OPENS ON.
 *
 * The exercise holding the first PENDING set of the persisted workout, or null
 * when nothing is pending — in which case there is no current exercise, and the
 * workspace says the workout is complete rather than inventing one.
 *
 * Ordered explicitly rather than by trusting the order the sets arrived in.
 * This answer decides what somebody is looking at when they tap Continue in a
 * gym, and "whatever came back first" is not a rule anybody can check.
 *
 * A SKIPPED set is resolved. Skipping an exercise is a decision the user made,
 * and re-opening on it would quietly argue with them.
 */
export function firstPendingExercise(sets: readonly WorkoutSet[]): number | null {
  let best: WorkoutSet | null = null
  for (const set of sets) {
    if (set.status !== 'pending') continue
    if (
      best === null ||
      set.exerciseOrder < best.exerciseOrder ||
      (set.exerciseOrder === best.exerciseOrder && set.setIndex < best.setIndex)
    ) {
      best = set
    }
  }
  return best === null ? null : best.exerciseOrder
}
