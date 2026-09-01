/**
 * TRAINING PROGRESSION — derived, never stored.
 *
 * This module turns set-by-set workout history into next-session guidance for
 * one workout occurrence. It is a pure function over rows the caller has
 * already scoped to ONE account and ONE session: no storage, no clock, no
 * network, and no writes of any kind.
 *
 * ## What it is allowed to say
 *
 * A recommendation is guidance. It is never a result, never becomes history,
 * and never fills a logging field on its own. Actual workout truth is written
 * only when the user presses Complete, exactly as Round 08 established.
 *
 * ## Double progression, and nothing invented around it
 *
 * For a HARD loaded rep-range lane, the authored range IS the plan:
 *
 *   INCREASE_LOAD  every prescribed working set reached the UPPER bound, at one
 *                  comparable load, in one eligible occurrence
 *   BUILD_REPS     the load is held and the reps climb inside the range
 *   HOLD           anything between the two gates, including one weak session
 *   REDUCE_LOAD    TWO consecutive eligible occurrences at the SAME load where
 *                  every prescribed set fell below the LOWER bound
 *
 * Two scoping rules make those gates conservative rather than merely stated.
 *
 * The MOST RECENT occurrence of the lane governs — not the most recent one that
 * happens to be eligible. If last session cannot be read as evidence, the lane
 * holds; an older clean session is never allowed to speak over a newer unclear
 * one and quietly add load.
 *
 * "Consecutive" means consecutive in the lane's own timeline. The two strikes a
 * reduction needs must be the last two occurrences AND both eligible; a session
 * in between that could not be read breaks the pair rather than being stepped
 * over. Ambiguity never manufactures a strike.
 *
 * There is no "add one rep to every set", no estimated 1RM, no tonnage and no
 * automatic deload week. LIGHT and PUMP never use these gates at all, and work
 * with no load never grows a load.
 *
 * ## Fail closed
 *
 * Evidence only counts when it is unambiguous. A pending set, a skipped set, a
 * missing load, two different loads inside one occurrence, a unit that
 * disagrees with the lane, an unreadable stored enum, or two slots in one
 * workout that could equally be this lane — each of those stops automatic
 * movement rather than being smoothed over. An ambiguous history never
 * manufactures the strike that would reduce someone's load.
 */

import { loadUnitLabel } from '../workoutLog'
import type {
  WorkoutLoadMode,
  WorkoutLoadUnit,
  WorkoutResultKind,
  WorkoutSetStatus,
} from '../workoutLog'
import { isLoadMode, isLoadUnit, isResultKind, isSetStatus } from '../workoutLog'
import { parsePrescriptionTarget } from './prescription'
import {
  chosenLoadFor,
  isLoadedLane,
  isLoadedRepsLane,
  laneFingerprint,
  type CalibrationFeedback,
  type ProgressionLane,
} from './lane'
import { hardwareStep, type LoadStepDirection } from './hardware'

/* ------------------------------------------------------------------ */
/* Input — stored rows, exactly as history holds them                  */
/* ------------------------------------------------------------------ */

/**
 * One stored set row, unvalidated.
 *
 * Deliberately typed loosely for the persisted enums. The database constrains
 * them, but this module re-reads rather than assumes: a row it cannot read with
 * certainty must be able to fail the derivation closed instead of being cast
 * into a shape it may not have.
 */
export type ProgressionSetRow = {
  workoutDate: string
  exerciseOrder: number
  setIndex: number
  exerciseId: string
  exerciseName: string
  prescription: string
  resultKind: string
  loadMode: string
  perSide: number | boolean
  status: string
  loadValue: number | null
  loadUnit: string | null
  result: number | null
}

/** A durable calibration row, read back for the current occurrence. */
export type StoredCalibration = {
  exerciseOrder: number
  /** The lane the feedback was given for. Incompatible lanes never inherit it. */
  fingerprint: string
  feedback: CalibrationFeedback
  /** The first completed working set's load, as it was when judged. */
  observedLoad: { value: number; unit: WorkoutLoadUnit }
  /** A real load the USER chose. Never a number this app computed. */
  chosenLoad: { value: number; unit: WorkoutLoadUnit } | null
}

