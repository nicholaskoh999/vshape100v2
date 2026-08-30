/**
 * Workout logging rules.
 *
 * A workout occurrence is (account, local workout date, session). Its sets are
 * filed under that occurrence plus their position in the session, so the same
 * canonical exercise on two days — or twice in one day — never collides.
 *
 * The historical invariant lives here: a Start only ever *inserts*. Snapshot
 * columns are written once, when the workout is first started, and no later
 * request rewrites them. A second Start on the same occurrence is a resume: it
 * returns what was stored, even if the caller sent a newer prescription.
 *
 * That invariant has to survive two Starts running at once, which a read-then-
 * write check cannot guarantee on its own: both can read "not started" before
 * either writes. So each Start mints an ownership token, and the store writes
 * a set row only while that token is the one on the stored occurrence. The
 * winner is decided by the occurrence's primary key — one insert succeeds — and
 * the loser then writes nothing at all, rather than sprinkling its extra set
 * positions into the winner's workout.
 *
 * Validation lives in shared/workoutLog.ts, which the React set controls use
 * too. This module owns the storage boundary and the operations; it never
 * talks to D1 and never touches HTTP, matching today/completions.ts and
 * exerciseMedia/media.ts.
 */

import type {
  WorkoutLoadMode,
  WorkoutLoadUnit,
  WorkoutResultKind,
  WorkoutSetStatus,
  WorkoutSetUpdate,
  WorkoutStartInput,
} from '../../shared/workoutLog'

export * from '../../shared/workoutLog'

export type WorkoutOccurrenceRecord = {
  googleSub: string
  workoutDate: string
  sessionId: string
  /** Ownership token of the Start that created this workout. */
  snapshotId: string
  /** Historical copies, frozen when the workout was started. */
  day: string
  focus: string
  intensity: string
  startedAt: number
  updatedAt: number
}

export type WorkoutSetRecord = {
  googleSub: string
  workoutDate: string
  sessionId: string
  /** The token of the Start that produced this row. */
  snapshotId: string
  exerciseOrder: number
  setIndex: number
  /** Historical copies, frozen when the workout was started. */
  exerciseId: string
  exerciseName: string
  prescription: string
  equipment: string | null
  resultKind: WorkoutResultKind
  loadMode: WorkoutLoadMode
  perSide: boolean
  /** Live logging state. */
  status: WorkoutSetStatus
  loadValue: number | null
  loadUnit: WorkoutLoadUnit | null
  result: number | null
  updatedAt: number
}

/** An occurrence together with its sets, in performance order. */
export type WorkoutLog = {
  occurrence: WorkoutOccurrenceRecord
  sets: WorkoutSetRecord[]
}

/**
 * Storage boundary. Keeping this an interface lets the rules be tested
 * directly and keeps the D1 implementation thin, matching the auth, Today and
 * media stores.
 */
export interface WorkoutStore {
  findOccurrence(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
  ): Promise<WorkoutOccurrenceRecord | null>

  /** Every set of one occurrence, ordered by exercise then set index. */
  listSets(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
  ): Promise<WorkoutSetRecord[]>

  /**
   * Insert the occurrence and its sets as one all-or-nothing claim.
   *
   * Insert-only by contract, and ownership-gated: a set row is written only
   * while the stored occurrence carries this snapshot's token. A Start that
   * loses the occurrence insert therefore writes zero set rows, including at
   * positions the winner never occupied.
   */
  insertOccurrence(
    occurrence: WorkoutOccurrenceRecord,
    sets: WorkoutSetRecord[],
  ): Promise<void>

  findSet(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
    exerciseOrder: number,
    setIndex: number,
  ): Promise<WorkoutSetRecord | null>

  /** Update only the live logging columns of an existing set. */
  updateSet(record: WorkoutSetRecord): Promise<void>

  /** Bump the occurrence's updated_at when its sets change. */
  touchOccurrence(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
    updatedAt: number,
  ): Promise<void>
}

/* ------------------------------------------------------------------ */
/* Snapshot construction                                               */
/* ------------------------------------------------------------------ */

/**
 * A fresh ownership token for one Start attempt.
 *
 * It only has to be distinct per attempt — the winner is decided by the
 * occurrence's primary key, never by comparing tokens or clocks.
 */
export function newSnapshotId(): string {
  return crypto.randomUUID()
}

