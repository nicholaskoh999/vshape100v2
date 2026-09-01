/**
 * Today Training Flex rules.
 *
 * Thin by design: the vocabulary and validation live in shared/trainingFlex.ts,
 * which the React app uses too, and storage is an interface so these rules can
 * be tested without D1 — the same split auth, Today, workouts, media,
 * progression and settings all use.
 *
 * There is no identity here. Every function takes the account key the caller
 * already resolved from the authenticated session.
 */

import {
  readTrainingFlexKind,
  type TrainingFlexChoice,
  type TrainingFlexKind,
} from '../../shared/trainingFlex.ts'

/** A row exactly as the database holds it, unvalidated. */
export type StoredFlexRow = { localDate: string; kind: unknown }

export interface TrainingFlexStore {
  /** Every choice this account has stored in the inclusive range. */
  listRange(googleSub: string, from: string, to: string): Promise<StoredFlexRow[]>
  /** Create or replace this account's choice for one day. */
  put(googleSub: string, date: string, kind: TrainingFlexKind, now: number): Promise<void>
  /** Remove this account's choice for one day, if any. */
  clear(googleSub: string, date: string): Promise<void>
}

/**
 * The outcome of a read.
 *
 * `unreadable` is a first-class answer. A stored kind this build does not
 * recognise must not be silently dropped: dropping it would render the day as
 * "no choice made", which is a different and wrong statement about what the
 * user did, and — worse — would let a reminder fire for a day they had already
 * resolved.
 */
export type TrainingFlexRead =
  | { status: 'ok'; choices: TrainingFlexChoice[] }
  | { status: 'unreadable' }

/**
 * Read an account's choices over a range, refusing rather than guessing.
 *
 * An empty range is a real answer: it means nothing was chosen, which is the
 * ordinary case for almost every day.
 */
export async function readTrainingFlexRange(
  store: TrainingFlexStore,
  googleSub: string,
  from: string,
  to: string,
): Promise<TrainingFlexRead> {
  const rows = await store.listRange(googleSub, from, to)
  const choices: TrainingFlexChoice[] = []

  for (const row of rows) {
    const value = readTrainingFlexKind(row.kind)
    // Fail closed on the whole read. One unreadable row means this build cannot
    // faithfully describe the range, and a partial answer would look complete.
    if (value.kind !== 'choice') return { status: 'unreadable' }
    choices.push({ date: row.localDate, kind: value.value })
  }

  return { status: 'ok', choices }
}

/**
 * Write or clear one day's choice, then return what is stored for that day.
 *
 * Re-read rather than echoed, so the client adopts persisted truth instead of
 * its own optimism.
 */
export async function writeTrainingFlex(
  store: TrainingFlexStore,
  googleSub: string,
  date: string,
  kind: TrainingFlexKind | null,
  now: number = Date.now(),
): Promise<TrainingFlexRead> {
  if (kind === null) {
    await store.clear(googleSub, date)
  } else {
    await store.put(googleSub, date, kind, now)
  }
  return readTrainingFlexRange(store, googleSub, date, date)
}
