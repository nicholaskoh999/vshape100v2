import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { deleteCompletion, fetchCompletions, putCompletion } from './completionsApi'

/**
 * Persisted completion state for Today.
 *
 * D1 is the durable source of truth. Nothing is mirrored into localStorage,
 * sessionStorage or IndexedDB — the set below is ordinary React state for the
 * current render, refilled from the server on every load.
 *
 * Mutations are **pessimistic**: the occurrence shows as pending until the
 * server has confirmed the write, and only then does the UI adopt the saved
 * state. A failed request therefore can never leave a false "done" (or a
 * false "not done") on screen; it surfaces an error the user can retry.
 */

export type HydrationStatus = 'loading' | 'ready' | 'error'

export type MutationFailure = {
  key: string
  action: 'complete' | 'undo'
}

export type TodayCompletions = {
  completed: ReadonlySet<string>
  hydration: HydrationStatus
  /** Occurrence keys with a write in flight. */
  pending: ReadonlySet<string>
  /** The most recent failed write, or null. */
  failure: MutationFailure | null
  toggle: (key: string) => void
  retryHydration: () => void
  dismissFailure: () => void
}

const EMPTY: ReadonlySet<string> = new Set<string>()

/** One hydration attempt: a day range plus a retry counter. */
type Attempt = { from: string; to: string; id: string }

type Loaded = { id: string; keys: ReadonlySet<string> }

export function useTodayCompletions(range: {
  from: string
  to: string
}): TodayCompletions {
  const { from, to } = range
  const [retries, setRetries] = useState(0)

  const attempt: Attempt = useMemo(
    () => ({ from, to, id: `${from}..${to}#${retries}` }),
    [from, to, retries],
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(EMPTY)
  const [failure, setFailure] = useState<MutationFailure | null>(null)

  // Keys with a request in flight. A ref, not state, so the duplicate-tap
  // guard is decided synchronously inside the handler.
  const inFlight = useRef(new Set<string>())

  // Status is derived from which attempt the stored result belongs to, so a
  // day change or a retry is "loading" again without a synchronous setState.
  const hydration: HydrationStatus =
    loaded?.id === attempt.id ? 'ready' : failedId === attempt.id ? 'error' : 'loading'

  const completed = loaded?.id === attempt.id ? loaded.keys : EMPTY

  // Re-runs when the day range changes — which is what carries the page
  // across local midnight — or when the user retries. No polling.
  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchCompletions({ from: attempt.from, to: attempt.to }, controller.signal)
      .then((rows) => {
        if (!active) return
        setLoaded({ id: attempt.id, keys: new Set(rows.map((row) => row.key)) })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never quietly fall back to "nothing is completed": that would show
        // finished work as unfinished. Say so instead, and offer a retry.
        console.error('Today completions could not be loaded', error)
        setFailedId(attempt.id)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const retryHydration = useCallback(() => setRetries((n) => n + 1), [])
  const dismissFailure = useCallback(() => setFailure(null), [])

  const toggle = useCallback(
    (key: string) => {
      // A second tap while the first write is in flight is ignored, so a
      // double click can never produce two writes for the same occurrence.
      if (inFlight.current.has(key)) return
      if (hydration !== 'ready') return

      const wasCompleted = completed.has(key)
      const action: MutationFailure['action'] = wasCompleted ? 'undo' : 'complete'
      const attemptId = attempt.id

      inFlight.current.add(key)
      setPending((prev) => new Set(prev).add(key))
      setFailure(null)

      const request = wasCompleted ? deleteCompletion(key) : putCompletion(key)

      request
        .then(() => {
          // Adopt the state the server confirmed, never an assumed one — and
          // only if the day range has not moved on underneath us.
          setLoaded((prev) => {
            if (!prev || prev.id !== attemptId) return prev
            const keys = new Set(prev.keys)
            if (wasCompleted) keys.delete(key)
            else keys.add(key)
            return { id: prev.id, keys }
          })
        })
        .catch((error: unknown) => {
          console.error('Today completion could not be saved', error)
          setFailure({ key, action })
        })
        .finally(() => {
          inFlight.current.delete(key)
          setPending((prev) => {
            const next = new Set(prev)
            next.delete(key)
            return next
          })
        })
    },
    [attempt.id, completed, hydration],
  )

  return {
    completed,
    hydration,
    pending,
    failure,
    toggle,
    retryHydration,
    dismissFailure,
  }
}
