import { useCallback, useEffect, useMemo, useState } from 'react'

import type { CalibrationFeedback } from '@shared/progression/lane'
import {
  clearCalibration as clearCalibrationRequest,
  fetchProgression,
  saveCalibration as saveCalibrationRequest,
  type LaneRecommendation,
  type ProgressionLoad,
  type SessionGuidance,
} from './progressionApi'

/**
 * Derived training guidance for one date + session.
 *
 * Everything here is a READ of server truth. Nothing is computed in the browser
 * and nothing is mirrored into browser storage, so a refresh re-reads rather
 * than replaying — the same rule `useWorkoutLog` follows.
 *
 * ## Displayed is not the same as confirmed
 *
 * It re-reads whenever the stored workout moves: `revision` is bumped by
 * `useWorkoutLog` on every confirmed Start, Complete, Skip, Undo and reload.
 * While that re-read is in flight the previous answer is still on screen so the
 * flow does not jump — but it was derived from a workout that has since
 * changed, so it is NOT confirmed, and `confirmed` says so. Anything a person
 * can act on is gated on that flag, never on the panel being visible: a
 * suggestion derived from a set they have just taken back must not still be
 * one tap from a logging field.
 *
 * Failure is deliberately quiet AND total: guidance is subordinate to logging,
 * so a failed read drops what was on screen rather than raising an alarm over
 * the set controls, and leaves nothing stale behind. The workout keeps working.
 */

export type ProgressionStatus = 'idle' | 'loading' | 'ready' | 'error'

/** A recoverable failure, and the exercise lane it happened on. */
export type LaneError = { exerciseOrder: number; message: string }

export type ProgressionState = {
  status: ProgressionStatus
  guidance: SessionGuidance | null
  /**
   * True when what `guidance` holds was derived from the CURRENT state of the
   * workout. False while a re-read triggered by a change is still in flight.
   */
  confirmed: boolean
  /** Guidance by exercise position within this session. */
  laneFor: (exerciseOrder: number) => LaneRecommendation | null
  /** Which lane is saving a judgement, so exactly one panel shows progress. */
  busyLane: number | null
  /**
   * Last recoverable calibration failure, bound to the lane it happened on.
   *
   * It outlives the request that caused it — a message that disappears the
   * instant the spinner stops is a message nobody reads — and is cleared only
   * by the next attempt or by a success.
   */
  mutationError: LaneError | null
  saveFeedback: (
    exerciseOrder: number,
    feedback: CalibrationFeedback,
    chosenLoad: ProgressionLoad | null,
  ) => Promise<void>
  clearFeedback: (exerciseOrder: number) => Promise<void>
}

/**
 * `key` identifies the WORKOUT and is stable for the life of the page, so a
 * re-read replaces the answer instead of emptying the panel. `id` additionally
 * carries the workout revision, which is what says whether an answer still
 * describes the current truth.
 */
type Attempt = { date: string; sessionId: string; key: string; id: string }
type Loaded = { key: string; id: string; guidance: SessionGuidance }

export function useProgression(
  date: string,
  sessionId: string,
  options: { enabled: boolean; revision: number },
): ProgressionState {
  const { enabled, revision } = options

  const attempt: Attempt = useMemo(
    () => ({
      date,
      sessionId,
      key: `${date}#${sessionId}`,
      id: `${date}#${sessionId}#${revision}`,
    }),
    [date, sessionId, revision],
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [busyLane, setBusyLane] = useState<number | null>(null)
  const [mutationError, setMutationError] = useState<LaneError | null>(null)

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    let active = true

    fetchProgression(attempt.date, attempt.sessionId, controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ key: attempt.key, id: attempt.id, guidance: result })
        setFailedKey(null)
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Guidance is subordinate to logging. Drop what was on screen rather
        // than leaving a suggestion up that this read could not confirm — a
        // stale one could describe history the user has since taken back.
        console.error('Training guidance could not be loaded', error)
        setLoaded(null)
        setFailedKey(attempt.key)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, enabled])

  const matched = loaded?.key === attempt.key

  const status: ProgressionStatus = !enabled
    ? 'idle'
    : matched
      ? 'ready'
      : failedKey === attempt.key
        ? 'error'
        : 'loading'

  const guidance = matched ? (loaded as Loaded).guidance : null
  // Derived from the workout as it stands NOW, rather than from the workout as
  // it stood before the change that triggered the re-read still in flight.
  const confirmed = matched && (loaded as Loaded).id === attempt.id

  const byOrder = useMemo(() => {
    const map = new Map<number, LaneRecommendation>()
    for (const lane of guidance?.lanes ?? []) map.set(lane.exerciseOrder, lane)
    return map
  }, [guidance])

  const laneFor = useCallback(
    (exerciseOrder: number) => byOrder.get(exerciseOrder) ?? null,
    [byOrder],
  )

  /** Shared body for the two calibration writes. */
  const runCalibration = useCallback(
    async (
      exerciseOrder: number,
      request: () => Promise<SessionGuidance>,
      failure: string,
    ) => {
      setBusyLane(exerciseOrder)
      setMutationError(null)
      try {
        const next = await request()
        // The server's re-derived answer is adopted, so what is on screen is
        // what a fresh read would say — not what the browser assumed. A
        // judgement does not change the workout, so this answer is current for
        // the revision that is already loaded.
        //
        // `attempt` is the one this request STARTED under, captured in the
        // closure. If a set was logged while it was in flight, the workout has
        // moved on and this id no longer matches — so the answer lands
        // unconfirmed and the read that change triggered replaces it.
        setLoaded({ key: attempt.key, id: attempt.id, guidance: next })
        setFailedKey(null)
      } catch (error: unknown) {
        console.error('Calibration could not be saved', error)
        // Kept against its lane, so the panel can still show it once the
        // request has finished failing.
        setMutationError({ exerciseOrder, message: failure })
      } finally {
        setBusyLane(null)
      }
    },
    [attempt],
  )

  const saveFeedback = useCallback(
    (
      exerciseOrder: number,
      feedback: CalibrationFeedback,
      chosenLoad: ProgressionLoad | null,
    ) =>
      runCalibration(
        exerciseOrder,
        () =>
          saveCalibrationRequest(attempt.date, attempt.sessionId, exerciseOrder, {
            feedback,
            chosenLoad,
          }),
        'Could not save that. Your logged sets are unaffected — try again.',
      ),
    [attempt, runCalibration],
  )

  const clearFeedback = useCallback(
    (exerciseOrder: number) =>
      runCalibration(
        exerciseOrder,
        () => clearCalibrationRequest(attempt.date, attempt.sessionId, exerciseOrder),
        'Could not clear that. Your logged sets are unaffected — try again.',
      ),
    [attempt, runCalibration],
  )

  return {
    status,
    guidance,
    confirmed,
    laneFor,
    busyLane,
    mutationError,
    saveFeedback,
    clearFeedback,
  }
}
