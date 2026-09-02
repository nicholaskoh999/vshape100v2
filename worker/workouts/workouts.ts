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

import type { ResolvedInputType } from '../exerciseInput/exerciseInput'
import {
  isNoOpCorrection,
  type CorrectableFacts,
  type WorkoutSetCorrection,
} from '../../shared/workoutCorrection'
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
 * out.
 *
 * ABSENT and UNREADABLE are different, and the difference is load-bearing:
 *
 *   absent      the exercise has never been configured. The backward-compatible
 *               fallback applies and the exercise behaves as it always has.
 *
 *   unreadable  a setting EXISTS and could not be understood. The user has
 *               answered; we cannot tell what they said. Falling back here
 *               would apply a default to an exercise that was deliberately
 *               configured — so the Start refuses instead.
 */
export type ExerciseInputTypes = ReadonlyMap<string, ResolvedInputType>

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
  /**
   * When any set of this workout was FIRST resolved, or null if none ever was.
   *
   * Null on every occurrence that predates Round 21, because the migration
   * back-fills nothing. That is safe: the cancel guard also refuses on the
   * set-level facts, which is what protects older workouts.
   */
  touchedAt: number | null
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

/**
 * May this workout be cancelled?
 *
 * A convenience for the UI, so it does not offer a button that the server will
 * refuse. It deliberately mirrors the store's conditional DELETE rather than
 * replacing it: the WRITE is the authority, and this can be stale the instant
 * it is computed. A client that asks anyway simply gets a controlled refusal.
 */
