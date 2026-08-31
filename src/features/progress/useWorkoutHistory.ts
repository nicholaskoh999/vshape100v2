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

/** What a read is asking for: the newest N, or everything in a window. */
type Request = { limit?: number; from?: string; to?: string }

type Loaded = { id: string; history: WorkoutHistory }

/**
 * One history read.
 *
 * `id` keys the attempt on the request's VALUES rather than the object's
 * identity, so a caller rebuilding its options object each render does not
 * refetch forever — the same lesson `useHolidays` records.
 */
function useHistoryRequest(request: Request | null): WorkoutHistoryState {
  const [retries, setRetries] = useState(0)

  const limit = request?.limit ?? null
  const from = request?.from ?? null
  const to = request?.to ?? null

  // What kind of read this is, as a plain value — so the attempt below is
  // keyed on data rather than on the caller's object identity.
  const kind: 'none' | 'range' | 'page' =
    request === null ? 'none' : from !== null && to !== null ? 'range' : 'page'

  const attempt = useMemo(() => {
    if (kind === 'none') return { request: null, id: `none#${retries}` }
    if (kind === 'range') {
      return {
        request: { from: from as string, to: to as string },
        id: `range|${from}|${to}#${retries}`,
      }
    }
    return {
      request: limit === null ? {} : { limit },
      id: `page|${limit ?? ''}#${retries}`,
    }
  }, [kind, limit, from, to, retries])

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  const matched = loaded?.id === attempt.id

  // Nothing to ask for is a settled empty state, not a spinner.
  const status: WorkoutHistoryStatus = !attempt.request
    ? 'ready'
    : matched
      ? 'ready'
      : failedId === attempt.id
        ? 'error'
        : 'loading'

  const history = useMemo(
    () => (matched ? (loaded as Loaded).history : null),
    [matched, loaded],
  )

  useEffect(() => {
    if (!attempt.request) return

    const controller = new AbortController()
    let active = true

    fetchWorkoutHistory(attempt.request, controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt.id, history: result })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never fall back to an empty history: that would tell someone they
        // have recorded nothing when the truth is we could not find out.
        console.error('Workout history could not be loaded', error)
        setFailedId(attempt.id)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setRetries((n) => n + 1), [])

  return { status, history, reload }
}

/** The newest recorded workouts. Paged: it cannot prove a date was not trained. */
export function useWorkoutHistory(limit?: number): WorkoutHistoryState {
  const request = useMemo(() => (limit === undefined ? {} : { limit }), [limit])
  return useHistoryRequest(request)
}

/**
 * Every recorded workout inside an inclusive local-date window.
 *
 * This is the read a streak needs: it is the only one whose absence of a row
 * is evidence, and the response's `complete` says whether even that holds.
 */
export function useWorkoutHistoryRange(
  range: { from: string; to: string } | null,
): WorkoutHistoryState {
  const from = range?.from ?? null
  const to = range?.to ?? null
  const request = useMemo(
    () => (from !== null && to !== null ? { from, to } : null),
    [from, to],
  )
  return useHistoryRequest(request)
}
