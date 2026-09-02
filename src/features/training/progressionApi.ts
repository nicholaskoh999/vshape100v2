/**
 * Training progression client.
 *
 * Guidance is DERIVED on the server from stored workout history, so this module
 * only ever reads it. It never computes a recommendation, never caches one, and
 * never writes or reads localStorage, sessionStorage or IndexedDB — the only
 * persistence is the server, and the session travels in the existing HttpOnly
 * cookie, which React can never see. A refresh re-reads; it never replays.
 *
 * The one thing it can write is a CALIBRATION judgement: the user's own words
 * about how their first completed working set felt, plus, if they choose to
 * name it, the real load they moved to. Both are theirs, and neither touches
 * the completed set itself.
 */

import { isWorkoutInputType } from '../../../shared/workoutInput'
import { isSetLoad, isSetResult, type WorkoutLoadUnit } from '@shared/workoutLog'
import {
  isEvidenceGap,
  isProgressionReasonCode,
  isProgressionState,
} from '@shared/progression/engine'
import type {
  CalibrationView,
  EvidenceGap,
  FactualReference,
  LaneRecommendation,
  LaneTarget,
  ProgressionReasonCode,
  ProgressionRuleset,
  ProgressionState,
} from '@shared/progression/engine'
import { isCalibrationFeedback } from '@shared/progression/lane'
import type { CalibrationFeedback, ProgressionLane } from '@shared/progression/lane'

export type {
  CalibrationView,
  EvidenceGap,
  FactualReference,
  LaneRecommendation,
  LaneTarget,
  ProgressionLane,
  ProgressionReasonCode,
  ProgressionRuleset,
  ProgressionState,
}

export type ProgressionLoad = { value: number; unit: WorkoutLoadUnit }

/** Guidance for one workout occurrence, exactly as the server derived it. */
export type SessionGuidance = {
  date: string
  sessionId: string
  /** False when the account has not started this workout. */
  started: boolean
  intensity: string | null
  ruleset: ProgressionRuleset | null
  lanes: LaneRecommendation[]
}

export class ProgressionApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ProgressionApiError'
    this.status = status
  }
}

const BASE = '/api/progression'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

function occurrenceUrl(date: string, sessionId: string): string {
  return `${BASE}/${encodeURIComponent(date)}/${encodeURIComponent(sessionId)}`
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return
  throw new ProgressionApiError(
    `Progression request failed (${response.status})`,
    response.status,
  )
}

/* ------------------------------------------------------------------ */
/* Wire → app                                                          */
/* ------------------------------------------------------------------ */

/** A whole number of things: a set count, a rep target, a position. */
function isWholeNumber(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
}

/**
 * A load, or null when it is not one.
 *
 * `isSetLoad` is the same bound the server accepts when STORING a load, so a
 * value the database could never hold — NaN, Infinity, a negative weight — is
 * refused here rather than reaching an input or a suggestion.
 */
function toLoad(raw: unknown): ProgressionLoad | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Partial<ProgressionLoad>
  if (!isSetLoad(row.value)) return null
  if (row.unit !== 'kg' && row.unit !== 'kg_each') return null
  return { value: row.value, unit: row.unit }
}

/** True when a field was sent at all. Absent and null both mean "none". */
function present(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * The calibration block, or null when it is not a coherent one.
 *
 * The three stages are not decoration — they decide whether the Too light /
 * Good / Too heavy buttons appear and what they mean — so each one is checked
 * against what it CLAIMS:
 *
 *   awaiting_first_set  nothing has been judged, so nothing may be attached
 *   awaiting_feedback   a first set exists, so its load must be there
 *   settled             a judgement was made, so both it and its load must be
 *
 * A block that contradicts its own stage is refused rather than half-rendered.
 */
function toCalibration(raw: unknown): CalibrationView | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (
    row.stage !== 'awaiting_first_set' &&
    row.stage !== 'awaiting_feedback' &&
    row.stage !== 'settled'
  ) {
    return null
  }

  const observedLoad = toLoad(row.observedLoad)
  if (present(row.observedLoad) && observedLoad === null) return null

  const chosenLoad = toLoad(row.chosenLoad)
  if (present(row.chosenLoad) && chosenLoad === null) return null

  if (present(row.feedback) && !isCalibrationFeedback(row.feedback)) return null
  const feedback = isCalibrationFeedback(row.feedback) ? row.feedback : null

  if (row.stage === 'awaiting_first_set') {
    if (observedLoad !== null || feedback !== null || chosenLoad !== null) return null
  }
  if (row.stage === 'awaiting_feedback') {
    if (observedLoad === null || feedback !== null) return null
  }
  if (row.stage === 'settled') {
    if (observedLoad === null || feedback === null) return null
  }

  return { stage: row.stage, observedLoad, feedback, chosenLoad }
}

