/**
 * Workout logging client.
 *
 * D1 is the durable source of truth for logged sets. This module never reads
 * or writes localStorage, sessionStorage or IndexedDB — the only persistence
 * is the server, and the session travels in the existing HttpOnly cookie,
 * which React can never see. A refresh re-reads; it never replays a cache.
 */

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
  status: WorkoutSetStatus
  load: WorkoutLoad | null
  result: number | null
  updatedAt: number
}

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
    status: row.status,
    load: toLoad(row.load),
    result: typeof row.result === 'number' ? row.result : null,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
  }
}

function toOccurrence(raw: unknown): WorkoutOccurrence | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.date !== 'string' || typeof row.sessionId !== 'string') return null
  return {
    date: row.date,
    sessionId: row.sessionId,
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
  const sets = Array.isArray(raw.sets)
    ? raw.sets.map(toSet).filter((row): row is WorkoutSet => row !== null)
    : []
  const progress =
    typeof raw.progress === 'object' && raw.progress !== null
      ? (raw.progress as WorkoutProgress)
      : null
  return { occurrence, sets, progress }
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

/** Log one set as completed. A result is required; load is optional. */
export async function completeSet(
  date: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
  entry: { result: number; load: WorkoutLoad | null },
  signal?: AbortSignal,
): Promise<WorkoutSet | null> {
  return mutateSet(date, sessionId, exerciseOrder, setIndex, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'complete', result: entry.result, load: entry.load }),
    signal,
  })
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
