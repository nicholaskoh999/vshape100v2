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
 * It re-reads whenever the stored workout moves. `revision` is bumped by
 * `useWorkoutLog` on every confirmed Start, Complete, Skip, Undo and reload, so
 * taking a set back genuinely recomputes the guidance from what is left rather
 * than leaving a suggestion on screen that the history no longer supports.
 *
 * Failure is deliberately quiet: guidance is subordinate to logging, so a
 * failed read shows no guidance rather than an alarm over the set controls. The
 * workout itself keeps working.
 */

export type ProgressionStatus = 'idle' | 'loading' | 'ready' | 'error'

export type ProgressionState = {
  status: ProgressionStatus
  guidance: SessionGuidance | null
  /** Guidance by exercise position within this session. */
  laneFor: (exerciseOrder: number) => LaneRecommendation | null
  /** Which lane is saving a judgement, so exactly one panel shows progress. */
  busyLane: number | null
  /** Last recoverable calibration failure. Previous guidance stays visible. */
  mutationError: string | null
  saveFeedback: (
    exerciseOrder: number,
    feedback: CalibrationFeedback,
    chosenLoad: ProgressionLoad | null,
  ) => Promise<void>
  clearFeedback: (exerciseOrder: number) => Promise<void>
}

type Attempt = { date: string; sessionId: string; id: string }
type Loaded = { id: string; guidance: SessionGuidance }

export function useProgression(
  date: string,
  sessionId: string,
  options: { enabled: boolean; revision: number },
): ProgressionState {
  const { enabled, revision } = options

  const attempt: Attempt = useMemo(
    () => ({ date, sessionId, id: `${date}#${sessionId}#${revision}` }),
    [date, sessionId, revision],
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const [busyLane, setBusyLane] = useState<number | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    let active = true

    fetchProgression(attempt.date, attempt.sessionId, controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt.id, guidance: result })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Guidance is subordinate to logging. Say nothing rather than showing a
        // suggestion built on a read that failed.
        console.error('Training guidance could not be loaded', error)
        setFailedId(attempt.id)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, enabled])

  const matched = loaded?.id === attempt.id

  const status: ProgressionStatus = !enabled
    ? 'idle'
    : matched
      ? 'ready'
      : failedId === attempt.id
        ? 'error'
        : 'loading'

  const guidance = matched ? (loaded as Loaded).guidance : null

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
        // what a fresh read would say — not what the browser assumed.
        setLoaded({ id: attempt.id, guidance: next })
        setFailedId(null)
      } catch (error: unknown) {
        console.error('Calibration could not be saved', error)
        setMutationError(failure)
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
    laneFor,
    busyLane,
    mutationError,
    saveFeedback,
    clearFeedback,
  }
}
