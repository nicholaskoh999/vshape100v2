import { useCallback, useEffect, useMemo, useState } from 'react'

import type { TrainingFlexKind } from '@shared/trainingFlex'

import { fetchTrainingFlex } from './trainingFlexApi'

/**
 * Every explicit training choice across one date range.
 *
 * Used by the Calendar, which shows a whole month at a time and needs to say
 * WHICH days were resolved and as what — a Recovery day and a Fitness Boxing
 * day are different facts, and neither is a missed session.
 *
 * A failed read is reported as an error rather than as an empty map: showing a
 * resolved day as an ordinary untouched training day would misrepresent what
 * the user actually did.
 */

export type TrainingFlexRangeStatus = 'loading' | 'ready' | 'error'

export type TrainingFlexRangeState = {
  status: TrainingFlexRangeStatus
  flex: ReadonlyMap<string, TrainingFlexKind>
  reload: () => void
}

const NO_FLEX: ReadonlyMap<string, TrainingFlexKind> = new Map()

type Loaded = { id: string; flex: ReadonlyMap<string, TrainingFlexKind> }

export function useTrainingFlexRange(
  /** Null while the span is not yet known; nothing is read until it is. */
  span: { from: string; to: string } | null,
): TrainingFlexRangeState {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  // The span is part of the read identity, so moving to another month shows
  // loading rather than the previous month's marks under new dates.
  const from = span?.from ?? null
  const to = span?.to ?? null
  const readId = useMemo(() => `${attempt}:${from}:${to}`, [attempt, from, to])
  const matched = loaded?.id === readId

  const status: TrainingFlexRangeStatus =
    from === null || to === null
      ? 'ready'
      : matched
        ? 'ready'
        : failedId === readId
          ? 'error'
          : 'loading'

  useEffect(() => {
    if (from === null || to === null) return

    const controller = new AbortController()
    let active = true

    fetchTrainingFlex(from, to, controller.signal)
      .then((choices) => {
        if (!active) return
        const byDate = new Map<string, TrainingFlexKind>()
        for (const choice of choices) byDate.set(choice.date, choice.kind)
        setLoaded({ id: readId, flex: byDate })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        console.error('Training choices could not be loaded', error)
        setFailedId(readId)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [readId, from, to])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { status, flex: matched ? (loaded as Loaded).flex : NO_FLEX, reload }
}
