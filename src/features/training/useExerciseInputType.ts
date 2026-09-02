import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  fetchExerciseInputType,
  type ExerciseInputTypeRead,
  type ExerciseInputTypeRecord,
} from './exerciseInputTypeApi'

/**
 * The account's saved input type for one exercise identity.
 *
 * D1 is the source of truth; nothing is mirrored into browser storage. FOUR
 * states are kept distinct, and the distinction matters more here than almost
 * anywhere else in the app:
 *
 *   loading     we do not know yet, so the UI must not claim any modality
 *   ready       the server answered; `record` is the setting, or null for
 *               "never answered", which is NOT the same as "kilograms"
 *   unreadable  a setting EXISTS and the server could not understand it. We
 *               know enough to offer a REPLACEMENT — this is the one state
 *               where the user can and must be allowed to act
 *   error       we could not establish which of the above is true. Fail
 *               closed: say so, and do not offer to overwrite blind
 *
 * The last two used to be one. That told the user, via the Library, that their
 * setting could not be read and to set it again — and then disabled every
 * choice in the editor, because a failed request and an unreadable answer
 * looked identical from here. They are not identical: one is ignorance about
 * the data, the other is knowledge about it.
 *
 * Status is derived from which attempt the stored result belongs to, matching
 * `useExerciseMedia`, so changing exercise or retrying is "loading" again
 * without a synchronous setState in an effect.
 */

export type ExerciseInputTypeStatus = 'loading' | 'ready' | 'unreadable' | 'error'

export type ExerciseInputTypeState = {
  status: ExerciseInputTypeStatus
  /** The saved setting when status is 'ready'; null means never answered. */
  record: ExerciseInputTypeRecord | null
  reload: () => void
  /** Adopt a record the caller has just persisted, without a second read. */
  adopt: (record: ExerciseInputTypeRecord | null) => void
}

type Attempt = { exerciseId: string | undefined; id: string }

type Loaded = {
  id: string
  /** What the server said, which is more than "a record or not". */
  read: ExerciseInputTypeRead
}

export function useExerciseInputType(
  exerciseId: string | undefined,
): ExerciseInputTypeState {
  const [retries, setRetries] = useState(0)

  const attempt: Attempt = useMemo(
    () => ({ exerciseId, id: `${exerciseId ?? ''}#${retries}` }),
    [exerciseId, retries],
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  const matched = loaded?.id === attempt.id

  const status: ExerciseInputTypeStatus = !exerciseId
    ? 'ready'
    : matched
      ? (loaded as Loaded).read.state === 'unreadable'
        ? 'unreadable'
        : 'ready'
      : failedId === attempt.id
        ? 'error'
        : 'loading'

  const read = exerciseId && matched ? (loaded as Loaded).read : null
  const record = read !== null && read.state === 'readable' ? read.record : null

  useEffect(() => {
    if (!attempt.exerciseId) return

    const controller = new AbortController()
    let active = true

    fetchExerciseInputType(attempt.exerciseId, controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt.id, read: result })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        // Never quietly fall back to "not configured": that would invite the
        // user to answer a question they may have already answered, and could
        // overwrite a real setting with a re-guess.
        console.error('Exercise input type could not be loaded', error)
        setFailedId(attempt.id)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setRetries((n) => n + 1), [])

  const adopt = useCallback(
    (next: ExerciseInputTypeRecord | null) => {
      // A save replaces whatever was there, including an unreadable row, so
      // adopting a record moves the hook out of `unreadable` as well.
      setLoaded({
        id: attempt.id,
        read: next ? { state: 'readable', record: next } : { state: 'absent' },
      })
    },
    [attempt.id],
  )

  return { status, record, reload, adopt }
}
