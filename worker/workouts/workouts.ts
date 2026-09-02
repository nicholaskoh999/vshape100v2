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

import type { WorkoutInputType } from '../../shared/workoutInput'
import {
  inputTypeForLegacyLoadMode,
  kindForSessionId,
  loadModeForInputType,
  MAX_HISTORY_RANGE_ROWS,
} from '../../shared/workoutLog'
import type {
  HistoryRange,
  WorkoutHistoryEntry,
  WorkoutHistoryTotals,
  WorkoutKind,
  WorkoutLoadMode,
  WorkoutLoadUnit,
  WorkoutResultKind,
  WorkoutSetStatus,
  WorkoutSetUpdate,
  WorkoutStartInput,
} from '../../shared/workoutLog'

export * from '../../shared/workoutLog'

/**
 * The account's chosen input type per canonical exercise.
 *
 * Passed in already resolved so this module keeps its storage boundary: it
 * decides what a Start freezes, and never reaches for a second store to find
 * out. An exercise absent from the map has simply never been configured.
 */
export type ExerciseInputTypes = ReadonlyMap<string, WorkoutInputType>

export type WorkoutOccurrenceRecord = {
  googleSub: string
  workoutDate: string
  sessionId: string
  /** Ownership token of the Start that created this workout. */
  snapshotId: string
  /**
   * Persisted provenance, derived server-side from the routed session id.
   * Never read from a request body, so a client cannot label its own workout.
   */
  kind: WorkoutKind
  /** The Foundation session an Extra was copied from. Null when scheduled. */
  sourceSessionId: string | null
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
  /**
   * How this set was loaded, frozen at Start.
   *
   * `null` means the stored value could not be read as any known input type,
   * which is a corruption, not a legacy row — a row written before Round 20
   * resolves through its own frozen load mode instead. Callers must fail closed
   * on null rather than guessing kilograms.
   */
  inputType: WorkoutInputType | null
  /** Live logging state. */
  status: WorkoutSetStatus
  loadValue: number | null
  loadUnit: WorkoutLoadUnit | null
  /** The band actually used. Only ever set on a completed resistance_band set. */
  bandLabel: string | null
  /** How MANY bands. A count, never a weight, never converted to one. */
  bandCount: number | null
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

  /**
   * Recent recorded workouts, newest first, with their set summary.
   *
   * Read-only: history never writes, never backfills and never invents a
   * workout that was not started.
   */
  listRecent(googleSub: string, limit: number): Promise<WorkoutHistoryEntry[]>

  /**
   * Recorded workouts inside an inclusive local-date span, newest first.
   *
   * Read-only, like listRecent. Bounded by BOTH the span and `limit`, so no
   * caller can ask the database to walk everything.
   */
  listInRange(
    googleSub: string,
    from: string,
    to: string,
    limit: number,
  ): Promise<WorkoutHistoryEntry[]>

  /** Totals across everything this account has recorded. */
  totals(googleSub: string): Promise<WorkoutHistoryTotals>
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
  inputTypes: ExerciseInputTypes = new Map(),
): WorkoutLog {
  const occurrence: WorkoutOccurrenceRecord = {
    googleSub,
    workoutDate,
    sessionId,
    snapshotId,
    // Derived from the occurrence's OWN session id, so provenance can never
    // disagree with the identity the row is filed under, whatever was sent.
    kind: kindForSessionId(sessionId),
    // Carried only where it means something. A scheduled workout is its own
    // source, so it stores none even if a caller supplied one.
    sourceSessionId: kindForSessionId(sessionId) === 'extra' ? input.sourceSessionId : null,
    day: input.day,
    focus: input.focus,
    intensity: input.intensity,
    startedAt: now,
    updatedAt: now,
  }

  const sets: WorkoutSetRecord[] = []
  input.exercises.forEach((exercise, exerciseOrder) => {
    // THE SERVER DECIDES THE MODALITY, NOT THE CLIENT.
    //
    // The request supplies a load mode, so an input type taken from the body
    // would let any caller declare a band exercise to be kilograms. Instead the
    // account's own saved setting is used; an exercise never configured keeps
    // exactly its previous behaviour, read from the load mode the plan asked
    // for ('none' meant bodyweight, kilograms meant kilograms).
    const inputType =
      inputTypes.get(exercise.exerciseId) ?? inputTypeForLegacyLoadMode(exercise.loadMode)
    // And the frozen load mode is then forced to agree, which is what makes a
    // band set carrying kilogram semantics unrepresentable rather than merely
    // unlikely.
    const loadMode = loadModeForInputType(inputType, exercise.loadMode)

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
        loadMode,
        inputType,
        perSide: exercise.perSide,
        // Every expected set exists from the start, pending. The workout's
        // shape is therefore history too, not just what happened to be logged.
        status: 'pending',
        loadValue: null,
        loadUnit: null,
        bandLabel: null,
        bandCount: null,
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
 * What a Start attempt did.
 *
 * A refusal is a first-class outcome rather than an exception: the day was
 * explicitly resolved as something other than the scheduled session, which is a
 * legitimate state of the data, not a failure of the process.
 */
export type StartOutcome =
  | { ok: true; result: StartResult }
  | { ok: false; reason: 'training_flex_active' }

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
  inputTypes: ExerciseInputTypes = new Map(),
): Promise<StartOutcome> {
  const existing = await readWorkout(store, googleSub, workoutDate, sessionId)
  // A resume is never blocked: the workout already exists, so there is no
  // exclusion left to enforce, and refusing would strand a started session.
  if (existing) return { ok: true, result: { ...existing, created: false } }

  const snapshot = buildSnapshot(
    googleSub,
    workoutDate,
    sessionId,
    snapshotId,
    input,
    now,
    inputTypes,
  )
  await store.insertOccurrence(snapshot.occurrence, snapshot.sets)

  // Re-read rather than trusting the values just sent: if another request won
  // the race, the stored snapshot is theirs and that is the truthful answer.
  const stored = await readWorkout(store, googleSub, workoutDate, sessionId)
  if (!stored) {
    // Nothing is stored at all, and the insert did not throw. The occurrence
    // statement carries exactly two conditions: ON CONFLICT DO NOTHING, which
    // can only no-op when a row already EXISTS — and it does not — and the
    // Round 19 flex guard. So the day was explicitly resolved as Recovery or
    // Fitness Boxing at the moment this write committed, which a pre-read
    // taken earlier can miss.
    //
    // Nothing was written: no occurrence, and no sets either, because every set
    // insert is gated on the occurrence carrying this token.
    return { ok: false, reason: 'training_flex_active' }
  }
  // Whether this attempt created the workout is answered by whose token is
  // stored — a fact, not a timestamp comparison.
  return {
    ok: true,
    result: { ...stored, created: stored.occurrence.snapshotId === snapshotId },
  }
}

export type SetOutcome =
  | { ok: true; record: WorkoutSetRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'load_not_applicable' }
  | { ok: false; reason: 'load_unit_mismatch' }
  /** The payload described a different modality than the set was started with. */
  | { ok: false; reason: 'modality_mismatch' }
  /** A completed band set that does not say which band, or how many. */
  | { ok: false; reason: 'band_required' }
  /** The stored input type is not a value this build understands. */
  | { ok: false; reason: 'input_type_unreadable' }

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
      bandLabel: null,
      bandCount: null,
      result: null,
      updatedAt: now,
    }
    await store.updateSet(record)
    await store.touchOccurrence(googleSub, workoutDate, sessionId, now)
    return { ok: true, record }
  }

  // THE FROZEN SNAPSHOT DECIDES WHAT MAY BE RECORDED.
  //
  // Not the request, and not the exercise's setting as it stands right now: a
  // workout begun as kilograms stays kilograms even if the user switches that
  // exercise to bands mid-session. A payload describing the other modality is
  // refused outright rather than half-stored, because a set holding both a
  // weight and a band — or a band on a kilogram exercise — is not a fact about
  // anything that happened.
  const inputType = existing.inputType
  if (inputType === null) {
    // Unreadable modality: it cannot be displayed or compared honestly, so it
    // is not written to either.
    return { ok: false, reason: 'input_type_unreadable' }
  }

  if (inputType === 'resistance_band') {
    if (update.load) return { ok: false, reason: 'modality_mismatch' }
    // A completed band set that cannot say WHICH band records nothing usable
    // later, so it is refused rather than stored blank.
    if (!update.band) return { ok: false, reason: 'band_required' }
  } else if (update.band) {
    // Kilogram and bodyweight sets have no band to record.
    return { ok: false, reason: 'modality_mismatch' }
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
    bandLabel: update.band ? update.band.label : null,
    bandCount: update.band ? update.band.count : null,
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

/* ------------------------------------------------------------------ */
/* Recorded history                                                    */
/* ------------------------------------------------------------------ */

/**
 * What this account has actually recorded.
 *
 * Reporting only. It answers "what was logged", never "what was missed" —
 * a workout that was never started has no row here, and this module does not
 * consult the training plan to guess that one should have existed.
 */
export async function readHistory(
  store: WorkoutStore,
  googleSub: string,
  limit: number,
): Promise<{ workouts: WorkoutHistoryEntry[]; totals: WorkoutHistoryTotals }> {
  const [workouts, totals] = await Promise.all([
    store.listRecent(googleSub, limit),
    store.totals(googleSub),
  ])
  return { workouts, totals }
}

/**
 * Recorded workouts across an inclusive local-date span.
 *
 * Exists because the paged read cannot PROVE a span: it returns the newest N
 * workouts, so an absent date might simply be older than the page. Anything
 * deriving "was this day trained" from absence needs to know the read actually
 * covered the day, which is what `complete` reports.
 *
 * One row over the bound is requested so truncation is detected exactly rather
 * than guessed from a full page.
 */
export async function readHistoryRange(
  store: WorkoutStore,
  googleSub: string,
  range: HistoryRange,
): Promise<{
  workouts: WorkoutHistoryEntry[]
  totals: WorkoutHistoryTotals
  complete: boolean
}> {
  const [found, totals] = await Promise.all([
    store.listInRange(googleSub, range.from, range.to, MAX_HISTORY_RANGE_ROWS + 1),
    store.totals(googleSub),
  ])

  const complete = found.length <= MAX_HISTORY_RANGE_ROWS
  return { workouts: complete ? found : found.slice(0, MAX_HISTORY_RANGE_ROWS), totals, complete }
}
