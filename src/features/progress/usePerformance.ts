import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchPerformance, type Performance } from './progressApi'

/**
 * Derived performance — Personal Bests and per-workout points.
 *
 * Four states, not three. Alongside loading / ready / error there is
 * `incomplete`: the request succeeded, but the server could not establish the
 * whole history and therefore refused to publish a best.
 *
 * That distinction matters more here than anywhere else in the app. A Personal
 * Best derived from part of the history is not obviously wrong on screen — it
 * is a plausible number that happens to be too low — so "we could not read all
 * of it" has to stay visible rather than collapsing into either a value or an
 * empty state.
 */

export type PerformanceStatus = 'loading' | 'ready' | 'incomplete' | 'error'

export type PerformanceState = {
  status: PerformanceStatus
  performance: Performance | null
  reload: () => void
}

type Loaded = { id: number; performance: Performance }

export function usePerformance(): PerformanceState {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<number | null>(null)

  const matched = loaded?.id === attempt

  const status: PerformanceStatus = matched
    ? (loaded as Loaded).performance.complete
      ? 'ready'
      : 'incomplete'
    : failedId === attempt
      ? 'error'
      : 'loading'

  const performance = useMemo(
    () => (matched ? (loaded as Loaded).performance : null),
    [matched, loaded],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchPerformance(controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt, performance: result })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        console.error('Performance could not be loaded', error)
        setFailedId(attempt)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { status, performance, reload }
}
