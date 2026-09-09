import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchWorkout } from '@/features/training/workoutApi'
import { summariseStartedWorkout, type StartedWorkoutSummary } from './startedWorkout'

/**
 * Has today's scheduled workout already been started, and how far in is it?
 *
 * Round 19 Correction 1 needs `started` for ONE reason: once the session has
 * been started, offering "Recovery today" as though it could replace it is a
 * lie — the server refuses that write, and a control that looks available but
 * cannot work is worse than one that is plainly unavailable.
 *
 * Round 24 additionally reads a FROZEN SUMMARY off the SAME single request, so
 * Today's training hero can describe the workout that was started without a
 * second round trip. Still read-only: nothing here mutates, and Today has no
 * business owning set-level state.
 *
 * ROUND 24 CORRECTION 2. That summary replaces the bare `progress` this hook
 * used to return. Returning progress alone was what let the hero pair a
 * started workout's progress with the CURRENT programme's focus and counts —
 * two different things rendered as one card. The summary carries everything
 * the hero needs about a started workout, from one place, so there is nothing
 * left for the programme to fill in once an occurrence exists.
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
  /**
   * The started workout, as the workout itself describes it.
   *
   * Non-null ONLY once the read is ready and an occurrence exists — which
   * makes it the caller's signal for which source of truth to render. Null
   * means no workout has been started (or the answer is not known yet), and
   * only then may the day be described from the current programme.
   */
  workout: StartedWorkoutSummary | null
  reload: () => void
}

type Loaded = { id: string; workout: StartedWorkoutSummary | null }

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
      .then((log) => {
        if (!active) return
        // Summarised from the response we already have. `null` means nothing
        // has been started; anything else is the frozen workout's own account
        // of itself.
        setLoaded({ id: readId, workout: summariseStartedWorkout(log) })
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
    // Fail closed: while the answer is unknown, "started" so the alternatives
    // stay unavailable. The SUMMARY does not fail that way — an unknown answer
    // is null, and null must never be rendered as a started workout.
    started:
      sessionId === null ? false : matched ? (loaded?.workout ?? null) !== null : true,
    workout: matched ? (loaded?.workout ?? null) : null,
    reload,
  }
}