/** Build the rows a first Start would store. Pure: nothing is written here. */
export function buildSnapshot(
  googleSub: string,
  workoutDate: string,
  sessionId: string,
  snapshotId: string,
  input: WorkoutStartInput,
  now: number,
): WorkoutLog {
  const occurrence: WorkoutOccurrenceRecord = {
    googleSub,
    workoutDate,
    sessionId,
    snapshotId,
    day: input.day,
    focus: input.focus,
    intensity: input.intensity,
    startedAt: now,
    updatedAt: now,
  }

  const sets: WorkoutSetRecord[] = []
  input.exercises.forEach((exercise, exerciseOrder) => {
    for (let setIndex = 0; setIndex < exercise.setCount; setIndex += 1) {
      sets.push({
        googleSub,
        workoutDate,
        sessionId,
        snapshotId,
        exerciseOrder,
        setIndex,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.name,
        prescription: exercise.prescription,
        equipment: exercise.equipment,
        resultKind: exercise.resultKind,
        loadMode: exercise.loadMode,
        perSide: exercise.perSide,
        // Every expected set exists from the start, pending. The workout's
        // shape is therefore history too, not just what happened to be logged.
        status: 'pending',
        loadValue: null,
        loadUnit: null,
        result: null,
        updatedAt: now,
      })
    }
  })

  return { occurrence, sets }
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

/** The stored workout, or null when this account has not started it. */
export async function readWorkout(
  store: WorkoutStore,
  googleSub: string,
  workoutDate: string,
  sessionId: string,
): Promise<WorkoutLog | null> {
  const occurrence = await store.findOccurrence(googleSub, workoutDate, sessionId)
  if (!occurrence) return null
  return { occurrence, sets: await store.listSets(googleSub, workoutDate, sessionId) }
}

export type StartResult = WorkoutLog & { created: boolean }

/**
 * Start, or resume, one workout occurrence.
 *
 * Idempotent by design. When the occurrence already exists nothing is written
 * at all and the stored snapshot is returned — a caller sending a newer
 * prescription cannot rewrite the history of a workout that is already
 * underway.
 *
 * The pre-read is an optimisation, not the safety mechanism. Two concurrent
 * first Starts can both see "not started"; correctness comes from the write
 * itself. Each attempt mints a token, the occurrence's primary key lets exactly
 * one attempt's token be stored, and the store writes set rows only under that
 * stored token. The loser writes nothing and reads back the winner.
 */
export async function startWorkout(
  store: WorkoutStore,
  googleSub: string,
  workoutDate: string,
  sessionId: string,
  input: WorkoutStartInput,
  now: number = Date.now(),
  snapshotId: string = newSnapshotId(),
): Promise<StartResult> {
  const existing = await readWorkout(store, googleSub, workoutDate, sessionId)
  if (existing) return { ...existing, created: false }

  const snapshot = buildSnapshot(googleSub, workoutDate, sessionId, snapshotId, input, now)
  await store.insertOccurrence(snapshot.occurrence, snapshot.sets)

  // Re-read rather than trusting the values just sent: if another request won
  // the race, the stored snapshot is theirs and that is the truthful answer.
  const stored = await readWorkout(store, googleSub, workoutDate, sessionId)
  if (!stored) {
    // The store accepted the insert but cannot read it back. Treat that as a
    // storage failure rather than inventing a workout.
    throw new Error('workout occurrence could not be read back after insert')
  }
  // Whether this attempt created the workout is answered by whose token is
  // stored — a fact, not a timestamp comparison.
  return { ...stored, created: stored.occurrence.snapshotId === snapshotId }
}

export type SetOutcome =
  | { ok: true; record: WorkoutSetRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'load_not_applicable' }
  | { ok: false; reason: 'load_unit_mismatch' }

/**
 * Apply a completion or a skip to one expected set.
 *
 * Only the live logging columns move; the snapshot columns are carried through
 * untouched. A load is accepted only where the snapshot says load applies, and
 * only in the sense the snapshot recorded — so a dumbbell set cannot quietly
 * be stored as a single-implement weight, or the other way round.
 */
export async function applySetUpdate(
  store: WorkoutStore,
  googleSub: string,
  workoutDate: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
  update: WorkoutSetUpdate,
  now: number = Date.now(),
): Promise<SetOutcome> {
  const existing = await store.findSet(
    googleSub,
    workoutDate,
    sessionId,
    exerciseOrder,
    setIndex,
  )
  if (!existing) return { ok: false, reason: 'not_found' }

  if (update.action === 'skip') {
    // A skipped set records no result and no load. It must never read as a
    // completed working set.
    const record: WorkoutSetRecord = {
      ...existing,
      status: 'skipped',
      loadValue: null,
      loadUnit: null,
      result: null,
      updatedAt: now,
    }
    await store.updateSet(record)
    await store.touchOccurrence(googleSub, workoutDate, sessionId, now)
    return { ok: true, record }
  }

  if (update.load) {
    if (existing.loadMode === 'none') return { ok: false, reason: 'load_not_applicable' }
    if (update.load.unit !== existing.loadMode) {
      return { ok: false, reason: 'load_unit_mismatch' }
    }
  }

  const record: WorkoutSetRecord = {
    ...existing,
    status: 'completed',
    loadValue: update.load ? update.load.value : null,
    loadUnit: update.load ? update.load.unit : null,
    result: update.result,
    updatedAt: now,
  }
  await store.updateSet(record)
  await store.touchOccurrence(googleSub, workoutDate, sessionId, now)
  return { ok: true, record }
}

/**
 * Undo one set back to pending.
 *
 * The expected set stays — it is part of the workout's shape, which is
 * history. Only what was logged against it is cleared. The occurrence and its
 * snapshot are never touched.
 */
export async function undoSet(
  store: WorkoutStore,
  googleSub: string,
  workoutDate: string,
  sessionId: string,
  exerciseOrder: number,
  setIndex: number,
  now: number = Date.now(),
): Promise<SetOutcome> {
  const existing = await store.findSet(
    googleSub,
    workoutDate,
    sessionId,
    exerciseOrder,
    setIndex,
  )
  if (!existing) return { ok: false, reason: 'not_found' }

  const record: WorkoutSetRecord = {
    ...existing,
    status: 'pending',
    loadValue: null,
    loadUnit: null,
    result: null,
    updatedAt: now,
  }
  await store.updateSet(record)
  await store.touchOccurrence(googleSub, workoutDate, sessionId, now)
  return { ok: true, record }
}