export function isCancelable(log: WorkoutLog): boolean {
  if (log.occurrence.touchedAt !== null) return false
  return log.sets.every(
    (set) =>
      set.status === 'pending' &&
      set.loadValue === null &&
      set.loadUnit === null &&
      set.bandLabel === null &&
      set.bandCount === null &&
      set.result === null &&
      // A resolve-then-undo moves the set's own clock away from the moment the
      // workout was started. This is what covers occurrences older than
      // `touchedAt`.
      set.updatedAt === log.occurrence.startedAt,
  )
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

  /**
   * Update only the live logging columns of an existing set.
   *
   * Answers whether a row was ACTUALLY changed. That matters because a set can
   * cease to exist between a caller reading it and writing it — Cancel Start
   * removes the whole occurrence — and an update that quietly matched nothing
   * would otherwise report success for a row that is gone, inventing a
   * completed set out of a workout the user just cancelled.
   */
  updateSet(record: WorkoutSetRecord): Promise<boolean>

  /**
   * Bump the occurrence's updated_at when its sets change, and record that the
   * workout has now been TOUCHED.
   *
   * The touch marker is written once and never cleared. It is what stops a
   * workout that was completed and then undone from looking disposable: the
   * sets are pending again, but the workout was genuinely worked in, and Cancel
   * Start must refuse it.
   */
  touchOccurrence(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
    updatedAt: number,
  ): Promise<void>

  /**
   * Remove an occurrence that should never have existed, with its sets and its
   * calibration — but ONLY while it is genuinely untouched.
   *
   * The eligibility decision travels INSIDE the write. Reading "all pending"
   * and then deleting would be the same stale-read race earlier rounds already
   * had to correct: a set completion committing in between would be erased by a
   * decision made before it existed.
   *
   * Answers whether an occurrence was actually removed.
   */
  deleteUntouchedOccurrence(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
  ): Promise<boolean>

  /**
   * Rewrite one completed set's recorded performance AND record the audit
   * event, as a single atomic write.
   *
   * Both statements carry the same precondition, so either the set is corrected
   * and the event exists, or neither happened. A correction with no audit, or
   * an audit with no correction, is not a state this can reach.
   *
   * Answers whether the write landed. False means the precondition failed —
   * the set was changed by somebody else since it was read.
   */
  correctSet(write: CorrectionWrite): Promise<boolean>

  /**
   * When each set of one workout was last corrected, for the sets that ever
   * were. Read-only: the audit is INSERT-only and nothing here can change it.
   */
  listCorrectionTimes(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
  ): Promise<CorrectionTime[]>

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

/**
 * What building a snapshot produced.
 *
 * A refusal is a first-class outcome rather than an exception, and it is
 * returned from the PURE builder deliberately: making the unreadable case
 * unrepresentable in a `WorkoutLog` means no caller can accidentally store one.
 */
export type SnapshotOutcome =
  | { ok: true; log: WorkoutLog }
  | { ok: false; reason: 'input_type_unreadable'; exerciseId: string }

/** Build the rows a first Start would store. Pure: nothing is written here. */
export function buildSnapshot(
  googleSub: string,
  workoutDate: string,
  sessionId: string,
  snapshotId: string,
  input: WorkoutStartInput,
  now: number,
  inputTypes: ExerciseInputTypes = new Map(),
): SnapshotOutcome {
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
    // A brand-new workout has never been worked in.
    touchedAt: null,
  }

  const sets: WorkoutSetRecord[] = []

  for (const [exerciseOrder, exercise] of input.exercises.entries()) {
    // THE SERVER DECIDES THE MODALITY, NOT THE CLIENT.
    //
    // The request supplies a load mode, so an input type taken from the body
    // would let any caller declare a band exercise to be kilograms. Instead the
    // account's own saved setting is used.
    const stored = inputTypes.get(exercise.exerciseId)

    // A setting exists and cannot be read. The whole Start refuses: freezing a
    // guessed modality into an immutable snapshot would bake the wrong answer
    // into history, which is the one thing that cannot be undone later.
    if (stored && !stored.readable) {
      return { ok: false, reason: 'input_type_unreadable', exerciseId: exercise.exerciseId }
    }

    // Absent is the ordinary case for an exercise nobody has configured, and it
    // keeps exactly its previous behaviour, read from the load mode the plan
    // asked for ('none' meant bodyweight, kilograms meant kilograms).
    const inputType = stored
      ? stored.inputType
      : inputTypeForLegacyLoadMode(exercise.loadMode)
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
  }

  return { ok: true, log: { occurrence, sets } }
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
   * One of this workout's exercises has a stored input type that could not be
   * read. Nothing was written — no occurrence, no sets — because the refusal
   * happens while building, before any statement is issued.
   */
  | { ok: false; reason: 'input_type_unreadable' }

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
  // Refused BEFORE anything is written, so "zero occurrence, zero sets" is a
  // property of the control flow rather than of a cleanup path.
  if (!snapshot.ok) return { ok: false, reason: 'input_type_unreadable' }

  await store.insertOccurrence(snapshot.log.occurrence, snapshot.log.sets)

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

/**
 * THE LIVE PERFORMANCE EVIDENCE OF A SET.
 *
 * Everything the user recorded about what they actually did — as opposed to the
 * frozen snapshot columns, which describe what the workout WAS and are never
 * rewritten.
 *
 * This exists as one definition because it previously did not. Skip cleared the
 * band; Undo, written separately, cleared the load and the result and did not.
 * A completed "Black x3 · 12 reps" could therefore be undone into a PENDING set
 * still carrying `Black x3` — stale evidence that the store then persisted. Any
 * future field recording what happened must be added HERE, and both callers get
 * it.
 */
function withoutEvidence(record: WorkoutSetRecord): WorkoutSetRecord {
  return {
    ...record,
    loadValue: null,
    loadUnit: null,
    bandLabel: null,
    bandCount: null,
    result: null,
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
      ...withoutEvidence(existing),
      status: 'skipped',
      updatedAt: now,
    }
    if (!(await store.updateSet(record))) return { ok: false, reason: 'not_found' }
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
  // THE WRITE DECIDES, NOT THE READ ABOVE.
  //
  // `existing` was read a moment ago. Cancel Start can have removed the whole
  // occurrence since — atomically, and legitimately. If this update matched no
  // row, the set is gone, and reporting success would manufacture a completed
  // set inside a workout that no longer exists.
  if (!(await store.updateSet(record))) return { ok: false, reason: 'not_found' }
  await store.touchOccurrence(googleSub, workoutDate, sessionId, now)
  return { ok: true, record }
}

/**
 * Undo one set back to pending.
 *
 * The expected set stays — it is part of the workout's shape, which is
 * history. Only what was logged against it is cleared. The occurrence and its
 * snapshot are never touched.
 *
 * "What was logged" means ALL of it, through `withoutEvidence`: a pending set
 * that still knew which band had been used would be a set claiming a
 * performance nobody performed, and it is the stored row that says so, not
 * merely the screen.
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
    ...withoutEvidence(existing),
    status: 'pending',
    updatedAt: now,
  }
  if (!(await store.updateSet(record))) return { ok: false, reason: 'not_found' }
  // Undo still TOUCHES the workout. Putting the sets back does not put back the
  // fact that they were resolved, and Cancel Start must keep refusing.
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

/* ------------------------------------------------------------------ */
/* Cancelling a Start that should never have happened                  */
/* ------------------------------------------------------------------ */

/**
 * What a Cancel attempt did.
 *
 * `workout_touched` and `not_started` are kept apart because they mean
 * different things to the person: one is "there is nothing here to cancel", the
 * other is "this workout has real training in it, and it is staying".
 */
export type CancelOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_started' }
  | { ok: false; reason: 'workout_touched' }

/**
 * Cancel an accidental Start.
 *
 * Pressing Start creates a durable occurrence and a full set of pending rows.
 * Until now there was no way back from that, so a mis-tap became permanent
 * history. This is the way back — and it is deliberately narrow: it removes
 * only an occurrence that was never actually worked in.
 *
 * THE DECISION IS MADE BY THE WRITE.
 *
 * Nothing here reads the sets and then deletes. The store's conditional DELETE
 * carries the whole eligibility test, evaluated against committed state at the
 * moment it commits, so a set completion racing this cannot be erased by a
 * judgement formed before it existed.
 *
 * The read below happens only AFTER the write has already decided, and only to
 * say something true about why. It never grants permission.
 */
export async function cancelWorkoutStart(
  store: WorkoutStore,
  googleSub: string,
  workoutDate: string,
  sessionId: string,
): Promise<CancelOutcome> {
  const removed = await store.deleteUntouchedOccurrence(googleSub, workoutDate, sessionId)
  if (removed) return { ok: true }

  // Explaining a refusal, not making one. If the occurrence is still there, it
  // failed the untouched test; if it is not, there was nothing to cancel —
  // which is also what a second Cancel gets.
  const occurrence = await store.findOccurrence(googleSub, workoutDate, sessionId)
  return { ok: false, reason: occurrence ? 'workout_touched' : 'not_started' }
}

/* ------------------------------------------------------------------ */
/* Correcting a set that recorded the wrong thing                      */
/* ------------------------------------------------------------------ */

/** When one set was last corrected. */
export type CorrectionTime = {
  exerciseOrder: number
  setIndex: number
  correctedAt: number
}

/** Identity of one recorded set. */
export type SetAddress = {
  googleSub: string
  workoutDate: string
  sessionId: string
  exerciseOrder: number
  setIndex: number
}

/**
 * One correction, as the store must write it.
 *
 * `expectedUpdatedAt` is the version the editor read. It travels into the write
 * as a condition, which is what makes this optimistic concurrency rather than
 * last-write-wins: if anything changed the set in between, nothing happens.
 */
export type CorrectionWrite = {
  address: SetAddress
  correctionId: string
  correctedAt: number
  expectedUpdatedAt: number
  before: CorrectableFacts
  after: WorkoutSetCorrection
}

export type CorrectionOutcome =
  | {
      ok: true
      record: WorkoutSetRecord
      corrected: true
      /**
       * When the audit event that just committed says the correction happened.
       *
       * Carried out of here so the response can tell the client the truth
       * immediately. Without it the successful reply said `correctedAt: null`
       * and the UI lost its "Corrected" mark until some later refetch —
       * reporting, for one render, that a set it had just corrected never was.
       */
      correctedAt: number
    }
  /** The asserted facts are already the stored facts; nothing was written. */
  | {
      ok: true
      record: WorkoutSetRecord
      corrected: false
      /**
       * The set's EXISTING correction time, if it was corrected before, and
       * null otherwise. A no-op must never manufacture a fresh timestamp: no
       * event happened, so claiming one would be a small lie in the audit's own
       * language.
       */
      correctedAt: number | null
    }
  | { ok: false; reason: 'not_found' }
  /** Only a completed set records a performance that can be wrong. */
  | { ok: false; reason: 'not_completed' }
  /** Somebody changed the set between the read and the Save. */
  | { ok: false; reason: 'stale' }

/**
 * Apply a historical correction to one completed set.
 *
 * WHAT THIS MAY CHANGE: the modality, the load, the band, the result — the
 * factual performance, which is the part that can be wrong.
 *
 * WHAT IT MAY NOT: anything that says which set this is or whether it happened.
 * The date, session, provenance, exercise, order, index, prescription, result
 * kind, per-side semantics and STATUS are all carried through untouched. A
 * correction never converts a skipped set into a completed one, and never the
 * reverse. The store's UPDATE does not mention those columns at all, so this is
 * a property of the statement rather than of this function remembering.
 *
 * EVERY CORRECTION IS RECORDED. The mutation and its audit event are one
 * atomic write. There is no path that produces a rewritten set with no record
 * of the rewrite, and none that records a rewrite that did not happen.
 */
export async function correctSet(
  store: WorkoutStore,
  address: SetAddress,
  after: WorkoutSetCorrection,
  expectedUpdatedAt: number,
  correctionId: string,
  now: number = Date.now(),
): Promise<CorrectionOutcome> {
  const existing = await store.findSet(
    address.googleSub,
    address.workoutDate,
    address.sessionId,
    address.exerciseOrder,
    address.setIndex,
  )
  if (!existing) return { ok: false, reason: 'not_found' }

  // Only a completed set has a recorded performance to be wrong about. A
  // pending or skipped set is refused rather than being completed by the back
  // door — that would change what happened, not how it was measured.
  if (existing.status !== 'completed') return { ok: false, reason: 'not_completed' }

  // Reported before the version check, because "you are looking at an old
  // version" is less useful than "this is already what it says".
  const before: CorrectableFacts = {
    inputType: existing.inputType,
    loadMode: existing.loadMode,
    loadValue: existing.loadValue,
    loadUnit: existing.loadUnit,
    bandLabel: existing.bandLabel,
    bandCount: existing.bandCount,
    result: existing.result,
  }
  if (isNoOpCorrection(before, after)) {
    // Nothing is written, so nothing new is claimed. Whatever the set's real
    // correction history says stays exactly as it was.
    const history = await store.listCorrectionTimes(
      address.googleSub,
      address.workoutDate,
      address.sessionId,
    )
    const existingCorrection =
      history.find(
        (row) =>
          row.exerciseOrder === address.exerciseOrder && row.setIndex === address.setIndex,
      )?.correctedAt ?? null
    return { ok: true, record: existing, corrected: false, correctedAt: existingCorrection }
  }

  if (existing.updatedAt !== expectedUpdatedAt) return { ok: false, reason: 'stale' }

  const written = await store.correctSet({
    address,
    correctionId,
    correctedAt: now,
    expectedUpdatedAt,
    before,
    after,
  })
  // The pre-read above is an optimisation and a source of good error messages.
  // The version condition inside the write is what actually decides, so losing
  // the race here is reported as stale rather than silently overwriting.
  if (!written) return { ok: false, reason: 'stale' }

  const record: WorkoutSetRecord = {
    ...existing,
    inputType: after.inputType,
    loadMode: after.loadMode,
    loadValue: after.load ? after.load.value : null,
    loadUnit: after.load ? after.load.unit : null,
    bandLabel: after.band ? after.band.label : null,
    bandCount: after.band ? after.band.count : null,
    result: after.result,
    updatedAt: now,
  }
  // `now` is the audit event's own `corrected_at`: the same value written into
  // the row in the batch above, not a second clock reading and not the client's
  // idea of the time.
  return { ok: true, record, corrected: true, correctedAt: now }
}
