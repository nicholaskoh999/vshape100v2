import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { summariseSets, type WorkoutProgress } from '@shared/workoutLog'
import {
  completeSet as completeSetRequest,
  fetchWorkout,
  skipSet as skipSetRequest,
  startWorkout as startWorkoutRequest,
  undoSet as undoSetRequest,
  type WorkoutLoad,
  type WorkoutLog,
  type WorkoutOccurrence,
  type WorkoutSet,
  type WorkoutStartPayload,
} from './workoutApi'

/**
 * The workout log for one date + session.
 *
 * D1 is the source of truth; nothing is mirrored into browser storage, so a
 * refresh re-reads the server rather than replaying a cache. The three load
 * states are kept distinct on purpose:
 *
 *   loading → we do not know yet, so the UI must not offer "Start workout"
 *   ready   → the server answered; `occurrence` is the workout, or null
 *   error   → the request failed; say so rather than showing a false empty
 *
 * Status is derived from which attempt the stored result belongs to — the same
 * shape `useExerciseMedia` and `useTodayCompletions` use.
 */

export type WorkoutLogStatus = 'loading' | 'ready' | 'error'

/** `<exerciseOrder>:<setIndex>` — identifies one set within this workout. */
export type SetKey = string

export function setKey(exerciseOrder: number, setIndex: number): SetKey {
  return `${exerciseOrder}:${setIndex}`
}

export type WorkoutLogState = {
  status: WorkoutLogStatus
  occurrence: WorkoutOccurrence | null
  sets: WorkoutSet[]
  progress: WorkoutProgress | null
  /** True once the server has confirmed the workout exists. */
  started: boolean
  /** A Start is in flight. */
  starting: boolean
  /** Which set is mutating, so exactly one row can show progress. */
  busySet: SetKey | null
  /** Last recoverable mutation failure. Previous state stays visible. */
  mutationError: string | null
  reload: () => void
  start: (payload: WorkoutStartPayload) => Promise<void>
  complete: (
    exerciseOrder: number,
    setIndex: number,
    entry: { result: number; load: WorkoutLoad | null },
  ) => Promise<void>
  skip: (exerciseOrder: number, setIndex: number) => Promise<void>
  undo: (exerciseOrder: number, setIndex: number) => Promise<void>
}

const EMPTY_SETS: WorkoutSet[] = []

type Attempt = { date: string; sessionId: string; id: string }
type Loaded = { id: string; log: WorkoutLog }

export function useWorkoutLog(date: string, sessionId: string): WorkoutLogState {
  const [retries, setRetries] = useState(0)

  const attempt: Attempt = useMemo(
    () => ({ date, sessionId, id: `${date}#${sessionId}#${retries}` }),
    [date, sessionId, retries],
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [busySet, setBusySet] = useState<SetKey | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  // A mutation in flight. A ref so the double-submit guard is decided
  // synchronously inside the handler, the same rule Today's toggle and the
  // media editor use.
  const inFlight = useRef(false)

  const matched = loaded?.id === attempt.id

  const status: WorkoutLogStatus = matched
    ? 'ready'
    : failedId === attempt.id
      ? 'error'
      : 'loading'

  const log = matched ? (loaded as Loaded).log : null
  const sets = log?.sets ?? EMPTY_SETS
  const occurrence = log?.occurrence ?? null

  // Derived rather than taken from the last response, so the count stays
  // correct after a local set update without a second read.
  const progress = useMemo(
    () => (occurrence ? summariseSets(sets) : null),
    [occurrence, sets],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchWorkout(attempt.date, attempt.sessionId, controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt.id, log: result })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never quietly fall back to "not started": that would offer to start
        // a workout that may already be underway. Say the load failed.
        console.error('Workout log could not be loaded', error)
        setFailedId(attempt.id)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setRetries((n) => n + 1), [])

  /** Replace one set in place, keeping every other row untouched. */
  const adoptSet = useCallback(
    (next: WorkoutSet) => {
      setLoaded((current) => {
        if (!current) return current
        return {
          ...current,
          log: {
            ...current.log,
            sets: current.log.sets.map((row) =>
              row.exerciseOrder === next.exerciseOrder && row.setIndex === next.setIndex
                ? next
                : row,
            ),
          },
        }
      })
    },
    [],
  )

  const start = useCallback(
    async (payload: WorkoutStartPayload) => {
      if (inFlight.current) return
      inFlight.current = true
      setStarting(true)
      setMutationError(null)
      try {
        const result = await startWorkoutRequest(attempt.date, attempt.sessionId, payload)
        setLoaded({ id: attempt.id, log: result })
      } catch (error: unknown) {
        console.error('Workout could not be started', error)
        setMutationError('Could not start this workout. Check your connection and try again.')
      } finally {
        inFlight.current = false
        setStarting(false)
      }
    },
    [attempt],
  )

  /** Shared body for the three set mutations. */
  const runSetMutation = useCallback(
    async (
      exerciseOrder: number,
      setIndex: number,
      request: () => Promise<WorkoutSet | null>,
      failure: string,
    ) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusySet(setKey(exerciseOrder, setIndex))
      setMutationError(null)
      try {
        const next = await request()
        // The server's row is adopted, so what the UI shows is what was
        // stored — not what was typed.
        if (next) adoptSet(next)
      } catch (error: unknown) {
        console.error('Workout set could not be saved', error)
        // The previously persisted state stays on screen; only a message is
        // added, so a failed save never wipes the workout.
        setMutationError(failure)
      } finally {
        inFlight.current = false
        setBusySet(null)
      }
    },
    [adoptSet],
  )

  const complete = useCallback(
    (
      exerciseOrder: number,
      setIndex: number,
      entry: { result: number; load: WorkoutLoad | null },
    ) =>
      runSetMutation(
        exerciseOrder,
        setIndex,
        () =>
          completeSetRequest(
            attempt.date,
            attempt.sessionId,
            exerciseOrder,
            setIndex,
            entry,
          ),
        'Could not save this set. It has not been recorded — try again.',
      ),
    [attempt, runSetMutation],
  )

  const skip = useCallback(
    (exerciseOrder: number, setIndex: number) =>
      runSetMutation(
        exerciseOrder,
        setIndex,
        () => skipSetRequest(attempt.date, attempt.sessionId, exerciseOrder, setIndex),
        'Could not skip this set. Try again.',
      ),
    [attempt, runSetMutation],
  )

  const undo = useCallback(
    (exerciseOrder: number, setIndex: number) =>
      runSetMutation(
        exerciseOrder,
        setIndex,
        () => undoSetRequest(attempt.date, attempt.sessionId, exerciseOrder, setIndex),
        'Could not undo this set. Try again.',
      ),
    [attempt, runSetMutation],
  )

  return {
    status,
    occurrence,
    sets,
    progress,
    started: occurrence !== null,
    starting,
    busySet,
    mutationError,
    reload,
    start,
    complete,
    skip,
    undo,
  }
}
