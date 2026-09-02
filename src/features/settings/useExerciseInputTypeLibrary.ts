import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchExerciseInputTypes } from '@/features/training/exerciseInputTypeApi'
import type { WorkoutInputType } from '@shared/workoutInput'

/**
 * Which exercises this account has stated an input type for.
 *
 * One collection read answers the whole library, so the list does not fire a
 * request per row — the same shape `useExerciseMediaLibrary` uses.
 *
 * "We do not know yet" stays distinct from "never answered", so a row never
 * claims an exercise is unconfigured before the server has said so. That
 * distinction is the point: an unconfigured exercise is not kilograms, it is
 * unanswered, and the two must not look alike.
 */

export type InputTypeLibraryStatus = 'loading' | 'ready' | 'error'

export type ExerciseInputTypeLibrary = {
  status: InputTypeLibraryStatus
  /** Exercise id → the stated input type. Empty until status is 'ready'. */
  byExercise: ReadonlyMap<string, WorkoutInputType>
  reload: () => void
}

const EMPTY: ReadonlyMap<string, WorkoutInputType> = new Map()

type Loaded = { id: number; byExercise: ReadonlyMap<string, WorkoutInputType> }

export function useExerciseInputTypeLibrary(): ExerciseInputTypeLibrary {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<number | null>(null)

  const matched = loaded?.id === attempt

  const status: InputTypeLibraryStatus = matched
    ? 'ready'
    : failedId === attempt
      ? 'error'
      : 'loading'

  const byExercise = useMemo(
    () => (matched ? (loaded as Loaded).byExercise : EMPTY),
    [matched, loaded],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchExerciseInputTypes(controller.signal)
      .then((records) => {
        if (!active) return
        setLoaded({
          id: attempt,
          byExercise: new Map(records.map((row) => [row.exerciseId, row.inputType])),
        })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        console.error('Exercise input types could not be loaded', error)
        setFailedId(attempt)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { status, byExercise, reload }
}
