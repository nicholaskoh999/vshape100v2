/**
 * The progression READ MODEL — account-scoped, session-scoped, derived.
 *
 * Guidance is a function of stored workout truth. Nothing in this file caches a
 * recommendation, and nothing writes one: every read walks the same history the
 * user could see in Progress and answers from it. Undo a set and the next read
 * answers differently, because the fact it was answering from is gone.
 *
 * WHY THE SERVER DERIVES IT.
 *
 * The browser's workout history read is PAGED — the newest N workouts — which
 * cannot prove what a lane's last two eligible occurrences were. A gate as
 * consequential as "reduce the load" must not be decided from a page that might
 * simply have ended before the evidence. So the lane's own history is queried
 * here, scoped to one session, bounded by an explicit window, and the read says
 * whether it covered that window. When it cannot prove it did, every lane fails
 * closed rather than answering from a partial history.
 *
 * WHAT IS NEVER READ.
 *
 * Today's own occurrence is not its own evidence. Guidance is for the sets
 * still ahead; a half-logged session judging itself would recommend a load
 * change off two sets that were never finished.
 */

import type {
  ProgressionSetRow,
  SessionProgression,
  StoredCalibration,
} from '../../shared/progression/engine'
import { deriveSessionProgression } from '../../shared/progression/engine'
import { chosenLoadFor, type CalibrationInput } from '../../shared/progression/lane'
import { MAX_SETS_PER_OCCURRENCE } from '../../shared/workoutLog'

/**
 * How many EARLIER occurrences of one session a derivation looks back over.
 *
 * A session runs at most once per local date, so this is half a year of weekly
 * training. It bounds the work exactly — by occurrences, not by a row guess —
 * and the read reports when there were more, so "no comparable history" can
 * never be a quiet way of saying "the query stopped early".
 */
export const PROGRESSION_WINDOW_OCCURRENCES = 26

/**
 * Hard ceiling on set rows one derivation examines.
 *
 * The window bound above already implies it; this exists so a pathological
 * occurrence count cannot run a Worker out of time. Crossing it fails closed.
 */
export const MAX_PROGRESSION_ROWS =
  PROGRESSION_WINDOW_OCCURRENCES * MAX_SETS_PER_OCCURRENCE

/** The occurrence header progression needs: which ruleset the session selects. */
export type ProgressionOccurrence = {
  workoutDate: string
  sessionId: string
  /** The session intensity snapshot, frozen at Start. */
  intensity: string
  startedAt: number
}

/** One stored calibration row. */
export type CalibrationRow = StoredCalibration & {
  workoutDate: string
  sessionId: string
  updatedAt: number
}

/**
 * Storage boundary.
 *
 * Every method takes the account key, and every implementation must scope on
 * it. Keeping this an interface lets the read model be tested directly and
 * keeps the D1 implementation thin, matching the auth, Today, media, workout
 * and Progress stores.
 */
export interface ProgressionStore {
  findOccurrence(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
  ): Promise<ProgressionOccurrence | null>

  /** Every set of ONE occurrence, ownership-joined. */
  listOccurrenceSets(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
  ): Promise<ProgressionSetRow[]>

  /**
   * The local dates of earlier occurrences of this session, newest first.
   *
   * One more than the window is asked for, so truncation is detected exactly
   * rather than guessed from a full page.
   */
  listEarlierDates(
    googleSub: string,
    sessionId: string,
    before: string,
    limit: number,
  ): Promise<string[]>

  /**
   * Every set of this session's occurrences inside `[from, before)`,
   * ownership-joined.
   */
  listSetsBefore(
    googleSub: string,
    sessionId: string,
    from: string,
    before: string,
    limit: number,
  ): Promise<ProgressionSetRow[]>

  listCalibration(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
  ): Promise<CalibrationRow[]>

  saveCalibration(record: {
    googleSub: string
    workoutDate: string
    sessionId: string
    exerciseOrder: number
    fingerprint: string
    feedback: StoredCalibration['feedback']
    observedLoad: StoredCalibration['observedLoad']
    chosenLoad: StoredCalibration['chosenLoad']
    now: number
  }): Promise<void>

