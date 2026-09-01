/**
 * PROGRESSION LANE IDENTITY.
 *
 * A lane is the unit a recommendation belongs to. It is deliberately NOT the
 * canonical exercise: Monday's Lat Pulldown and Wednesday's Lat Pulldown are
 * one canonical movement with one media record, and two entirely separate
 * pieces of training work. A lane preserves, all of it and nothing less:
 *
 *   session id                  Monday is not Wednesday
 *   canonical exercise id       what movement it is
 *   authored prescription       the sets and the target range being climbed
 *   result kind                 reps are not seconds
 *   load mode                   kg is not kg_each is not none
 *   per side                    a per-side rep count is not a both-sides one
 *
 * Change any of those and it is a DIFFERENT lane. A changed prescription
 * therefore starts a new recommendation lane, and the workout history that was
 * logged under the old one stays exactly as it was performed — history is never
 * rewritten to fit a lane.
 *
 * The prescription enters the identity as its PARSED SEMANTICS (set count and
 * authored bounds), not as raw text. `4 × 10–15` and `4 × 10-15` differ only in
 * punctuation and describe the same work; splitting the lane on that would
 * strand real history behind a typographic change. Anything that changes what
 * is actually prescribed — the number of sets, the lower bound, the upper
 * bound — changes the fingerprint.
 *
 * Session INTENSITY is deliberately absent. It selects which ruleset applies to
 * a lane (see engine.ts), but it is a property of the session on the day, not
 * of the work: a Monday that changes from HARD to LIGHT has not made the loads
 * and reps already recorded on it incomparable.
 */

import { isLoadUnit, isSetLoad, type WorkoutLoadMode, type WorkoutLoadUnit, type WorkoutResultKind } from '../workoutLog'

/* ------------------------------------------------------------------ */
/* Lane identity                                                       */
/* ------------------------------------------------------------------ */

/** Everything that must match for two pieces of work to share a lane. */
export type ProgressionLane = {
  sessionId: string
  exerciseId: string
  /** Prescribed working sets. */
  setCount: number
  /** Authored lower bound of the rep/second range. */
  lower: number
  /** Authored upper bound. Equal to `lower` for a single-number target. */
  upper: number
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
}

/**
 * The lane as one comparable string.
 *
 * Versioned, so a future round that widens lane identity cannot silently make
 * old durable calibration rows look compatible with new semantics.
 */
export function laneFingerprint(lane: ProgressionLane): string {
  return [
    'v1',
    lane.sessionId,
    lane.exerciseId,
    lane.setCount,
    lane.lower,
    lane.upper,
    lane.resultKind,
    lane.loadMode,
    lane.perSide ? 'side' : 'both',
  ].join('|')
}

/** True when this lane's progression is judged in kilograms at all. */
export function isLoadedLane(lane: ProgressionLane): boolean {
  return lane.loadMode !== 'none'
}

/**
 * True when this lane is the shape DOUBLE PROGRESSION is defined for: a
 * repetition range performed against a load.
 *
 * A timed hold against a load is deliberately excluded. Trading seconds for
 * kilograms is not a rule this round was given, and inventing one would be
 * exactly the "arbitrary algorithm" the round forbids.
 */
export function isLoadedRepsLane(lane: ProgressionLane): boolean {
  return lane.resultKind === 'reps' && lane.loadMode !== 'none'
}

/** The unit a loaded lane records in, or null where load does not apply. */
export function laneLoadUnit(lane: ProgressionLane): WorkoutLoadUnit | null {
  return lane.loadMode === 'none' ? null : lane.loadMode
}

/* ------------------------------------------------------------------ */
/* Calibration vocabulary                                              */
/* ------------------------------------------------------------------ */

/**
 * What the user said about their first genuinely completed working set.
 *
 * This is a judgement about the load they actually moved, given after the fact.
 * It never edits that set: the completed set stays exactly as performed, and
 * the feedback only changes what is SUGGESTED for the sets still to come.
 */
