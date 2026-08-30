import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchExerciseMediaLibrary } from '@/features/training/exerciseMediaApi'

/**
 * Which exercises the signed-in account has canonical media for.
 *
 * One collection read answers the whole library, so the list does not fire a
 * request per row. Only the identities are kept — the library shows status,
 * not media — and "we do not know yet" stays distinct from "no media", so a
 * row never claims an exercise is empty before the server has said so.
 *
 * Status is derived from which attempt the stored result belongs to, matching
 * `useTodayCompletions` and `useExerciseMedia`.
 */

export type LibraryStatus = 'loading' | 'ready' | 'error'

export type ExerciseMediaLibrary = {
  status: LibraryStatus
  /** Exercise ids with a saved record. Empty until status is 'ready'. */
  withMedia: ReadonlySet<string>
  reload: () => void
}

const EMPTY: ReadonlySet<string> = new Set<string>()

type Loaded = { id: number; ids: ReadonlySet<string> }

export function useExerciseMediaLibrary(): ExerciseMediaLibrary {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<number | null>(null)

  const matched = loaded?.id === attempt

  const status: LibraryStatus = matched
    ? 'ready'
    : failedId === attempt
      ? 'error'
      : 'loading'

  const withMedia = useMemo(
    () => (matched ? (loaded as Loaded).ids : EMPTY),
    [matched, loaded],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchExerciseMediaLibrary(controller.signal)
      .then((records) => {
        if (!active) return
        setLoaded({ id: attempt, ids: new Set(records.map((row) => row.exerciseId)) })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        console.error('Exercise media library could not be loaded', error)
        setFailedId(attempt)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { status, withMedia, reload }
}
