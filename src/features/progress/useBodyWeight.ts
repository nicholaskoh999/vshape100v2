import { useCallback, useEffect, useMemo, useState } from 'react'

import type { BodyWeightRange } from '@shared/bodyWeight'

import {
  deleteWeight,
  fetchWeightHistory,
  saveWeight,
  type WeightHistory,
} from './progressApi'

/**
 * Body weight for the signed-in account.
 *
 * The three read states stay distinct, matching `useWorkoutHistory`:
 *
 *   loading → we do not know yet, so the card must not claim "no measurements"
 *   ready   → the server answered; the history may legitimately be empty
 *   error   → the request failed; say so rather than showing a false empty
 *
 * Writes carry their own state, because a failed save must not be able to look
 * like a successful one. `saved` and `failed` are separate outcomes, and both
 * are cleared the moment another write begins.
 */

export type BodyWeightStatus = 'loading' | 'ready' | 'error'

/** What the last write did. `saving` blocks a second concurrent submit. */
export type WriteState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; date: string }
  | { status: 'failed'; message: string }

export type BodyWeightState = {
  status: BodyWeightStatus
  history: WeightHistory | null
  range: BodyWeightRange
  setRange: (range: BodyWeightRange) => void
  write: WriteState
  save: (localDate: string, weightKg: number) => void
  remove: (localDate: string) => void
  reload: () => void
}

type Loaded = { id: number; history: WeightHistory }

export function useBodyWeight(): BodyWeightState {
  const [range, setRange] = useState<BodyWeightRange>('90d')
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<number | null>(null)
  const [write, setWrite] = useState<WriteState>({ status: 'idle' })

  // A read is identified by its attempt AND its range, so switching windows
  // shows "loading" rather than the previous window's points relabelled.
  const readId = useMemo(() => `${attempt}:${range}`, [attempt, range])
  const matched = loaded?.id === attempt && loaded.history.range === range

  const status: BodyWeightStatus = matched
    ? 'ready'
    : failedId === attempt
      ? 'error'
      : 'loading'

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchWeightHistory(range, controller.signal)
      .then((history) => {
        if (!active) return
        setLoaded({ id: attempt, history })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never fall back to an empty history: that would tell someone they
        // have recorded nothing when the truth is we could not find out.
        console.error('Body weight could not be loaded', error)
        setFailedId(attempt)
      })

    return () => {
      active = false
      controller.abort()
    }
    // readId folds both dependencies into one identity.
  }, [readId, attempt, range])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  /** Run one write, then reload so the summary reflects what was stored. */
  const run = useCallback(
    (date: string, action: () => Promise<void>) => {
      setWrite({ status: 'saving' })
      void action()
        .then(() => {
          setWrite({ status: 'saved', date })
          setAttempt((n) => n + 1)
        })
        .catch((error: unknown) => {
          console.error('Body weight could not be saved', error)
          setWrite({
            status: 'failed',
            // Deliberately plain: nothing internal, and no claim that the
            // value was stored.
            message: 'Could not save that measurement. Nothing was changed.',
          })
        })
    },
    [],
  )

  const save = useCallback(
    (localDate: string, weightKg: number) =>
      run(localDate, () => saveWeight(localDate, weightKg)),
    [run],
  )

  const remove = useCallback(
    (localDate: string) => run(localDate, () => deleteWeight(localDate)),
    [run],
  )

  return {
    status,
    history: matched ? (loaded as Loaded).history : null,
    range,
    setRange,
    write,
    save,
    remove,
    reload,
  }
}
