/**
 * Canonical exercise media rules.
 *
 * ONE EXERCISE IDENTITY = ONE SHARED MEDIA RECORD. A record is filed under
 * (account, exercise slug) and nothing else — no session ever enters the key,
 * so Lat Pulldown on Monday, Wednesday and Thursday all read and write the
 * one record. Session prescription is a separate concern and is untouched
 * here.
 *
 * Validation lives in shared/exerciseMedia.ts, which the React editor uses
 * too, so the client can never offer to save something this API will reject.
 * This module owns the storage boundary and the operations; it never talks to
 * D1 and never touches HTTP, matching how today/completions.ts is structured.
 */

import type { ExerciseMediaInput, ExerciseMediaKind } from '../../shared/exerciseMedia'

export {
  isMediaKind,
  isSafeMediaUrl,
  isUsefulAlt,
  MAX_EXERCISE_ID_LENGTH,
  MAX_MEDIA_ALT_LENGTH,
  MAX_MEDIA_URL_LENGTH,
  MEDIA_KINDS,
  parseExerciseId,
  parseMediaInput,
} from '../../shared/exerciseMedia'
export type {
  ExerciseMediaInput,
  ExerciseMediaKind,
  MediaField,
  ParsedMedia,
} from '../../shared/exerciseMedia'

export type ExerciseMediaRecord = {
  googleSub: string
  exerciseId: string
  kind: ExerciseMediaKind
  url: string
  alt: string
  updatedAt: number
}

/**
 * Storage boundary. Keeping this an interface lets the rules be tested
 * directly and keeps the D1 implementation thin, matching the auth and Today
 * stores.
 */
export interface ExerciseMediaStore {
  /** Every record this account has, newest edit first. */
  list(googleSub: string): Promise<ExerciseMediaRecord[]>
  /** One record, or null when the account has set no media for the exercise. */
  find(googleSub: string, exerciseId: string): Promise<ExerciseMediaRecord | null>
  /**
   * Insert or replace. Replacing is what keeps the canonical invariant: a
   * second save for the same exercise never creates a second row.
   */
  upsert(record: ExerciseMediaRecord): Promise<void>
  /** Delete when present; deleting an absent record is not an error. */
  remove(googleSub: string, exerciseId: string): Promise<void>
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

/** Every canonical record this account has set. */
export async function listMedia(
  store: ExerciseMediaStore,
  googleSub: string,
): Promise<ExerciseMediaRecord[]> {
  return store.list(googleSub)
}

/** One canonical record, or null. Absent media is a normal state, not an error. */
export async function readMedia(
  store: ExerciseMediaStore,
  googleSub: string,
  exerciseId: string,
): Promise<ExerciseMediaRecord | null> {
  return store.find(googleSub, exerciseId)
}

/**
 * Save the one canonical record for this account + exercise.
 *
 * Upsert, not insert: saving Lat Pulldown media a second time replaces the
 * single shared row rather than adding a per-session copy.
 */
export async function saveMedia(
  store: ExerciseMediaStore,
  googleSub: string,
  exerciseId: string,
  input: ExerciseMediaInput,
  now: number = Date.now(),
): Promise<ExerciseMediaRecord> {
  const record: ExerciseMediaRecord = {
    googleSub,
    exerciseId,
    kind: input.kind,
    url: input.url,
    alt: input.alt,
    updatedAt: now,
  }
  await store.upsert(record)
  return record
}

/** Remove the canonical record. Idempotent: removing what is absent is fine. */
export async function removeMedia(
  store: ExerciseMediaStore,
  googleSub: string,
  exerciseId: string,
): Promise<void> {
  await store.remove(googleSub, exerciseId)
}