export const CALIBRATION_FEEDBACKS = ['too_light', 'good', 'too_heavy'] as const

export type CalibrationFeedback = (typeof CALIBRATION_FEEDBACKS)[number]

export function isCalibrationFeedback(value: unknown): value is CalibrationFeedback {
  return (
    typeof value === 'string' && (CALIBRATION_FEEDBACKS as readonly string[]).includes(value)
  )
}

/**
 * A calibration record, as it is stored and read back.
 *
 * `observedLoad` is the load the feedback was ABOUT — the first completed
 * working set's recorded load at the moment the user judged it. It is stored so
 * the judgement can be checked against history rather than assumed: if that set
 * is later undone or corrected to a different load, the feedback no longer
 * describes anything real and is ignored.
 *
 * `chosenLoad` is a number the USER typed, never one this app computed. V2
 * models no authoritative hardware ladder, so "one step heavier" has no
 * numeric answer here; if the user tells us what they actually moved to, that
 * fact may be remembered so a reload does not lose it.
 */
export type CalibrationRecord = {
  feedback: CalibrationFeedback
  observedLoad: { value: number; unit: WorkoutLoadUnit }
  chosenLoad: { value: number; unit: WorkoutLoadUnit } | null
}

/** The validated body of a calibration write. */
export type CalibrationInput = {
  feedback: CalibrationFeedback
  chosenLoad: { value: number; unit: WorkoutLoadUnit } | null
}

/**
 * THE GOOD INVARIANT.
 *
 * "Good" is a statement about the load that was ACTUALLY LIFTED — the first
 * completed working set's recorded load. It cannot name a different number,
 * because a different number is not what the person did and not what they said
 * felt right. Only "too light" and "too heavy" ask for a load the person moved
 * to instead, and only those may carry one.
 *
 * This is the single definition of that rule. It is applied at the API
 * validation boundary, again when a judgement is written, and again when a
 * stored row is read back — so a Good row cannot carry a foreign load however
 * it got there: a direct API call, a future caller that skips the parser, or a
 * row written before this rule existed.
 */
export function chosenLoadFor(
  feedback: CalibrationFeedback,
  chosenLoad: { value: number; unit: WorkoutLoadUnit } | null,
): { value: number; unit: WorkoutLoadUnit } | null {
  return feedback === 'good' ? null : chosenLoad
}

export type CalibrationField = 'body' | 'feedback' | 'load' | 'unit'

export type ParsedCalibration =
  | { ok: true; value: CalibrationInput }
  | { ok: false; field: CalibrationField }

/**
 * Validate a calibration write.
 *
 * The account is never part of it, exactly as no other payload in this app
 * carries an identity. Neither is the observed load: that is read from stored
 * workout truth server-side, so a client cannot claim a first set it did not
 * complete.
 *
 * A chosen load sent alongside "good" is DROPPED rather than refused. The
 * payload is still well formed — the person did say the set felt right — and
 * the number simply has no meaning under that answer, so the honest result is
 * a Good judgement with no chosen load rather than a 400 for a field the
 * caller was allowed to send.
 */
export function parseCalibrationInput(body: unknown): ParsedCalibration {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  if (!isCalibrationFeedback(raw.feedback)) return { ok: false, field: 'feedback' }

  if (raw.chosenLoad === undefined || raw.chosenLoad === null) {
    return { ok: true, value: { feedback: raw.feedback, chosenLoad: null } }
  }
  if (typeof raw.chosenLoad !== 'object' || Array.isArray(raw.chosenLoad)) {
    return { ok: false, field: 'load' }
  }

  const load = raw.chosenLoad as Record<string, unknown>
  if (!isSetLoad(load.value)) return { ok: false, field: 'load' }
  if (!isLoadUnit(load.unit)) return { ok: false, field: 'unit' }

  return {
    ok: true,
    value: {
      feedback: raw.feedback,
      chosenLoad: chosenLoadFor(raw.feedback, { value: load.value, unit: load.unit }),
    },
  }
}
