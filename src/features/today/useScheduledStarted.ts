import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchWorkout, type WorkoutProgress } from '@/features/training/workoutApi'

/**
 * Has today's scheduled workout already been started, and how far in is it?
 *
 * Round 19 Correction 1 needs `started` for ONE reason: once the session has
 * been started, offering "Recovery today" as though it could replace it is a
 * lie — the server refuses that write, and a control that looks available but
 * cannot work is worse than one that is plainly unavailable.
 *
 * Round 24 additionally reads `progress` off the SAME single request, so
 * Today's training hero can show how far in the workout is without a second
 * round trip. Still read-only: nothing here mutates, and Today has no business
 * owning set-level state.
 *
 * `started` is only meaningful while `status` is 'ready'. An unknown answer is
 * NOT treated as "not started": the alternatives stay disabled until it is
 * known, because enabling them on a guess is what produces the 409 the user
 * should never have been able to trigger.
 *
 * ROUND 24 CORRECTION. `status` is now exposed, because the caller has to be
 * able to tell "started" from "we could not check". Disabling the alternatives
 * on an unknown answer is correct fail-closed behaviour; stating the positive
 * fact "today's session is already under way" from that same unknown is not,
 * and the flex card used to do exactly that.
 */

export type ScheduledStartedState = {
  status: 'loading' | 'ready' | 'error'
  /** Unknown counts as "cannot offer an alternative", never as "not started". */
  started: boolean
  /** Only ever non-null once the read is ready AND a workout exists. */
  progress: WorkoutProgress | null
  reload: () => void
}

type Loaded = { id: string; started: boolean; progress: WorkoutProgress | null }

export function useScheduledStarted(
  /** The local date the question is about. */
  date: string,
  /** The session the day plans, or null when it plans none. */
  sessionId: string | null,
): ScheduledStartedState {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  // The local date is part of the identity, so yesterday's answer is never
  // today's — the same rule the flex read itself follows. The attempt counter
  // joins it so a retry is "loading" again rather than reusing a stale match.
  const readId = useMemo(
    () => `${attempt}#${date}#${sessionId ?? 'none'}`,
    [attempt, date, sessionId],
  )
  const matched = loaded?.id === readId

  const status: ScheduledStartedState['status'] =
    sessionId === null
      ? 'ready'
      : matched
        ? 'ready'
        : failedId === readId
          ? 'error'
          : 'loading'

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (sessionId === null) return

    const controller = new AbortController()
    let active = true

    fetchWorkout(date, sessionId, controller.signal)
      .then((workout) => {
        if (!active) return
        // An occurrence exists only once Start has been called, so its presence
        // IS "started" — and a finished workout is a started one.
        setLoaded({
          id: readId,
          started: workout.occurrence !== null,
          progress: workout.progress,
        })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        console.error("Today's workout state could not be read", error)
        setFailedId(readId)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [readId, date, sessionId])

  return {
    status,
    started: sessionId === null ? false : matched ? (loaded?.started ?? false) : true,
    progress: matched ? (loaded?.progress ?? null) : null,
    reload,
  }
}
