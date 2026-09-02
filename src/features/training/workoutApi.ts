/**
 * Workout logging client.
 *
 * D1 is the durable source of truth for logged sets. This module never reads
 * or writes localStorage, sessionStorage or IndexedDB — the only persistence
 * is the server, and the session travels in the existing HttpOnly cookie,
 * which React can never see. A refresh re-reads; it never replays a cache.
 */

import {
  isWorkoutInputType,
  parseBandCount,
  parseBandLabel,
  type WorkoutInputType,
} from '@shared/workoutInput'
import { readProvenance, type WorkoutKind } from '@shared/workoutLog'
import type {
  WorkoutLoadMode,
  WorkoutLoadUnit,
  WorkoutResultKind,
  WorkoutSetStatus,
} from '@shared/workoutLog'

export type WorkoutLoad = { value: number; unit: WorkoutLoadUnit }

/** One occurrence header as the API returns it. Historical, frozen at Start. */
export type WorkoutOccurrence = {
  date: string
  sessionId: string
  /** Persisted provenance: the scheduled obligation, or a voluntary Extra. */
  kind: WorkoutKind
  /** The Foundation session an Extra was copied from. Null when scheduled. */
  sourceSessionId: string | null
  day: string
  focus: string
  intensity: string
  startedAt: number
  updatedAt: number
}

/** One expected set: its frozen snapshot plus whatever has been logged. */
export type WorkoutSet = {
  exerciseOrder: number
  setIndex: number
  exerciseId: string
  exerciseName: string
  prescription: string
  equipment: string | null
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  /**
   * How this set is loaded, frozen when the workout was started.
   *
   * Null means the server could not read the stored modality. The controls must
   * refuse to log against it rather than fall back to kilograms — that fallback
   * is the whole reason this field exists.
   */
  inputType: WorkoutInputType | null
  status: WorkoutSetStatus
  load: WorkoutLoad | null
  /** The band actually used. Only ever present on a completed band set. */
  band: WorkoutBand | null
  result: number | null
  updatedAt: number
  /**
   * When this set's recorded performance was last corrected, or null if it
   * never was. Read from the immutable audit, so the "Corrected" indicator says
   * something true rather than inferring it from a timestamp that moves for
   * other reasons.
   */
  correctedAt: number | null
}

/** A recorded band: which one, and how many. Never a weight. */
export type WorkoutBand = { label: string; count: number }

export type WorkoutProgress = {
  total: number
  completed: number
  skipped: number
  resolved: number
}

/** The whole workout, or `occurrence: null` when it has not been started. */
export type WorkoutLog = {
  occurrence: WorkoutOccurrence | null
  sets: WorkoutSet[]
  progress: WorkoutProgress | null
  /**
   * Whether the server would currently allow this Start to be cancelled.
   *
   * Advisory: it stops the page offering a button that would be refused. The
   * server's conditional delete remains the authority, and asking anyway gets a
   * controlled refusal rather than a surprise.
   */
  cancelable: boolean
}

export class WorkoutApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'WorkoutApiError'
    this.status = status
  }
}

const BASE = '/api/workouts'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

function occurrenceUrl(date: string, sessionId: string): string {
  return `${BASE}/${encodeURIComponent(date)}/${encodeURIComponent(sessionId)}`
}

function setUrl(
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
): string {
  return `${occurrenceUrl(date, sessionId)}/sets/${exerciseOrder}/${setIndex}`
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return
  throw new WorkoutApiError(`Workout request failed (${response.status})`, response.status)
}

/* ------------------------------------------------------------------ */
/* Wire → app                                                          */
/* ------------------------------------------------------------------ */

function toLoad(raw: unknown): WorkoutLoad | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Partial<WorkoutLoad>
  if (typeof row.value !== 'number') return null
  if (row.unit !== 'kg' && row.unit !== 'kg_each') return null
  return { value: row.value, unit: row.unit }
}

