import type { WorkoutInputType } from '@shared/workoutInput'
import type { WorkoutSet } from './workoutApi'

/**
 * WHEN A STARTED WORKOUT'S MODALITY IS NO LONGER THE ONE YOU TRAIN IN — AND
 * WHEN WE DO NOT YET KNOW WHETHER IT IS.
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
 *
 * ROUND 22 CORRECTION 2 — THE ANSWER MUST FAIL CLOSED.
 *
 * Detecting the disagreement is only half of it. The account's current input
 * types arrive over the network, and until that read has SUCCEEDED there is no
 * "current" to compare against — the library is legitimately empty while it is
 * loading, and empty again when the read failed.
 *
 * Reading that emptiness as "nothing to disagree with" is the same assumption
 * this whole line of work exists to remove: it silently means "assume the
 * frozen kilograms are still right", and it lets the actionable load guidance
 * render before anything has been verified. That is fail-open, and it produces
 * exactly the bad evidence above whenever the read happens to be slow or down.
 *
 * So an unverified library is its own verdict. Nothing is claimed about the
 * exercise — no mismatch is manufactured, and no agreement is assumed — but
 * the actionable guidance is withheld until the answer is genuinely known.
 */

export type ModalityMismatch = {
  /** What the workout froze at Start, and what its controls still use. */
  frozen: WorkoutInputType
  /** What this exercise's setting says today. */
  current: WorkoutInputType
}

/**
 * The account's current input types, as far as this render knows them.
 *
 * Taken structurally rather than as `ExerciseInputTypeLibrary` so this module
 * stays a pure function of what it was told, and so `status` cannot be dropped
 * from a caller without the compiler noticing.
 */
export type CurrentInputTypes = {
  status: 'loading' | 'ready' | 'error'
  /** Exercise id → stated input type. Empty unless `status` is 'ready'. */
  byExercise: ReadonlyMap<string, WorkoutInputType>
}

/**
 * What can be said about one position of a started workout's modality.
 *
 *   mismatch    the current setting disagrees with the frozen snapshot
 *   unverified  the current setting is not known yet, or could not be read
 *
 * `null` is reserved for the cases where the modality is genuinely settled and
 * there is nothing to say.
 */
export type ModalityVerdict =
  | ({ kind: 'mismatch' } & ModalityMismatch)
  | { kind: 'unverified'; reason: 'loading' | 'error' }

/**
 * The verdict for one position of a started workout.
 *
 * Null covers every honest "nothing to say" case, and they are kept apart from
 * a real disagreement — and from an unverified one — on purpose:
 *
 *   - the exercise has no sets at this position
 *   - the stored snapshot carries no modality (a workout begun before Round 20),
 *     so there is nothing frozen that could fall out of date
 *   - the library is READY and the account has never stated an input type for
 *     this exercise, so there is nothing to disagree WITH — an unconfigured
 *     exercise is not kilograms, it is unanswered, and Round 20 is explicit
 *     that the two must not look alike
 *   - the library is READY and they agree
 *
 * Note the order: "never stated" is only reachable once the read has SUCCEEDED.
 * Before that, an absent record is not an answer, it is an absence of one.
 */
export function modalityVerdictAt(
  sets: readonly WorkoutSet[],
  exerciseOrder: number,
  current: CurrentInputTypes,
): ModalityVerdict | null {
  const set = sets.find((entry) => entry.exerciseOrder === exerciseOrder)
  if (!set) return null

  const frozen = set.inputType
  if (!frozen) return null

  /*
   * THE FAIL-CLOSED GATE (Round 22 Correction 2).
   *
   * This workout froze a modality, so there IS something that can go stale.
   * Until the current library has been read successfully we do not know
   * whether it has, and we decline to act as though it has not.
   *
   * Removing this returns the module to fail-open: `byExercise` is empty while
   * loading and after a failure, so every lookup below would miss and every
   * row would report a settled, agreeing modality it has never checked.
   */
  if (current.status !== 'ready') {
    return { kind: 'unverified', reason: current.status }
  }

  const today = current.byExercise.get(set.exerciseId)
  if (!today) return null

  return today === frozen ? null : { kind: 'mismatch', frozen, current: today }
}