  removeCalibration(
    googleSub: string,
    workoutDate: string,
    sessionId: string,
    exerciseOrder: number,
  ): Promise<void>
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export type ProgressionRead =
  /** The account has not started this workout, so there is nothing to guide. */
  | { started: false }
  | { started: true; occurrence: ProgressionOccurrence; progression: SessionProgression }

/**
 * Derive guidance for one workout occurrence of one account.
 *
 * The whole account scope lives in the store calls: every query below carries
 * `googleSub`, and the session id is the caller's, not a row's. One account can
 * therefore never see another's history, and one session can never see
 * another's — which is also what keeps Monday's Lat Pulldown lane from being
 * fed by Wednesday's.
 */
export async function readSessionProgression(
  store: ProgressionStore,
  googleSub: string,
  workoutDate: string,
  sessionId: string,
): Promise<ProgressionRead> {
  const occurrence = await store.findOccurrence(googleSub, workoutDate, sessionId)
  if (!occurrence) return { started: false }

  const [current, dates, calibration] = await Promise.all([
    store.listOccurrenceSets(googleSub, workoutDate, sessionId),
    // One more than the window, so a truncated look-back is a fact rather than
    // an inference from a full page.
    store.listEarlierDates(
      googleSub,
      sessionId,
      workoutDate,
      PROGRESSION_WINDOW_OCCURRENCES + 1,
    ),
    store.listCalibration(googleSub, workoutDate, sessionId),
  ])

  const windowed = dates.slice(0, PROGRESSION_WINDOW_OCCURRENCES)
  let historyComplete = dates.length <= PROGRESSION_WINDOW_OCCURRENCES
  let history: ProgressionSetRow[] = []

  if (windowed.length > 0) {
    // `windowed` is newest first, so its last entry is the oldest date the
    // window covers — the lower bound of one contiguous range read.
    const from = windowed[windowed.length - 1]
    const rows = await store.listSetsBefore(
      googleSub,
      sessionId,
      from,
      workoutDate,
      MAX_PROGRESSION_ROWS + 1,
    )
    if (rows.length > MAX_PROGRESSION_ROWS) {
      historyComplete = false
      history = []
    } else {
      history = rows
    }
  }

  return {
    started: true,
    occurrence,
    progression: deriveSessionProgression({
      sessionId,
      intensity: occurrence.intensity,
      current,
      history,
      calibration,
      historyComplete,
    }),
  }
}

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

export type CalibrationOutcome =
  | { ok: true; read: ProgressionRead }
  | { ok: false; reason: 'not_started' | 'slot_not_found' | 'not_calibrating' | 'no_completed_set' | 'load_unit_mismatch' }

/**
 * Record how a first working set actually felt.
 *
 * Guarded against the client asserting anything it has not earned:
 *
 *   - the slot must exist in the stored workout
 *   - the lane must genuinely be calibrating; a lane with comparable history
 *     is guided by that history, not by a fresh opinion of one set
 *   - a first working set must already be COMPLETED with a recorded load, and
 *     the load stored alongside the judgement is read from that set here — the
 *     request never supplies it
 *   - a chosen load must be in the lane's own unit, so "each" cannot be lost
 *   - "good" stores NO chosen load: it is a statement about the load that was
 *     actually lifted, and a different number is not that (see `chosenLoadFor`)
 *
 * The completed set itself is not touched. Saying "too light" does not rewrite
 * what was lifted; it changes only what is suggested next.
 */
export async function saveCalibration(
  store: ProgressionStore,
  googleSub: string,
  workoutDate: string,
  sessionId: string,
  exerciseOrder: number,
  input: CalibrationInput,
  now: number = Date.now(),
): Promise<CalibrationOutcome> {
  const before = await readSessionProgression(store, googleSub, workoutDate, sessionId)
  if (!before.started) return { ok: false, reason: 'not_started' }

  const lane = before.progression.lanes.find((row) => row.exerciseOrder === exerciseOrder)
  if (!lane || !lane.lane || !lane.fingerprint) return { ok: false, reason: 'slot_not_found' }
  if (lane.state !== 'calibrate' || !lane.calibration) {
    return { ok: false, reason: 'not_calibrating' }
  }

  const observed = lane.calibration.observedLoad
  if (!observed) return { ok: false, reason: 'no_completed_set' }

  // Re-applied here rather than trusted from the parser, so a caller that
  // reaches this function without going through the HTTP validation boundary
  // still cannot store a Good judgement carrying someone else's number.
  const chosenLoad = chosenLoadFor(input.feedback, input.chosenLoad)

  if (chosenLoad && chosenLoad.unit !== lane.lane.loadMode) {
    return { ok: false, reason: 'load_unit_mismatch' }
  }

  await store.saveCalibration({
    googleSub,
    workoutDate,
    sessionId,
    exerciseOrder,
    fingerprint: lane.fingerprint,
    feedback: input.feedback,
    observedLoad: observed,
    chosenLoad,
    now,
  })

  // Re-derived rather than patched, so the answer sent back is the same one a
  // fresh read would produce.
  return { ok: true, read: await readSessionProgression(store, googleSub, workoutDate, sessionId) }
}

/** Clear a calibration judgement. The completed set it described is untouched. */
export async function clearCalibration(
  store: ProgressionStore,
  googleSub: string,
  workoutDate: string,
  sessionId: string,
  exerciseOrder: number,
): Promise<CalibrationOutcome> {
  const before = await store.findOccurrence(googleSub, workoutDate, sessionId)
  if (!before) return { ok: false, reason: 'not_started' }

  await store.removeCalibration(googleSub, workoutDate, sessionId, exerciseOrder)
  return { ok: true, read: await readSessionProgression(store, googleSub, workoutDate, sessionId) }
}
