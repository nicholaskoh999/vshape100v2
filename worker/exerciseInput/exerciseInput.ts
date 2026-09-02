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
 * Storage boundary. An interface so the rules can be tested directly and the
 * D1 implementation can stay thin.
 */
export interface ExerciseInputTypeStore {
  /** Every configured exercise for one account. Unconfigured ones are absent. */
  list(googleSub: string): Promise<ExerciseInputTypeRecord[]>

  read(googleSub: string, exerciseId: string): Promise<ExerciseInputTypeRecord | null>

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
): Promise<ExerciseInputTypeRecord[]> {
  return store.list(googleSub)
}

export async function readInputType(
  store: ExerciseInputTypeStore,
  googleSub: string,
  exerciseId: string,
): Promise<ExerciseInputTypeRecord | null> {
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
 * The account's settings as the map a Start needs.
 *
 * Exercises the account has never configured are simply absent, and a Start
 * treats absence as "carry on exactly as before" rather than as a default
 * opinion about equipment.
 */
export async function resolveInputTypes(
  store: ExerciseInputTypeStore,
  googleSub: string,
): Promise<Map<string, WorkoutInputType>> {
  const records = await store.list(googleSub)
  return new Map(records.map((record) => [record.exerciseId, record.inputType]))
}
