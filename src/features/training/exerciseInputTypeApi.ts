/**
 * Canonical exercise input type client.
 *
 * D1 is the durable source of truth for how an exercise is loaded. This module
 * never reads or writes localStorage, sessionStorage or IndexedDB — the only
 * persistence is the server, and the session travels in the existing HttpOnly
 * cookie, which React can never see.
 *
 * A missing record is an honest ANSWER, not a failure and not a default: it
 * means the account has never said how this exercise is loaded, and everything
 * downstream must treat that as unanswered rather than as kilograms.
 */

import { isWorkoutInputType, type WorkoutInputType } from '@shared/workoutInput'

/** One saved setting as the API returns it. */
export type ExerciseInputTypeRecord = {
  exerciseId: string
  inputType: WorkoutInputType
  updatedAt: number
}

export class ExerciseInputTypeApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ExerciseInputTypeApiError'
    this.status = status
  }
}

const BASE = '/api/exercise-input-types'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

function itemUrl(exerciseId: string): string {
  return `${BASE}/${encodeURIComponent(exerciseId)}`
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return
  throw new ExerciseInputTypeApiError(
    `Exercise input type request failed (${response.status})`,
    response.status,
  )
}

/**
 * Wire row → app record, or null for anything that is not a full record.
 *
 * An input type this build cannot name is dropped rather than coerced. The
 * exercise then reads as unanswered, which is honest, instead of silently
 * becoming kilograms — the assumption this whole round exists to remove.
 */
function toRecord(raw: unknown): ExerciseInputTypeRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  if (typeof row.exerciseId !== 'string' || row.exerciseId.length === 0) return null
  if (!isWorkoutInputType(row.inputType)) return null
  return {
    exerciseId: row.exerciseId,
    inputType: row.inputType,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
  }
}

/**
 * Every stored setting for this account.
 *
 * `unreadable` names the exercises whose setting EXISTS but could not be read.
 * They are kept separate from the ones nobody has answered for, because the
 * page must not offer "not set" for a question the user has already answered —
 * and because those exercises' workouts are currently being refused.
 */
export type ExerciseInputTypeLibraryPayload = {
  records: ExerciseInputTypeRecord[]
  unreadable: string[]
}

export async function fetchExerciseInputTypes(
  signal?: AbortSignal,
): Promise<ExerciseInputTypeLibraryPayload> {
  const response = await fetch(BASE, { ...REQUEST_INIT, signal })
  await ensureOk(response)
  const body = (await response.json()) as { inputTypes?: unknown[]; unreadable?: unknown }
  return {
    records: (body.inputTypes ?? [])
      .map(toRecord)
      .filter((row): row is ExerciseInputTypeRecord => row !== null),
    unreadable: Array.isArray(body.unreadable)
      ? body.unreadable.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

/**
 * What the server knows about one exercise's setting.
 *
 *   absent      never answered. The exercise behaves as it always has.
 *   readable    answered, and this build understands the answer.
 *   unreadable  answered, and this build cannot understand the answer.
 *
 * The third is REPAIRABLE, which is why it is a state rather than an error. A
 * genuine storage or network failure is a different thing entirely: it throws,
 * and the caller must fail closed, because it does not know which of the three
 * is true.
 */
export type ExerciseInputTypeRead =
  | { state: 'absent' }
  | { state: 'readable'; record: ExerciseInputTypeRecord }
  | { state: 'unreadable' }

export async function fetchExerciseInputType(
  exerciseId: string,
  signal?: AbortSignal,
): Promise<ExerciseInputTypeRead> {
  const response = await fetch(itemUrl(exerciseId), { ...REQUEST_INIT, signal })
  await ensureOk(response)
  const body = (await response.json()) as { state?: unknown; inputType?: unknown }

  if (body.state === 'unreadable') return { state: 'unreadable' }

  const record = toRecord(body.inputType)
  if (body.state === 'readable') {
    // The server says it is readable and the payload does not parse. We cannot
    // tell what the setting is, so we do not guess — this throws, and the
    // caller shows a load failure rather than an editable blank.
    if (!record) {
      throw new ExerciseInputTypeApiError('input type payload could not be read', 200)
    }
    return { state: 'readable', record }
  }
  if (body.state === 'absent') return { state: 'absent' }

  // A state this build does not know. Fail closed rather than assume.
  throw new ExerciseInputTypeApiError('unrecognised input type state', 200)
}

/**
 * Save the account's answer for one exercise.
 *
 * Takes effect on the NEXT Start. A workout already underway keeps the modality
 * it was started with, and every already-recorded set keeps what it recorded —
 * this changes a setting, never history.
 */
export async function saveExerciseInputType(
  exerciseId: string,
  inputType: WorkoutInputType,
  signal?: AbortSignal,
): Promise<ExerciseInputTypeRecord | null> {
  const response = await fetch(itemUrl(exerciseId), {
    ...REQUEST_INIT,
    method: 'PUT',
    headers: { ...REQUEST_INIT.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputType }),
    signal,
  })
  await ensureOk(response)
  const body = (await response.json()) as { inputType?: unknown }
  return toRecord(body.inputType)
}