/** A recorded band, or null when the row carries none to read. */
function toBand(raw: unknown): WorkoutBand | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  const label = parseBandLabel(row.label)
  const count = parseBandCount(row.count)
  // A name with no quantity, or a quantity of something unnamed, records no
  // setup at all and is dropped rather than half-shown.
  if (label === null || count === null) return null
  return { label, count }
}

/** Returns null for anything that is not a full set row. */
function toSet(raw: unknown): WorkoutSet | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.exerciseOrder !== 'number' || typeof row.setIndex !== 'number') return null
  if (typeof row.exerciseId !== 'string' || typeof row.exerciseName !== 'string') return null
  if (row.resultKind !== 'reps' && row.resultKind !== 'seconds') return null
  if (row.loadMode !== 'none' && row.loadMode !== 'kg' && row.loadMode !== 'kg_each') {
    return null
  }
  if (row.status !== 'pending' && row.status !== 'completed' && row.status !== 'skipped') {
    return null
  }

  return {
    exerciseOrder: row.exerciseOrder,
    setIndex: row.setIndex,
    exerciseId: row.exerciseId,
    exerciseName: row.exerciseName,
    prescription: typeof row.prescription === 'string' ? row.prescription : '',
    equipment: typeof row.equipment === 'string' ? row.equipment : null,
    resultKind: row.resultKind,
    loadMode: row.loadMode,
    perSide: row.perSide === true,
    // Absent or unrecognised is carried through as null, NOT defaulted. The
    // set list refuses to log a set it cannot describe.
    inputType: isWorkoutInputType(row.inputType) ? row.inputType : null,
    status: row.status,
    load: toLoad(row.load),
    band: toBand(row.band),
    result: typeof row.result === 'number' ? row.result : null,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
    correctedAt: typeof row.correctedAt === 'number' ? row.correctedAt : null,
  }
}

function toOccurrence(raw: unknown): WorkoutOccurrence | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.date !== 'string' || typeof row.sessionId !== 'string') return null
  // Checked, never coerced. An unreadable kind does NOT become 'scheduled':
  // returning null here makes `toLog` refuse the whole response rather than
  // hand the page a workout it would render as a scheduled obligation.
  const provenance = readProvenance(row.kind, row.sourceSessionId)
  if (!provenance) return null

  return {
    date: row.date,
    sessionId: row.sessionId,
    kind: provenance.kind,
    sourceSessionId: provenance.sourceSessionId,
    day: typeof row.day === 'string' ? row.day : '',
    focus: typeof row.focus === 'string' ? row.focus : '',
    intensity: typeof row.intensity === 'string' ? row.intensity : '',
    startedAt: typeof row.startedAt === 'number' ? row.startedAt : 0,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
  }
}

