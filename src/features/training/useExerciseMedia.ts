import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchExerciseMedia, type ExerciseMediaRecord } from './exerciseMediaApi'

/**
 * Canonical media for one exercise identity.
 *
 * D1 is the source of truth; nothing is mirrored into browser storage. The
 * three states are kept distinct on purpose:
 *
 *   loading → we do not know yet, so the UI must not claim "no media"
 *   ready   → the server answered; `record` is the media, or null for none
 *   error   → the request failed; say so rather than showing a false empty
 *
 * Status is derived from which attempt the stored result belongs to — the
 * same shape `useTodayCompletions` uses — so changing exercise or retrying is
 * "loading" again without a synchronous setState in an effect.
 */

export type ExerciseMediaStatus = 'loading' | 'ready' | 'error'

export type ExerciseMediaState = {
  status: ExerciseMediaStatus
  /** The saved record when status is 'ready', otherwise null. */
  record: ExerciseMediaRecord | null
  /** Re-run the load. */
  reload: () => void
  /** Adopt a record the caller has just persisted, without a second read. */
  adopt: (record: ExerciseMediaRecord | null) => void
}

/** One load attempt: an exercise plus a retry counter. */
type Attempt = { exerciseId: string | undefined; id: string }

type Loaded = { id: string; record: ExerciseMediaRecord | null }

export function useExerciseMedia(exerciseId: string | undefined): ExerciseMediaState {
  const [retries, setRetries] = useState(0)

  const attempt: Attempt = useMemo(
    () => ({ exerciseId, id: `${exerciseId ?? ''}#${retries}` }),
    [exerciseId, retries],
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  const matched = loaded?.id === attempt.id

  // No exercise means nothing to fetch. That is a settled empty state, not a
  // permanent spinner.
  const status: ExerciseMediaStatus = !exerciseId
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

    fetchExerciseMedia(attempt.exerciseId, controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt.id, record: result })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never quietly fall back to "no media": that would claim the user
        // never set any. Say the load failed and offer a retry.
        console.error('Exercise media could not be loaded', error)
        setFailedId(attempt.id)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setRetries((n) => n + 1), [])

  const adopt = useCallback(
    (next: ExerciseMediaRecord | null) => {
      setLoaded({ id: attempt.id, record: next })
    },
    [attempt.id],
  )

  return { status, record, reload, adopt }
}