/**
 * The lane identity, read back for display only.
 *
 * The browser never BUILDS one: lane identity is server-side truth, derived
 * from the stored snapshot. Reading it back lets a surface show what work a
 * recommendation is about without re-deriving anything.
 */
function toLaneIdentity(raw: unknown): ProgressionLane | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.sessionId !== 'string' || row.sessionId.length === 0) return null
  if (typeof row.exerciseId !== 'string' || row.exerciseId.length === 0) return null
  if (!isWholeNumber(row.setCount, 1)) return null
  if (!isWholeNumber(row.lower, 1) || !isWholeNumber(row.upper, 1)) return null
  if (row.lower > row.upper) return null
  if (row.resultKind !== 'reps' && row.resultKind !== 'seconds') return null
  if (row.loadMode !== 'none' && row.loadMode !== 'kg' && row.loadMode !== 'kg_each') {
    return null
  }
  // A real boolean, not "anything that is not true". Per-side reps and
  // both-sides reps are different work, and a coerced flag would quietly pick
  // one of them.
  if (typeof row.perSide !== 'boolean') return null
  // Round 20. Re-checked like every other persisted enum: an input type this
  // build cannot name means the lane cannot be read, not that it is kilograms.
  if (!isWorkoutInputType(row.inputType)) return null

  return {
    sessionId: row.sessionId,
    exerciseId: row.exerciseId,
    inputType: row.inputType,
    setCount: row.setCount,
    lower: row.lower,
    upper: row.upper,
    resultKind: row.resultKind,
    loadMode: row.loadMode,
    perSide: row.perSide,
  }
}

function toTarget(raw: unknown): LaneTarget | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.text !== 'string' || row.text.length === 0) return null
  if (!isWholeNumber(row.lower, 1) || !isWholeNumber(row.upper, 1)) return null
  if (row.lower > row.upper) return null
  if (row.resultKind !== 'reps' && row.resultKind !== 'seconds') return null
  if (!isWholeNumber(row.setCount, 1)) return null
  if (typeof row.perSide !== 'boolean') return null

  return {
    text: row.text,
    lower: row.lower,
    upper: row.upper,
    resultKind: row.resultKind,
    perSide: row.perSide,
    setCount: row.setCount,
  }
}

/**
 * The factual reference, or null when it is not a whole one.
 *
 * A result list is accepted only if EVERY entry is a real recorded result.
 * Filtering out the bad ones would silently shorten the row and show a session
 * as having fewer sets than it did.
 */
function toLastResult(raw: unknown): FactualReference | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.date !== 'string' || row.date.length === 0) return null
  if (!Array.isArray(row.results)) return null
  if (!row.results.every((value) => isSetResult(value))) return null
  if (present(row.load) && toLoad(row.load) === null) return null
  for (const count of [row.prescribed, row.completed, row.skipped, row.pending]) {
    if (!isWholeNumber(count, 0)) return null
  }

  return {
    date: row.date,
    results: row.results as number[],
    load: toLoad(row.load),
    prescribed: row.prescribed as number,
    completed: row.completed as number,
    skipped: row.skipped as number,
    pending: row.pending as number,
  }
}

/**
 * Read one lane, or return null for anything that is not a full row.
 *
 * A row that cannot be read is dropped rather than half-rendered: an exercise
 * with no guidance simply shows no guidance, which is the honest outcome.
 */