function toLog(body: unknown): WorkoutLog {
  const raw = (body ?? {}) as Record<string, unknown>
  const occurrence = toOccurrence(raw.occurrence)
  // A body that HAS an occurrence whose provenance cannot be read is a failed
  // read, not an unstarted workout. Reporting it as `occurrence: null` would
  // offer to Start a workout that already exists; throwing puts the page into
  // its honest error state instead.
  if (raw.occurrence !== null && raw.occurrence !== undefined && occurrence === null) {
    throw new WorkoutApiError('Workout provenance could not be read', 500)
  }
  const sets = Array.isArray(raw.sets)
    ? raw.sets.map(toSet).filter((row): row is WorkoutSet => row !== null)
    : []
  const progress =
    typeof raw.progress === 'object' && raw.progress !== null
      ? (raw.progress as WorkoutProgress)
      : null
  return { occurrence, sets, progress, cancelable: raw.cancelable === true }
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

/** The stored workout for one date + session, or a not-started log. */
export async function fetchWorkout(
  date: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<WorkoutLog> {
  const response = await fetch(occurrenceUrl(date, sessionId), { ...REQUEST_INIT, signal })
  await ensureOk(response)
  return toLog(await response.json())
}

/** What a Start sends. The account is never part of it. */
export type WorkoutStartPayload = {
  day: string
  focus: string
  intensity: string
  /**
   * The Foundation session an Extra is copied from. Required by the server for
   * the Extra occurrence and refused for a scheduled one, so this is omitted
   * entirely by the normal training flow.
   */
  sourceSessionId?: string
  exercises: {
    exerciseId: string
    name: string
    prescription: string
    equipment: string | null
    resultKind: WorkoutResultKind
    loadMode: WorkoutLoadMode
    perSide: boolean
    setCount: number
  }[]
}

/**
 * Start, or resume, the workout. Idempotent on the server: starting one that
 * already exists returns the stored snapshot rather than replacing it.
 */
export async function startWorkout(
  date: string,
  sessionId: string,
  payload: WorkoutStartPayload,
  signal?: AbortSignal,
): Promise<WorkoutLog> {
  const response = await fetch(`${occurrenceUrl(date, sessionId)}/start`, {
    ...REQUEST_INIT,
    method: 'POST',
    headers: { ...REQUEST_INIT.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  await ensureOk(response)
  return toLog(await response.json())
}

async function mutateSet(
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
  init: RequestInit,
): Promise<WorkoutSet | null> {
  const response = await fetch(setUrl(date, sessionId, exerciseOrder, setIndex), {
    ...REQUEST_INIT,
    ...init,
  })
  await ensureOk(response)
  const body = (await response.json()) as { set?: unknown }
  return toSet(body.set)
}

/**
 * Log one set as completed.
 *
 * A result is required. The resistance is whatever that set's frozen modality
 * says it is: a kilogram load, a band, or neither. Sending both is refused by
 * the server, which is the authority on what this set was started as.
 */
export async function completeSet(
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
  entry: { result: number; load: WorkoutLoad | null; band?: WorkoutBand | null },
  signal?: AbortSignal,
): Promise<WorkoutSet | null> {
  return mutateSet(date, sessionId, exerciseOrder, setIndex, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'complete',
      result: entry.result,
      load: entry.load,
      band: entry.band ?? null,
    }),
    signal,
  })
}

/**
 * Cancel an accidental Start.
 *
 * Removes the whole occurrence, but only while the server agrees it was never
 * worked in. The answer is the same shape a never-started workout reads as, so
 * the page returns to "Workout not started" with no special case.
 */
export async function cancelWorkoutStart(
  date: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<WorkoutLog> {
  const response = await fetch(occurrenceUrl(date, sessionId), {
    ...REQUEST_INIT,
    method: 'DELETE',
    signal,
  })
  await ensureOk(response)
  return toLog(await response.json())
}

/**
 * Correct what one completed set actually recorded.
 *
 * `expectedUpdatedAt` is the version the editor read. The server refuses if
 * anything changed the set since, rather than overwriting a change the user
 * cannot see.
 */
export async function correctRecordedSet(
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
  correction: {
    inputType: WorkoutInputType
    load?: { value: number; unit: 'kg' | 'kg_each' } | null
    band?: WorkoutBand | null
    result: number
    expectedUpdatedAt: number
  },
  signal?: AbortSignal,
): Promise<{ corrected: boolean; set: WorkoutSet | null }> {
  const response = await fetch(
    `${setUrl(date, sessionId, exerciseOrder, setIndex)}/correction`,
    {
      ...REQUEST_INIT,
      method: 'PUT',
      headers: { ...REQUEST_INIT.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(correction),
      signal,
    },
  )
  await ensureOk(response)
  const body = (await response.json()) as { corrected?: unknown; set?: unknown }
  return { corrected: body.corrected === true, set: toSet(body.set) }
}

/** Mark one set skipped. No result and no load are recorded. */
export async function skipSet(
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
  signal?: AbortSignal,
): Promise<WorkoutSet | null> {
  return mutateSet(date, sessionId, exerciseOrder, setIndex, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'skip' }),
    signal,
  })
}

/** Return one set to pending, clearing what was logged against it. */
export async function undoSet(
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
  signal?: AbortSignal,
): Promise<WorkoutSet | null> {
  return mutateSet(date, sessionId, exerciseOrder, setIndex, { method: 'DELETE', signal })
}
