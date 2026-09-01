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
  /**
   * Create or replace this account's choice for one day — CONDITIONALLY.
   *
   * The write must succeed only while no scheduled occurrence exists for
   * `scheduledSessionId` on that date, evaluated as part of the write itself
   * rather than by the caller beforehand. `written: false` means the guard
   * refused it, and nothing was stored.
   */
  put(
    googleSub: string,
    date: string,
    kind: TrainingFlexKind,
    scheduledSessionId: string | null,
    now: number,
  ): Promise<{ written: boolean }>
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
 * The outcome of a write.
 *
 * `conflict` is not an error state of the process — it is the mutual exclusion
 * doing its job, decided at the moment the write committed rather than by an
 * earlier read that may already have been stale.
 */
export type TrainingFlexWrite =
  | { status: 'ok'; choices: TrainingFlexChoice[] }
  | { status: 'unreadable' }
  | { status: 'conflict' }

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
  /** The session that date plans, or null when it plans none. */
  scheduledSessionId: string | null,
  now: number = Date.now(),
): Promise<TrainingFlexWrite> {
  if (kind === null) {
    // Clearing is always allowed. It is how a day is handed back to the
    // scheduled workout, and refusing it would leave a conflicting day with no
    // way out. It also removes nothing but the choice itself.
    await store.clear(googleSub, date)
  } else {
    const { written } = await store.put(googleSub, date, kind, scheduledSessionId, now)
    // The guard fired at commit time: a scheduled workout exists for this day,
    // so the alternative cannot be chosen. Nothing was stored, and nothing
    // about the workout was touched.
    if (!written) return { status: 'conflict' }
  }
  return readTrainingFlexRange(store, googleSub, date, date)
}