export type ProgressionInput = {
  /**
   * The session this occurrence belongs to.
   *
   * Carried into every lane fingerprint, so a fingerprint from Monday can never
   * equal one from Wednesday however identical the exercise and prescription
   * are. The caller scopes its reads to this session; nothing here re-derives it
   * from a row, so a stray row could not smuggle another session's work in.
   */
  sessionId: string
  /** The session's intensity, from the current occurrence's stored snapshot. */
  intensity: string
  /** Every stored set of the occurrence guidance is being shown for. */
  current: readonly ProgressionSetRow[]
  /** Every stored set of EARLIER occurrences of the same session. */
  history: readonly ProgressionSetRow[]
  /** Durable calibration for the current occurrence, keyed by exercise order. */
  calibration: readonly StoredCalibration[]
  /**
   * False when the history read could not prove it covered its window. A
   * recommendation derived from a history that might be missing occurrences
   * cannot be trusted, so every lane fails closed.
   */
  historyComplete: boolean
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

/**
 * The three vocabularies below are declared as LISTS, with their types derived
 * from them, exactly as the set statuses and load units are in workoutLog.ts.
 *
 * That is what lets a reader validate against them at runtime. The browser
 * receives these over the wire and must be able to refuse a value that is not
 * one of them rather than casting an arbitrary string into a union — and it
 * must be checking the same list the engine can actually produce, not a second
 * copy of it that can drift.
 */
export const PROGRESSION_STATES = [
  'calibrate',
  'build_reps',
  'increase_load',
  'hold',
  'reduce_load',
  'quality',
  'unavailable',
] as const

export type ProgressionState = (typeof PROGRESSION_STATES)[number]

export const PROGRESSION_REASON_CODES = [
  'no_comparable_history',
  'awaiting_first_set',
  'awaiting_feedback',
  'calibrated_good',
  'calibrated_too_light',
  'calibrated_too_heavy',
  'below_upper_bound',
  'all_sets_at_upper_bound',
  'single_weak_session',
  'two_weak_sessions',
  'evidence_incomplete',
  'quality_focus',
  'no_load_target',
  'ambiguous_slot',
  'ambiguous_history',
  'unreadable_history',
  'unreadable_intensity',
  'unreadable_prescription',
  'structure_mismatch',
  'history_truncated',
] as const

export type ProgressionReasonCode = (typeof PROGRESSION_REASON_CODES)[number]

/** Why an occurrence could not serve as automatic-progression evidence. */
export const EVIDENCE_GAPS = [
  'pending_set',
  'skipped_set',
  'missing_load',
  'mixed_load',
  'structure_mismatch',
] as const

export type EvidenceGap = (typeof EVIDENCE_GAPS)[number]

export function isProgressionState(value: unknown): value is ProgressionState {
  return typeof value === 'string' && (PROGRESSION_STATES as readonly string[]).includes(value)
}

export function isProgressionReasonCode(value: unknown): value is ProgressionReasonCode {
  return (
    typeof value === 'string' &&
    (PROGRESSION_REASON_CODES as readonly string[]).includes(value)
  )
}

export function isEvidenceGap(value: unknown): value is EvidenceGap {
  return typeof value === 'string' && (EVIDENCE_GAPS as readonly string[]).includes(value)
}

/** The authored target a lane is climbing, as written and as numbers. */
export type LaneTarget = {
  text: string
  lower: number
  upper: number
  resultKind: WorkoutResultKind
  perSide: boolean
  setCount: number
}

/** A factual reference to what was actually recorded, most recently. */
export type FactualReference = {
  date: string
  /** Every completed set's result, in set order. Facts only. */
  results: number[]
  /** The one comparable load every completed set shared, or null when they did not. */
  load: { value: number; unit: WorkoutLoadUnit } | null
  prescribed: number
  completed: number
  skipped: number
  pending: number
}

/** How far calibration has got for a lane with no comparable history. */
export type CalibrationView = {
  stage: 'awaiting_first_set' | 'awaiting_feedback' | 'settled'
  /** The first completed working set's recorded load. Real history. */
  observedLoad: { value: number; unit: WorkoutLoadUnit } | null
  feedback: CalibrationFeedback | null
  /** A load the user chose after judging the first set. */
  chosenLoad: { value: number; unit: WorkoutLoadUnit } | null
}

export type LaneRecommendation = {
  exerciseOrder: number
  exerciseId: string
  exerciseName: string
  prescription: string
  /** Null when no lane could be established for this slot. */
  fingerprint: string | null
  lane: ProgressionLane | null
  state: ProgressionState
  reasonCode: ProgressionReasonCode
  /** Which evidence gap held this lane, when one did. */
  gap: EvidenceGap | null
  /** One concise human sentence. Built here so every surface says the same thing. */
  reason: string
  /**
   * The load to carry into the next set, when history or the user's own
   * calibration establishes one. Always a recorded fact; never computed by
   * adding an increment this app made up.
   */
  suggestedLoad: { value: number; unit: WorkoutLoadUnit } | null
  /** Directional guidance where no authoritative ladder can name a number. */
  loadDirection: LoadStepDirection | null
  target: LaneTarget | null
  /** The most recent occurrence of this lane that recorded anything. */
  lastResult: FactualReference | null
  /** Present only while a lane is calibrating. */
  calibration: CalibrationView | null
}

/** Which ruleset a session's intensity selects. */
export type ProgressionRuleset = 'hard' | 'quality'

export type SessionProgression = {
  intensity: string
  /** Null when the stored intensity is not one this engine has rules for. */
  ruleset: ProgressionRuleset | null
  lanes: LaneRecommendation[]
}

/* ------------------------------------------------------------------ */
/* Reading stored rows                                                 */
/* ------------------------------------------------------------------ */

type SlotSet = {
  setIndex: number
  status: WorkoutSetStatus
  result: number | null
  load: { value: number; unit: WorkoutLoadUnit } | null
}

type SlotIdentity = {
  exerciseId: string
  exerciseName: string
  prescription: string
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
}

type SlotFacts = {
  exerciseOrder: number
  identity: SlotIdentity
  /** Null when the stored prescription names no usable authored target. */
  lane: ProgressionLane | null
  fingerprint: string | null
  sets: SlotSet[]
}

type ReadSlot = { ok: true; slot: SlotFacts } | { ok: false }

/**
 * Read one slot — every stored set of one exercise position in one workout.
 *
 * Returns a refusal rather than a guess whenever the stored truth cannot be
 * read with certainty: an enum outside its vocabulary, a completed set with no
 * result, a load without its unit, a load recorded in a unit the slot does not
 * use, or rows at one position that disagree about what exercise they are.
 *
 * A load unit that disagrees with the slot's own load mode is the sharpest of
 * these: 10 recorded as `kg_each` is twice the metal of 10 recorded as `kg`,
 * and a lane that averaged the two would recommend a weight nobody lifted.
 */
function readSlot(sessionId: string, rows: readonly ProgressionSetRow[]): ReadSlot {
  if (rows.length === 0) return { ok: false }

  const first = rows[0]
  if (typeof first.exerciseId !== 'string' || first.exerciseId.length === 0) {
    return { ok: false }
  }
  if (!isResultKind(first.resultKind)) return { ok: false }
  if (!isLoadMode(first.loadMode)) return { ok: false }
  // SQLite stores the flag as 0/1 and the app reads it as a boolean; anything
  // else is a value this column may not hold, and guessing would file per-side
  // reps and both-sides reps into one lane.
  if (
    first.perSide !== true &&
    first.perSide !== false &&
    first.perSide !== 0 &&
    first.perSide !== 1
  ) {
    return { ok: false }
  }
  const perSide = first.perSide === true || first.perSide === 1
  if (typeof first.prescription !== 'string') return { ok: false }

  const identity: SlotIdentity = {
    exerciseId: first.exerciseId,
    exerciseName: typeof first.exerciseName === 'string' ? first.exerciseName : first.exerciseId,
    prescription: first.prescription,
    resultKind: first.resultKind,
    loadMode: first.loadMode,
    perSide,
  }

  const sets: SlotSet[] = []
  const seen = new Set<number>()

  for (const row of rows) {
    // One position in one workout is one exercise. Rows that disagree cannot
    // be reconciled, and picking one of them would be inventing history.
    if (
      row.exerciseId !== identity.exerciseId ||
      row.prescription !== identity.prescription ||
      row.resultKind !== identity.resultKind ||
      row.loadMode !== identity.loadMode ||
      (row.perSide === true || row.perSide === 1) !== identity.perSide
    ) {
      return { ok: false }
    }

    if (!Number.isInteger(row.setIndex) || row.setIndex < 0) return { ok: false }
    if (seen.has(row.setIndex)) return { ok: false }
    seen.add(row.setIndex)

    if (!isSetStatus(row.status)) return { ok: false }

    // A load value and its unit travel together or not at all, so a stored
    // number can never lose the meaning of "each".
    if ((row.loadValue === null) !== (row.loadUnit === null)) return { ok: false }

    let load: { value: number; unit: WorkoutLoadUnit } | null = null
    if (row.loadValue !== null && row.loadUnit !== null) {
      if (!isLoadUnit(row.loadUnit)) return { ok: false }
      if (!Number.isFinite(row.loadValue) || row.loadValue < 0) return { ok: false }
      // Load recorded where load does not apply, or in the wrong sense.
      if (identity.loadMode === 'none') return { ok: false }
      if (row.loadUnit !== identity.loadMode) return { ok: false }
      load = { value: row.loadValue, unit: row.loadUnit }
    }

    if (row.status === 'completed') {
      if (!Number.isInteger(row.result) || (row.result as number) <= 0) return { ok: false }
    } else {
      // A pending or skipped set carries no result and no load. Anything else
      // would let an unperformed set read as work that happened.
      if (row.result !== null || load !== null) return { ok: false }
    }

    sets.push({
      setIndex: row.setIndex,
      status: row.status,
      result: row.status === 'completed' ? (row.result as number) : null,
      load,
    })
  }

  sets.sort((a, b) => a.setIndex - b.setIndex)

  // The authored target. Unparseable text is NOT corruption — it is simply a
  // prescription this round cannot judge a range against, so the slot exists
  // with no lane and takes part in nothing.
  const target = parsePrescriptionTarget(identity.prescription)
  const lane: ProgressionLane | null = target
    ? {
        sessionId,
        exerciseId: identity.exerciseId,
        setCount: target.setCount,
        lower: target.lower,
        upper: target.upper,
        resultKind: identity.resultKind,
        loadMode: identity.loadMode,
        perSide: identity.perSide,
      }
    : null

  return {
    ok: true,
    slot: {
      exerciseOrder: first.exerciseOrder,
      identity,
      lane,
      fingerprint: lane ? laneFingerprint(lane) : null,
      sets,
    },
  }
}

type ReadOccurrence = { ok: true; slots: SlotFacts[] } | { ok: false }

/** Read every slot of one workout occurrence, or refuse the whole occurrence. */
function readOccurrence(
  sessionId: string,
  rows: readonly ProgressionSetRow[],
): ReadOccurrence {
  const byOrder = new Map<number, ProgressionSetRow[]>()
  for (const row of rows) {
    if (!Number.isInteger(row.exerciseOrder) || row.exerciseOrder < 0) return { ok: false }
    const bucket = byOrder.get(row.exerciseOrder)
    if (bucket) bucket.push(row)
    else byOrder.set(row.exerciseOrder, [row])
  }

  const slots: SlotFacts[] = []
  for (const group of byOrder.values()) {
    const read = readSlot(sessionId, group)
    if (!read.ok) return { ok: false }
    slots.push(read.slot)
  }

  slots.sort((a, b) => a.exerciseOrder - b.exerciseOrder)
  return { ok: true, slots }
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

type Assessment =
  | { eligible: true; load: { value: number; unit: WorkoutLoadUnit } | null; results: number[] }
  | { eligible: false; gap: EvidenceGap }

/**
 * Can one occurrence of a lane serve as automatic-progression evidence?
 *
 * Every prescribed working set must have been completed, and — where the lane
 * is loaded — every one of them must carry a recorded load in the lane's own
 * unit, all at ONE comparable working load. Automatic progression evaluates a
 * single stable load; a session performed at two loads has no single load to
 * judge, and choosing one of them would be a fabrication.
 */
function assess(lane: ProgressionLane, slot: SlotFacts): Assessment {
  // The stored workout must have exactly the prescribed number of sets. Fewer
  // or more means the snapshot and the prescription disagree, and neither can
  // be trusted to say what "all sets" means.
  if (slot.sets.length !== lane.setCount) {
    return { eligible: false, gap: 'structure_mismatch' }
  }

  if (slot.sets.some((set) => set.status === 'pending')) {
    return { eligible: false, gap: 'pending_set' }
  }
  if (slot.sets.some((set) => set.status === 'skipped')) {
    return { eligible: false, gap: 'skipped_set' }
  }

  const results: number[] = []
  for (const set of slot.sets) {
    if (set.result === null) return { eligible: false, gap: 'structure_mismatch' }
    results.push(set.result)
  }

  if (!isLoadedLane(lane)) return { eligible: true, load: null, results }

  const loads: { value: number; unit: WorkoutLoadUnit }[] = []
  for (const set of slot.sets) {
    if (!set.load) return { eligible: false, gap: 'missing_load' }
    loads.push(set.load)
  }

  const load = loads[0]
  // One stable working load, or no automatic movement at all.
  if (loads.some((entry) => entry.value !== load.value || entry.unit !== load.unit)) {
    return { eligible: false, gap: 'mixed_load' }
  }

  return { eligible: true, load, results }
}

/** What one occurrence actually recorded, eligible or not. */
function summarise(lane: ProgressionLane, date: string, slot: SlotFacts): FactualReference {
  const completed = slot.sets.filter((set) => set.status === 'completed')
  const first = completed.find((set) => set.load !== null)?.load ?? null
  const sharedLoad =
    first !== null &&
    completed.length > 0 &&
    completed.every(
      (set) => set.load !== null && set.load.value === first.value && set.load.unit === first.unit,
    )
      ? first
      : null

  return {
    date,
    results: completed.map((set) => set.result as number),
    load: sharedLoad,
    prescribed: lane.setCount,
    completed: completed.length,
    skipped: slot.sets.filter((set) => set.status === 'skipped').length,
    pending: slot.sets.filter((set) => set.status === 'pending').length,
  }
}

type LaneOccurrence = {
  date: string
  slot: SlotFacts
  assessment: Assessment
  factual: FactualReference
}

type LaneEvidence =
  | { ok: true; occurrences: LaneOccurrence[] }
  /** History could not be attributed to this lane without guessing. */
  | { ok: false; reason: 'ambiguous_history' }

/**
 * Gather every earlier occurrence of one lane, oldest first.
 *
 * Matching is by the lane fingerprint, never by exercise position: an exercise
 * that moved from third to second in the session is the same work. Two slots in
 * ONE workout matching the same lane is the case that cannot be resolved —
 * there is no fact saying which of them continues the lane — so the whole lane
 * fails closed rather than merging or picking.
 */
function gatherEvidence(
  lane: ProgressionLane,
  fingerprint: string,
  occurrences: readonly { date: string; slots: SlotFacts[] }[],
): LaneEvidence {
  const found: LaneOccurrence[] = []

  for (const occurrence of occurrences) {
    const matches = occurrence.slots.filter((slot) => slot.fingerprint === fingerprint)
    if (matches.length === 0) continue
    if (matches.length > 1) return { ok: false, reason: 'ambiguous_history' }

    const slot = matches[0]
    found.push({
      date: occurrence.date,
      slot,
      assessment: assess(lane, slot),
      factual: summarise(lane, occurrence.date, slot),
    })
  }

  return { ok: true, occurrences: found }
}

/* ------------------------------------------------------------------ */
/* Human wording                                                       */
/* ------------------------------------------------------------------ */

function formatLoad(load: { value: number; unit: WorkoutLoadUnit }): string {
  return `${load.value}${loadUnitLabel(load.unit)}`
}

function formatResults(results: readonly number[], kind: WorkoutResultKind): string {
  const joined = results.join(' / ')
  return kind === 'seconds' ? `${joined}s` : joined
}

function formatTarget(lane: ProgressionLane): string {
  const range = lane.lower === lane.upper ? `${lane.lower}` : `${lane.lower}–${lane.upper}`
  return lane.resultKind === 'seconds' ? `${range}s` : range
}

function gapSentence(gap: EvidenceGap): string {
  switch (gap) {
    case 'pending_set':
      return 'the last session still has a set that was never resolved'
    case 'skipped_set':
      return 'a working set was skipped in the last session'
    case 'missing_load':
      return 'a working set in the last session recorded no load'
    case 'mixed_load':
      return 'the last session was performed at more than one load'
    case 'structure_mismatch':
      return 'the last session does not match this prescription'
  }
}

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

/**
 * The first working set of THIS occurrence that was genuinely completed with a
 * recorded load — the set calibration is a judgement about.
 *
 * Lowest set index wins, so it is the first working set and not merely the
 * first one that happened to be saved.
 */
function firstCompletedLoad(slot: SlotFacts): { value: number; unit: WorkoutLoadUnit } | null {
  for (const set of slot.sets) {
    if (set.status === 'completed' && set.load) return set.load
  }
  return null
}

/**
 * Read back a stored calibration, or ignore it.
 *
 * It is honoured only while it still describes something real:
 *
 *   - the lane semantics are unchanged (a changed prescription never inherits
 *     another lane's calibration)
 *   - the first completed working set still exists and still records the load
 *     the judgement was given about
 *
 * Undoing or correcting that set therefore returns the lane to awaiting a
 * fresh judgement, because the old one is no longer about anything.
 *
 * A stored "good" row's chosen load is dropped on the way in, whatever the
 * database happens to hold. Good means the load that was actually lifted, and
 * this read is the last place a row written before that rule — or around the
 * write path — could still make it mean something else.
 */
function readCalibration(
  stored: StoredCalibration | undefined,
  fingerprint: string,
  observed: { value: number; unit: WorkoutLoadUnit } | null,
): StoredCalibration | null {
  if (!stored) return null
  if (stored.fingerprint !== fingerprint) return null
  if (!observed) return null
  if (stored.observedLoad.value !== observed.value) return null
  if (stored.observedLoad.unit !== observed.unit) return null
  return { ...stored, chosenLoad: chosenLoadFor(stored.feedback, stored.chosenLoad) }
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Which ruleset a stored session intensity selects, or null.
 *
 * THREE intensities exist in the accepted training week, and each one names
 * the rules that apply to it. Anything else is a value this engine has no
 * rules for, and it must not be quietly absorbed into the gentler one: reading
 * an unknown intensity as QUALITY would answer with confidence about a session
 * whose character is unknown, and a HARD session mis-stored would silently
 * stop progressing. Null is the honest answer, and it produces no guidance.
 */
function readRuleset(intensity: string): ProgressionRuleset | null {
  if (intensity === 'HARD') return 'hard'
  if (intensity === 'LIGHT' || intensity === 'PUMP') return 'quality'
  return null
}

function unavailable(
  slot: SlotFacts,
  reasonCode: ProgressionReasonCode,
  reason: string,
  lastResult: FactualReference | null = null,
): LaneRecommendation {
  return {
    exerciseOrder: slot.exerciseOrder,
    exerciseId: slot.identity.exerciseId,
    exerciseName: slot.identity.exerciseName,
    prescription: slot.identity.prescription,
    fingerprint: slot.fingerprint,
    lane: slot.lane,
    state: 'unavailable',
    reasonCode,
    gap: null,
    reason,
    suggestedLoad: null,
    loadDirection: null,
    target: slot.lane ? laneTarget(slot.lane) : null,
    lastResult,
    calibration: null,
  }
}

function laneTarget(lane: ProgressionLane): LaneTarget {
  return {
    text: formatTarget(lane),
    lower: lane.lower,
    upper: lane.upper,
    resultKind: lane.resultKind,
    perSide: lane.perSide,
    setCount: lane.setCount,
  }
}

/**
 * Derive guidance for every exercise slot of one workout occurrence.
 *
 * `input.history` must contain only EARLIER occurrences of the same session for
 * the same account. Today's own occurrence is never its own evidence: guidance
 * is for the work still ahead, and a half-logged session would otherwise judge
 * itself.
 */
export function deriveSessionProgression(input: ProgressionInput): SessionProgression {
  const ruleset = readRuleset(input.intensity)
  const sessionId = input.sessionId

  const currentRead = readOccurrence(sessionId, input.current)
  if (!currentRead.ok) {
    // The workout being guided cannot itself be read. No lane can be
    // established from it, so no guidance is offered at all — the honest
    // outcome, and the one that cannot mislead. Logging is unaffected.
    return { intensity: input.intensity, ruleset, lanes: [] }
  }

  // Historical occurrences, oldest first. One session has at most one
  // occurrence per local date, so the date is a total chronological order.
  const byDate = new Map<string, ProgressionSetRow[]>()
  for (const row of input.history) {
    const bucket = byDate.get(row.workoutDate)
    if (bucket) bucket.push(row)
    else byDate.set(row.workoutDate, [row])
  }

  let historyReadable = true
  const past: { date: string; slots: SlotFacts[] }[] = []
  for (const date of [...byDate.keys()].sort()) {
    const read = readOccurrence(sessionId, byDate.get(date) as ProgressionSetRow[])
    if (!read.ok) {
      historyReadable = false
      break
    }
    past.push({ date, slots: read.slots })
  }

  // Two slots of THIS workout that resolve to one lane cannot be told apart.
  const laneCount = new Map<string, number>()
  for (const slot of currentRead.slots) {
    if (!slot.fingerprint) continue
    laneCount.set(slot.fingerprint, (laneCount.get(slot.fingerprint) ?? 0) + 1)
  }

  const calibrationByOrder = new Map<number, StoredCalibration>()
  for (const row of input.calibration) calibrationByOrder.set(row.exerciseOrder, row)

  const lanes = currentRead.slots.map((slot) =>
    // An intensity with no ruleset stops before any lane is judged. It is a
    // property of the whole session, so no exercise in it can be guided.
    ruleset === null
      ? unavailable(
          slot,
          'unreadable_intensity',
          'This session’s intensity is not one this engine has rules for, so no guidance is derived.',
        )
      : deriveLane({
          slot,
          ruleset,
          past,
          historyReadable,
          historyComplete: input.historyComplete,
          duplicate: slot.fingerprint ? (laneCount.get(slot.fingerprint) ?? 0) > 1 : false,
          calibration: calibrationByOrder.get(slot.exerciseOrder),
        }),
  )

  return { intensity: input.intensity, ruleset, lanes }
}

function deriveLane(context: {
  slot: SlotFacts
  ruleset: ProgressionRuleset
  past: { date: string; slots: SlotFacts[] }[]
  historyReadable: boolean
  historyComplete: boolean
  duplicate: boolean
  calibration: StoredCalibration | undefined
}): LaneRecommendation {
  const { slot, ruleset, past, duplicate } = context

  if (!slot.lane || !slot.fingerprint) {
    return unavailable(
      slot,
      'unreadable_prescription',
      'This prescription has no target range this engine can judge, so no guidance is offered.',
    )
  }
  const lane = slot.lane
  const fingerprint = slot.fingerprint

  if (duplicate) {
    return unavailable(
      slot,
      'ambiguous_slot',
      'This exercise appears twice in this session with the same prescription, so history cannot be attributed to one of them.',
    )
  }

  if (!context.historyReadable) {
    return unavailable(
      slot,
      'unreadable_history',
      'Part of this session’s recorded history could not be read, so no guidance is derived from it.',
    )
  }

  if (!context.historyComplete) {
    return unavailable(
      slot,
      'history_truncated',
      'This session’s history could not be read in full, so no guidance is derived from it.',
    )
  }

  const evidence = gatherEvidence(lane, fingerprint, past)
  if (!evidence.ok) {
    return unavailable(
      slot,
      'ambiguous_history',
      'An earlier session recorded this exercise twice with the same prescription, so its history cannot be attributed.',
    )
  }

  const occurrences = evidence.occurrences
  const lastRecorded =
    [...occurrences].reverse().find((entry) => entry.factual.completed > 0)?.factual ?? null
  const target = laneTarget(lane)

  const base = {
    exerciseOrder: slot.exerciseOrder,
    exerciseId: lane.exerciseId,
    exerciseName: slot.identity.exerciseName,
    prescription: slot.identity.prescription,
    fingerprint,
    lane,
    target,
    lastResult: lastRecorded,
  }

  /* ---- work with no load never grows one -------------------------- */

  if (!isLoadedLane(lane)) {
    return {
      ...base,
      state: 'quality',
      reasonCode: 'no_load_target',
      gap: null,
      reason: `Bodyweight work — keep the authored ${target.text} target and the quality of each rep.`,
      suggestedLoad: null,
      loadDirection: null,
      calibration: null,
    }
  }

  /* ---- no comparable load history yet: calibrate ------------------- */

  // "Comparable history" for a loaded lane means a load was actually recorded
  // against a completed set. Reps logged without their weight are real history
  // and no comparable load at all, so the lane still starts by calibrating.
  const hasComparableLoad = occurrences.some((entry) =>
    entry.slot.sets.some((set) => set.status === 'completed' && set.load !== null),
  )

  if (!hasComparableLoad) {
    return calibrateLane(base, slot, context.calibration)
  }

  /* ---- LIGHT / PUMP: quality first, never chasing load ------------- */

  // The MOST RECENT occurrence of the lane governs — not the most recent one
  // that happens to be eligible. Guidance describes the last session, and an
  // older clean session must not speak over a newer one that cannot be read.
  const latest = occurrences.length > 0 ? occurrences[occurrences.length - 1] : null
  const latestAssessment = latest?.assessment
  const latestLoad =
    latestAssessment && latestAssessment.eligible ? latestAssessment.load : null

  if (ruleset !== 'hard') {
    return {
      ...base,
      state: 'quality',
      reasonCode: 'quality_focus',
      gap: null,
      reason: lastRecorded
        ? `Control and quality, not more load. Last time: ${formatResults(lastRecorded.results, lane.resultKind)}${lastRecorded.load ? ` at ${formatLoad(lastRecorded.load)}` : ''}.`
        : 'Control and quality, not more load.',
      // The same load as last time is a fact, never an increase.
      suggestedLoad: lastRecorded?.load ?? null,
      loadDirection: null,
      calibration: null,
    }
  }

  /* ---- HARD: double progression ----------------------------------- */

  if (!isLoadedRepsLane(lane)) {
    return {
      ...base,
      state: 'quality',
      reasonCode: 'no_load_target',
      gap: null,
      reason: `Timed work — keep the authored ${target.text} target rather than chasing load.`,
      suggestedLoad: lastRecorded?.load ?? null,
      loadDirection: null,
      calibration: null,
    }
  }

  if (!latest || !latestAssessment || !latestAssessment.eligible || !latestLoad) {
    // There IS comparable history, but the most recent occurrence cannot carry
    // a gate. Hold: incomplete or ambiguous evidence must never move a load in
    // either direction, and it must never manufacture a strike towards one.
    const gap = latestAssessment && !latestAssessment.eligible ? latestAssessment.gap : null

    return {
      ...base,
      state: 'hold',
      reasonCode: 'evidence_incomplete',
      gap,
      reason: `Holding: ${gap ? gapSentence(gap) : 'the last session cannot be compared'}, so no change is recommended.`,
      suggestedLoad: lastRecorded?.load ?? null,
      loadDirection: null,
      calibration: null,
    }
  }

  const results = latestAssessment.results

  // INCREASE — every prescribed working set reached or passed the upper bound
  // at one comparable load.
  if (results.every((value) => value >= lane.upper)) {
    const step = hardwareStep(latestLoad, 'increase')
    return {
      ...base,
      state: 'increase_load',
      reasonCode: 'all_sets_at_upper_bound',
      gap: null,
      reason: `Every set reached ${lane.upper} at ${formatLoad(latestLoad)}. Increase one available step.`,
      // Only a real ladder may name the next number; V2 has none.
      suggestedLoad: step.known ? { value: step.value, unit: step.unit } : null,
      loadDirection: 'increase',
      calibration: null,
    }
  }

  // REDUCE — two CONSECUTIVE eligible occurrences, same load, every prescribed
  // set below the authored lower bound. One such session is not a trend.
  if (results.every((value) => value < lane.lower)) {
    // The occurrence immediately before this one — consecutive in the lane's
    // own timeline. A session that could not be read does not become a strike
    // by being skipped over, so an unreadable one in between breaks the pair.
    const previous = occurrences.length >= 2 ? occurrences[occurrences.length - 2] : null
    const previousAssessment = previous?.assessment
    const strikeTwice =
      previousAssessment !== undefined &&
      previousAssessment.eligible &&
      previousAssessment.load !== null &&
      previousAssessment.load.value === latestLoad.value &&
      previousAssessment.load.unit === latestLoad.unit &&
      previousAssessment.results.every((value) => value < lane.lower)

    if (strikeTwice) {
      const step = hardwareStep(latestLoad, 'reduce')
      return {
        ...base,
        state: 'reduce_load',
        reasonCode: 'two_weak_sessions',
        gap: null,
        reason: `Two sessions in a row under ${lane.lower} at ${formatLoad(latestLoad)}. Reduce one available step.`,
        suggestedLoad: step.known ? { value: step.value, unit: step.unit } : null,
        loadDirection: 'reduce',
        calibration: null,
      }
    }

    return {
      ...base,
      state: 'hold',
      reasonCode: 'single_weak_session',
      gap: null,
      reason: `Last session was under ${lane.lower} at ${formatLoad(latestLoad)}. Hold this load — one session is not a trend.`,
      suggestedLoad: latestLoad,
      loadDirection: null,
      calibration: null,
    }
  }

  // BUILD — hold the load that is working and climb inside the authored range.
  return {
    ...base,
    state: 'build_reps',
    reasonCode: 'below_upper_bound',
    gap: null,
    reason: `Last time ${formatResults(results, lane.resultKind)} at ${formatLoad(latestLoad)}. Keep ${formatLoad(latestLoad)} and build towards ${lane.upper} on every set.`,
    suggestedLoad: latestLoad,
    loadDirection: null,
    calibration: null,
  }
}

/** The CALIBRATE lane: a loaded lane with no comparable load history yet. */
function calibrateLane(
  base: {
    exerciseOrder: number
    exerciseId: string
    exerciseName: string
    prescription: string
    fingerprint: string
    lane: ProgressionLane
    target: LaneTarget
    lastResult: FactualReference | null
  },
  slot: SlotFacts,
  stored: StoredCalibration | undefined,
): LaneRecommendation {
  const observed = firstCompletedLoad(slot)
  const calibration = readCalibration(stored, base.fingerprint, observed)

  if (!observed) {
    return {
      ...base,
      state: 'calibrate',
      reasonCode: 'awaiting_first_set',
      gap: null,
      reason: `No comparable history in this session yet. Complete the first working set with the load you actually used, then say how it felt.`,
      suggestedLoad: null,
      loadDirection: null,
      calibration: {
        stage: 'awaiting_first_set',
        observedLoad: null,
        feedback: null,
        chosenLoad: null,
      },
    }
  }

  if (!calibration) {
    return {
      ...base,
      state: 'calibrate',
      reasonCode: 'awaiting_feedback',
      gap: null,
      reason: `First set recorded at ${formatLoad(observed)}. How did that feel?`,
      suggestedLoad: null,
      loadDirection: null,
      calibration: {
        stage: 'awaiting_feedback',
        observedLoad: observed,
        feedback: null,
        chosenLoad: null,
      },
    }
  }

  const view: CalibrationView = {
    stage: 'settled',
    observedLoad: observed,
    feedback: calibration.feedback,
    chosenLoad: calibration.chosenLoad,
  }

  if (calibration.feedback === 'good') {
    return {
      ...base,
      state: 'calibrate',
      reasonCode: 'calibrated_good',
      gap: null,
      reason: `${formatLoad(observed)} felt right. Keep it for the remaining sets and aim for ${base.target.text}.`,
      // ALWAYS the load the first completed working set actually recorded — a
      // fact from this workout. Good cannot suggest anything else, so this is
      // not a fallback and there is no other branch it can take.
      suggestedLoad: observed,
      loadDirection: null,
      calibration: view,
    }
  }

  const direction: LoadStepDirection =
    calibration.feedback === 'too_light' ? 'increase' : 'reduce'
  const word = direction === 'increase' ? 'heavier' : 'lighter'
  const step = hardwareStep(observed, direction)
  const chosen =
    calibration.chosenLoad ?? (step.known ? { value: step.value, unit: step.unit } : null)

  return {
    ...base,
    state: 'calibrate',
    reasonCode:
      calibration.feedback === 'too_light' ? 'calibrated_too_light' : 'calibrated_too_heavy',
    gap: null,
    reason: chosen
      ? `${formatLoad(observed)} was too ${direction === 'increase' ? 'light' : 'heavy'}. Working from ${formatLoad(chosen)} for the remaining sets.`
      : `${formatLoad(observed)} was too ${direction === 'increase' ? 'light' : 'heavy'}. Move one available step ${word} and record the load you actually use.`,
    suggestedLoad: chosen,
    loadDirection: direction,
    calibration: view,
  }
}
