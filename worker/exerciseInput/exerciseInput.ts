/**
 * The account's canonical input type per exercise.
 *
 * WHY THIS IS A STORED SETTING AND NOT A DERIVATION.
 *
 * The old code decided modality by looking at the exercise's equipment text —
 * roughly "if it mentions BAND, treat it as ...". That could never be right.
 * The same movement is done with a cable stack in one gym and a band in
 * another; a label is a description of a plan, not a record of what the user
 * owns. So the user says which it is, once, per exercise, and the app believes
 * them.
 *
 * It is CANONICAL BY EXERCISE ID, which is what makes Tuesday's Triceps
 * Pushdown and Friday's the same exercise, and an Extra copied from either
 * agree with both.
 *
 * It is a SETTING, NOT HISTORY. Changing it never edits a workout that has
 * already been started: those carry a frozen snapshot, and the snapshot wins.
 * That is why switching Triceps Pushdown to bands today does not turn last
 * week's recorded kilograms into bands — last week really was recorded in
 * kilograms, however wrong that record now looks.
 *
 * Rules live here; storage is the interface below, matching exerciseMedia and
 * today/completions. This module never talks to D1 and never touches HTTP.
 */

import { parseExerciseId } from '../../shared/exerciseMedia'
import {
  isWorkoutInputType,
  type WorkoutInputType,
} from '../../shared/workoutInput'

export { parseExerciseId }

export type ExerciseInputTypeRecord = {
  googleSub: string
  exerciseId: string
  inputType: WorkoutInputType
  updatedAt: number
}

/**
 * THREE STATES, AND THE MIDDLE ONE IS THE POINT.
 *
 *   absent      no row exists. The account has never answered for this
 *               exercise, which is legitimate, and the exercise keeps behaving
 *               exactly as it did before Round 20.
 *
 *   readable    a row exists and this build understands it.
 *
 *   unreadable  a row EXISTS but its stored value cannot be understood — a
 *               corrupt write, or a modality written by a newer build.
 *
 * Collapsing `unreadable` into `absent` would be the same class of bug this
 * whole round exists to remove: persisted truth exists, we cannot read it, and
 * we quietly proceed as though the user had never said anything. The user DID
 * say something. We just cannot tell what.
 *
 * So it is a distinct state everywhere, and callers must fail closed on it.
 */
export type StoredInputType =
  | { state: 'absent' }
  | { state: 'readable'; record: ExerciseInputTypeRecord }
  | { state: 'unreadable' }

/** Every stored setting for one account, with the unreadable ones named. */
export type ExerciseInputTypeLibrary = {
  records: ExerciseInputTypeRecord[]
  /**
   * Exercise ids whose stored setting exists but could not be read.
   *
   * Reported rather than dropped. A dropped row is indistinguishable from one
   * that was never written, and the difference decides whether a Start may
   * proceed.
   */
  unreadable: string[]
}

/**
 * Storage boundary. An interface so the rules can be tested directly and the
 * D1 implementation can stay thin.
 */
export interface ExerciseInputTypeStore {
  /** Every stored setting for one account, readable and not. */
  list(googleSub: string): Promise<ExerciseInputTypeLibrary>

  read(googleSub: string, exerciseId: string): Promise<StoredInputType>

  /** Insert or replace. One current truth per account per exercise. */
  save(record: ExerciseInputTypeRecord): Promise<void>
}

export type ParsedInputType =
  | { ok: true; value: WorkoutInputType }
  | { ok: false; field: 'body' | 'inputType' }

/**
 * Read a PUT body.
 *
 * The envelope is checked before the field, so a body that is not an object at
 * all is reported as such rather than as a missing input type — the distinction
 * a client needs in order to tell a malformed request from a rejected value.
 *
 * An unknown input type is refused. It is never coerced to weight_kg, which is
 * exactly the assumption this round exists to remove.
 */
export function parseInputTypeInput(body: unknown): ParsedInputType {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>
  if (!isWorkoutInputType(raw.inputType)) return { ok: false, field: 'inputType' }
  return { ok: true, value: raw.inputType }
}

export async function listInputTypes(
  store: ExerciseInputTypeStore,
  googleSub: string,
): Promise<ExerciseInputTypeLibrary> {
  return store.list(googleSub)
}

export async function readInputType(
  store: ExerciseInputTypeStore,
  googleSub: string,
  exerciseId: string,
): Promise<StoredInputType> {
  return store.read(googleSub, exerciseId)
}

export async function saveInputType(
  store: ExerciseInputTypeStore,
  googleSub: string,
  exerciseId: string,
  inputType: WorkoutInputType,
  now: number = Date.now(),
): Promise<ExerciseInputTypeRecord> {
  const record: ExerciseInputTypeRecord = {
    googleSub,
    exerciseId,
    inputType,
    updatedAt: now,
  }
  await store.save(record)
  return record
}

/**
 * One exercise's setting, as a Start sees it.
 *
 * The unreadable case is carried rather than dropped so a Start can refuse for
 * the exercises it actually touches, instead of either refusing the whole
 * account's workouts or silently proceeding on a guess.
 */
export type ResolvedInputType =
  | { readable: true; inputType: WorkoutInputType }
  | { readable: false }

/**
 * The account's settings as the map a Start needs.
 *
 * An exercise the account has never configured is ABSENT from this map, and a
 * Start treats absence as "carry on exactly as before" rather than as a default
 * opinion about equipment. An exercise whose stored setting could not be read is
 * PRESENT and marked unreadable — the one thing it must never do is look like
 * an exercise nobody has answered for.
 */
export async function resolveInputTypes(
  store: ExerciseInputTypeStore,
  googleSub: string,
): Promise<Map<string, ResolvedInputType>> {
  const library = await store.list(googleSub)
  const resolved = new Map<string, ResolvedInputType>()
  for (const record of library.records) {
    resolved.set(record.exerciseId, { readable: true, inputType: record.inputType })
  }
  for (const exerciseId of library.unreadable) {
    resolved.set(exerciseId, { readable: false })
  }
  return resolved
}