function toLane(raw: unknown): LaneRecommendation | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>

  if (!isWholeNumber(row.exerciseOrder, 0)) return null
  if (typeof row.exerciseId !== 'string' || row.exerciseId.length === 0) return null
  if (typeof row.reason !== 'string' || row.reason.length === 0) return null

  // The three vocabularies are checked against the lists the engine itself is
  // built from, so an arbitrary string cannot enter the app wearing the type
  // of a state, a reason or an evidence gap.
  if (!isProgressionState(row.state)) return null
  if (!isProgressionReasonCode(row.reasonCode)) return null
  if (present(row.gap) && !isEvidenceGap(row.gap)) return null

  // EVERY sub-object fails the whole lane when it is present and unreadable.
  // Quietly nulling one would leave a panel that still reads like guidance
  // while the thing it describes — the suggestion, the target, the last
  // session, the calibration buttons — has silently gone missing.
  const suggestedLoad = toLoad(row.suggestedLoad)
  if (present(row.suggestedLoad) && suggestedLoad === null) return null

  const loadDirection =
    row.loadDirection === 'increase' || row.loadDirection === 'reduce'
      ? row.loadDirection
      : null
  if (present(row.loadDirection) && loadDirection === null) return null

  const calibration = toCalibration(row.calibration)
  if (present(row.calibration) && calibration === null) return null

  const lane = toLaneIdentity(row.lane)
  if (present(row.lane) && lane === null) return null

  const target = toTarget(row.target)
  if (present(row.target) && target === null) return null

  const lastResult = toLastResult(row.lastResult)
  if (present(row.lastResult) && lastResult === null) return null

  return {
    exerciseOrder: row.exerciseOrder,
    exerciseId: row.exerciseId,
    exerciseName: typeof row.exerciseName === 'string' ? row.exerciseName : row.exerciseId,
    prescription: typeof row.prescription === 'string' ? row.prescription : '',
    fingerprint: typeof row.fingerprint === 'string' ? row.fingerprint : null,
    lane,
    state: row.state,
    reasonCode: row.reasonCode,
    gap: isEvidenceGap(row.gap) ? row.gap : null,
    reason: row.reason,
    suggestedLoad,
    loadDirection,
    target,
    lastResult,
    calibration,
  }
}

function toGuidance(body: unknown, date: string, sessionId: string): SessionGuidance {
  const raw = (body ?? {}) as Record<string, unknown>
  const lanes = Array.isArray(raw.lanes)
    ? raw.lanes.map(toLane).filter((row): row is LaneRecommendation => row !== null)
    : []
  return {
    date: typeof raw.date === 'string' ? raw.date : date,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : sessionId,
    started: raw.started === true,
    intensity: typeof raw.intensity === 'string' ? raw.intensity : null,
    ruleset: raw.ruleset === 'hard' || raw.ruleset === 'quality' ? raw.ruleset : null,
    lanes,
  }
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

/** Derived guidance for one date + session. */
export async function fetchProgression(
  date: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionGuidance> {
  const response = await fetch(occurrenceUrl(date, sessionId), { ...REQUEST_INIT, signal })
  await ensureOk(response)
  return toGuidance(await response.json(), date, sessionId)
}

function calibrationUrl(date: string, sessionId: string, exerciseOrder: number): string {
  return `${occurrenceUrl(date, sessionId)}/calibration/${exerciseOrder}`
}

/**
 * Record how the first completed working set felt.
 *
 * `chosenLoad` is optional and is a number the USER typed. The server reads the
 * observed load from stored workout truth rather than accepting one here, so a
 * client cannot claim a first set it did not complete.
 */
export async function saveCalibration(
  date: string,
  sessionId: string,
  exerciseOrder: number,
  entry: { feedback: CalibrationFeedback; chosenLoad: ProgressionLoad | null },
  signal?: AbortSignal,
): Promise<SessionGuidance> {
  const response = await fetch(calibrationUrl(date, sessionId, exerciseOrder), {
    ...REQUEST_INIT,
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback: entry.feedback, chosenLoad: entry.chosenLoad }),
    signal,
  })
  await ensureOk(response)
  return toGuidance(await response.json(), date, sessionId)
}

/** Clear a calibration judgement. The completed set it described is untouched. */
export async function clearCalibration(
  date: string,
  sessionId: string,
  exerciseOrder: number,
  signal?: AbortSignal,
): Promise<SessionGuidance> {
  const response = await fetch(calibrationUrl(date, sessionId, exerciseOrder), {
    ...REQUEST_INIT,
    method: 'DELETE',
    signal,
  })
  await ensureOk(response)
  return toGuidance(await response.json(), date, sessionId)
}
