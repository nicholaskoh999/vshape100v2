import { useEffect, useMemo, useState } from 'react'

import { fetchWorkout } from '@/features/training/workoutApi'

/**
 * Has today's scheduled workout already been started?
 *
 * Round 19 Correction 1 needs this for ONE reason: once the session has been
 * started, offering "Recovery today" as though it could replace it is a lie —
 * the server refuses that write, and a control that looks available but cannot
 * work is worse than one that is plainly unavailable.
 *
 * Deliberately a read-only question, not the full workout hook: nothing here
 * mutates, and Today has no business owning set-level state.
 *
 * `started` is only meaningful while `status` is 'ready'. An unknown answer is
 * NOT treated as "not started": the card keeps the alternatives disabled until
 * it knows, because enabling them on a guess is what produces the 409 the user
 * should never have been able to trigger.
 */

export type ScheduledStartedState = {
  status: 'loading' | 'ready' | 'error'
  started: boolean
}

export function useScheduledStarted(
  date: string,
  /** The session the day plans, or null when it plans none. */
  sessionId: string | null,
): ScheduledStartedState {
  const [loaded, setLoaded] = useState<{ id: string; started: boolean } | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  // The local date is part of the identity, so yesterday's answer is never
  // today's — the same rule the flex read itself follows.
  const readId = useMemo(() => `${date}#${sessionId ?? 'none'}`, [date, sessionId])
  const matched = loaded?.id === readId

  const status: ScheduledStartedState['status'] =
    sessionId === null
      ? 'ready'
      : matched
        ? 'ready'
        : failedId === readId
          ? 'error'
          : 'loading'

  useEffect(() => {
    if (sessionId === null) return

    const controller = new AbortController()
    let active = true

    fetchWorkout(date, sessionId, controller.signal)
      .then((workout) => {
        if (!active) return
        // An occurrence exists only once Start has been called, so its presence
        // IS "started" — and a finished workout is a started one.
        setLoaded({ id: readId, started: workout.occurrence !== null })
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
    // Unknown counts as "cannot offer an alternative", not as "not started".
    started: sessionId === null ? false : matched ? (loaded?.started ?? false) : true,
  }
}
