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

import type { WorkoutLoadUnit } from '@shared/workoutLog'
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
import type { CalibrationFeedback } from '@shared/progression/lane'

export type {
  CalibrationView,
  EvidenceGap,
  FactualReference,
  LaneRecommendation,
  LaneTarget,
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

const STATES: readonly ProgressionState[] = [
  'calibrate',
  'build_reps',
  'increase_load',
  'hold',
  'reduce_load',
  'quality',
  'unavailable',
]

function toLoad(raw: unknown): ProgressionLoad | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Partial<ProgressionLoad>
  if (typeof row.value !== 'number') return null
  if (row.unit !== 'kg' && row.unit !== 'kg_each') return null
  return { value: row.value, unit: row.unit }
}

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
  const feedback = row.feedback
  return {
    stage: row.stage,
    observedLoad: toLoad(row.observedLoad),
    feedback:
      feedback === 'too_light' || feedback === 'good' || feedback === 'too_heavy'
        ? feedback
        : null,
    chosenLoad: toLoad(row.chosenLoad),
  }
}

function toTarget(raw: unknown): LaneTarget | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.text !== 'string') return null
  if (typeof row.lower !== 'number' || typeof row.upper !== 'number') return null
  if (row.resultKind !== 'reps' && row.resultKind !== 'seconds') return null
  if (typeof row.setCount !== 'number') return null
  return {
    text: row.text,
    lower: row.lower,
    upper: row.upper,
    resultKind: row.resultKind,
    perSide: row.perSide === true,
    setCount: row.setCount,
  }
}

function toLastResult(raw: unknown): FactualReference | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.date !== 'string') return null
  const results = Array.isArray(row.results)
    ? row.results.filter((value): value is number => typeof value === 'number')
    : []
  return {
    date: row.date,
    results,
    load: toLoad(row.load),
    prescribed: typeof row.prescribed === 'number' ? row.prescribed : 0,
    completed: typeof row.completed === 'number' ? row.completed : 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    pending: typeof row.pending === 'number' ? row.pending : 0,
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
  if (typeof row.exerciseOrder !== 'number') return null
  if (typeof row.exerciseId !== 'string') return null
  if (!STATES.includes(row.state as ProgressionState)) return null
  if (typeof row.reason !== 'string' || typeof row.reasonCode !== 'string') return null

  return {
    exerciseOrder: row.exerciseOrder,
    exerciseId: row.exerciseId,
    exerciseName: typeof row.exerciseName === 'string' ? row.exerciseName : row.exerciseId,
    prescription: typeof row.prescription === 'string' ? row.prescription : '',
    fingerprint: typeof row.fingerprint === 'string' ? row.fingerprint : null,
    // The lane identity itself is server-side truth; the browser never rebuilds
    // one, so it is carried opaquely and only used for display keys.
    lane: null,
    state: row.state as ProgressionState,
    reasonCode: row.reasonCode as ProgressionReasonCode,
    gap: (row.gap ?? null) as EvidenceGap | null,
    reason: row.reason,
    suggestedLoad: toLoad(row.suggestedLoad),
    loadDirection:
      row.loadDirection === 'increase' || row.loadDirection === 'reduce'
        ? row.loadDirection
        : null,
    target: toTarget(row.target),
    lastResult: toLastResult(row.lastResult),
    calibration: toCalibration(row.calibration),
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
