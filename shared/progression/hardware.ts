/**
 * HARDWARE STEPS — and why this file refuses to name one.
 *
 * "Increase the load" is only actionable if the next real load exists. A home
 * gym has the plates, dumbbells and bands it has; the next one up is whatever
 * is on the rack, not an arithmetic step.
 *
 * V2 does not model an authoritative equipment ladder. It knows equipment as
 * free text on a session entry ("DB", "BAND 20kg", "DB + Bench Flat"), and it
 * knows that a stored load may carry a half kilogram because dumbbells come in
 * 2.5 kg pairs. NEITHER of those is a ladder:
 *
 *   - equipment text names a category, not the rungs available
 *   - a validation rule that ACCEPTS 22.5 does not assert that 22.5 exists,
 *     nor that it is the rung above 20
 *
 * So this module answers "unknown" for every step, and the guidance surfaces
 * a DIRECTION — increase one available step, reduce one available step — and
 * lets the person enter the load they actually have. A manufactured "+2.5 kg"
 * would be a number this app invented and then displayed as advice.
 *
 * The lookup below is real, not a placeholder gesture: the moment V2 gains an
 * authoritative per-account ladder, populating it is the whole change, and
 * every caller keeps working. `resolveStep` is exported so that mechanism is
 * tested directly rather than only through the empty case.
 */

import type { WorkoutLoadUnit } from '../workoutLog'

/** Which way a recommendation is pointing, when it points at all. */
export type LoadStepDirection = 'increase' | 'reduce'

/**
 * The next real load in that direction.
 *
 * `known: false` is not an error and not a fallback to arithmetic — it is the
 * honest statement that this deployment cannot name the rung.
 */
export type HardwareStep =
  | { known: true; value: number; unit: WorkoutLoadUnit }
  | { known: false }

/** A ladder is the ascending list of loads that genuinely exist. */
export type HardwareLadder = readonly number[]

/**
 * Authoritative ladders, by load unit.
 *
 * EMPTY ON PURPOSE. V2 has no accepted source for what a person owns, and
 * general equipment availability management is explicitly out of this round.
 */
const LADDERS: Partial<Record<WorkoutLoadUnit, HardwareLadder>> = {}

/**
 * Step along a known ladder.
 *
 * A load that is not itself on the ladder cannot be stepped from: it would
 * mean guessing which rung the person is standing on, which is the same
 * invention this module exists to avoid. The ends of the ladder are honest
 * dead ends rather than an extrapolation past the heaviest thing that exists.
 */
export function resolveStep(
  ladder: HardwareLadder,
  from: { value: number; unit: WorkoutLoadUnit },
  direction: LoadStepDirection,
): HardwareStep {
  const index = ladder.indexOf(from.value)
  if (index < 0) return { known: false }

  const next = direction === 'increase' ? ladder[index + 1] : ladder[index - 1]
  if (next === undefined) return { known: false }
  return { known: true, value: next, unit: from.unit }
}

/**
 * The next available hardware step for a real load in this deployment.
 *
 * Always `{ known: false }` today, because `LADDERS` is empty. That is the
 * fail-closed answer, and the caller renders a direction instead of a number.
 */
export function hardwareStep(
  from: { value: number; unit: WorkoutLoadUnit },
  direction: LoadStepDirection,
): HardwareStep {
  const ladder = LADDERS[from.unit]
  if (!ladder || ladder.length === 0) return { known: false }
  return resolveStep(ladder, from, direction)
}
