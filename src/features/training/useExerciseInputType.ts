import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  fetchExerciseInputType,
  type ExerciseInputTypeRecord,
} from './exerciseInputTypeApi'

/**
 * The account's saved input type for one exercise identity.
 *
 * D1 is the source of truth; nothing is mirrored into browser storage. The
 * three states are kept distinct on purpose, and the distinction matters more
 * here than almost anywhere else in the app:
 *
 *   loading → we do not know yet, so the UI must not claim any modality
 *   ready   → the server answered; `record` is the setting, or null for
 *             "never answered", which is NOT the same as "kilograms"
 *   error   → the request failed; say so rather than showing a false answer
 *
 * Status is derived from which attempt the stored result belongs to, matching
 * `useExerciseMedia`, so changing exercise or retrying is "loading" again
 * without a synchronous setState in an effect.
 */

export type ExerciseInputTypeStatus = 'loading' | 'ready' | 'error'

export type ExerciseInputTypeState = {
  status: ExerciseInputTypeStatus
  /** The saved setting when status is 'ready'; null means never answered. */
  record: ExerciseInputTypeRecord | null
  reload: () => void
  /** Adopt a record the caller has just persisted, without a second read. */
  adopt: (record: ExerciseInputTypeRecord | null) => void
}

type Attempt = { exerciseId: string | undefined; id: string }

type Loaded = { id: string; record: ExerciseInputTypeRecord | null }

export function useExerciseInputType(
  exerciseId: string | undefined,
): ExerciseInputTypeState {
  const [retries, setRetries] = useState(0)

  const attempt: Attempt = useMemo(
    () => ({ exerciseId, id: `${exerciseId ?? ''}#${retries}` }),
    [exerciseId, retries],
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  const matched = loaded?.id === attempt.id

  const status: ExerciseInputTypeStatus = !exerciseId
    ? 'ready'
    : matched
      ? 'ready'
      : failedId === attempt.id
        ? 'error'
        : 'loading'

  const record = exerciseId && matched ? (loaded as Loaded).record : null

  useEffect(() => {
    if (!attempt.exerciseId) return

    const controller = new AbortController()
    let active = true

    fetchExerciseInputType(attempt.exerciseId, controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt.id, record: result })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never quietly fall back to "not configured": that would invite the
        // user to answer a question they may have already answered, and could
        // overwrite a real setting with a re-guess.
        console.error('Exercise input type could not be loaded', error)
        setFailedId(attempt.id)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setRetries((n) => n + 1), [])

  const adopt = useCallback(
    (next: ExerciseInputTypeRecord | null) => {
      setLoaded({ id: attempt.id, record: next })
    },
    [attempt.id],
  )

  return { status, record, reload, adopt }
}
