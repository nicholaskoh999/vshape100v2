import type { WorkoutInputType } from '@shared/workoutInput'
import type { WorkoutSet } from './workoutApi'

/**
 * WHEN A STARTED WORKOUT'S MODALITY IS NO LONGER THE ONE YOU TRAIN IN.
 *
 * Round 20 freezes an exercise's input type into the workout at Start, and
 * Round 22 does not change that: the snapshot is what the sets were recorded
 * against, and reinterpreting it later would be inventing history.
 *
 * But the setting can move afterwards. The real case: an exercise was started
 * as Weight (kg), the user then set it to Resistance band, and the running
 * workout went on offering kilogram fields and kilogram guidance. They entered
 * "1 kg" to mean one band, which is exactly the kind of misleading evidence the
 * typed-resistance work existed to stop.
 *
 * WHAT THIS DOES, AND DELIBERATELY DOES NOT DO.
 *
 * It detects the disagreement and says so. It does NOT:
 *
 *   - reinterpret the started workout
 *   - convert kilograms into bands, or bands into anything
 *   - introduce a band-strength ordering
 *   - rewrite any recorded set
 *
 * The frozen controls stay exactly as they were, because that is what the sets
 * already logged mean. What is withdrawn is the ACTIONABLE guidance: a
 * "first set recorded at 1 kg — how did that feel?" prompt invites the user to
 * confirm a load in a modality they have just said this exercise is not, and
 * acting on it writes calibration evidence they will have to undo.
 *
 * Correcting what was recorded is a deliberate act, through the accepted
 * Round 21 flow: Progress → Recorded sets → Edit recorded set.
 */

export type ModalityMismatch = {
  /** What the workout froze at Start, and what its controls still use. */
  frozen: WorkoutInputType
  /** What this exercise's setting says today. */
  current: WorkoutInputType
}

/**
 * The mismatch for one position of a started workout, or null when there is
 * none to report.
 *
 * Null covers every honest "nothing to say" case, and they are kept apart from
 * a real disagreement on purpose:
 *
 *   - the exercise has no sets at this position
 *   - the account has never stated an input type for it, so there is nothing
 *     to disagree WITH — an unconfigured exercise is not kilograms, it is
 *     unanswered, and Round 20 is explicit that the two must not look alike
 *   - the stored snapshot carries no modality (a workout begun before Round 20)
 *   - they agree
 */
export function modalityMismatchAt(
  sets: readonly WorkoutSet[],
  exerciseOrder: number,
  currentByExercise: ReadonlyMap<string, WorkoutInputType>,
): ModalityMismatch | null {
  const set = sets.find((entry) => entry.exerciseOrder === exerciseOrder)
  if (!set) return null

  const frozen = set.inputType
  if (!frozen) return null

  const current = currentByExercise.get(set.exerciseId)
  if (!current) return null

  return current === frozen ? null : { frozen, current }
}
