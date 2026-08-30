import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchWorkoutHistory, type WorkoutHistory } from './historyApi'

/**
 * Recorded workout history for the signed-in account.
 *
 * The three states stay distinct on purpose, matching `useExerciseMedia` and
 * `useWorkoutLog`:
 *
 *   loading → we do not know yet, so the page must not claim "nothing recorded"
 *   ready   → the server answered; the history may legitimately be empty
 *   error   → the request failed; say so rather than showing a false empty
 *
 * Status is derived from which attempt the stored result belongs to, so a
 * retry is "loading" again without a synchronous setState in an effect.
 */

export type WorkoutHistoryStatus = 'loading' | 'ready' | 'error'

export type WorkoutHistoryState = {
  status: WorkoutHistoryStatus
  history: WorkoutHistory | null
  reload: () => void
}

type Loaded = { id: number; history: WorkoutHistory }

export function useWorkoutHistory(limit?: number): WorkoutHistoryState {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<number | null>(null)

  const matched = loaded?.id === attempt

  const status: WorkoutHistoryStatus = matched
    ? 'ready'
    : failedId === attempt
      ? 'error'
      : 'loading'

  const history = useMemo(
    () => (matched ? (loaded as Loaded).history : null),
    [matched, loaded],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchWorkoutHistory({ limit }, controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt, history: result })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never fall back to an empty history: that would tell someone they
        // have recorded nothing when the truth is we could not find out.
        console.error('Workout history could not be loaded', error)
        setFailedId(attempt)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, limit])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { status, history, reload }
}
