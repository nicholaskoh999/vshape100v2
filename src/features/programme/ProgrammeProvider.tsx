import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  ProgrammeContext,
  type ProgrammeState,
  type ProgrammeStatus,
} from './programmeContext'
import { fetchProgramme, type ProgrammeView } from './programmeApi'

/**
 * THE ACCOUNT'S CURRENT PROGRAMME, READ ONCE.
 *
 * Training, the Exercise Library, an exercise's own page and the Extra chooser
 * all need the same answer to the same question. Before Round 22 they each
 * imported the same hardcoded array, which was at least consistent. Now that
 * the answer is account state, letting each of them fetch its own would be
 * worse than the array was: two screens could disagree, and a Start could be
 * built on a revision the user was no longer looking at.
 *
 * So it is fetched once, here, and shared.
 *
 * FOUR STATES, NOT THREE.
 *
 * `loading` / `ready` / `error`, and no fourth. There is deliberately no
 * "empty": an account that has never edited resolves to the Foundation seed
 * server-side, so a successful read is always a whole programme. A client-side
 * fallback would be a second source of programme truth, which is exactly what
 * this round exists to remove.
 *
 * An error is NOT quietly replaced by the static Foundation data. Showing the
 * default programme to someone whose real programme could not be read would be
 * showing them a training session they may have edited away.
 */

type Loaded = { id: number; programme: ProgrammeView }

export function ProgrammeProvider({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<number | null>(null)
  const [adopted, setAdopted] = useState<ProgrammeView | null>(null)

  const matched = loaded?.id === attempt

  const status: ProgrammeStatus = adopted
    ? 'ready'
    : matched
      ? 'ready'
      : failedId === attempt
        ? 'error'
        : 'loading'

  const programme = useMemo(
    () => adopted ?? (matched ? (loaded as Loaded).programme : null),
    [adopted, matched, loaded],
  )

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    fetchProgramme(controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt, programme: result })
        // A fresh read supersedes anything adopted from an earlier save.
        setAdopted(null)
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        console.error('Programme could not be loaded', error)
        setFailedId(attempt)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => {
    setAdopted(null)
    setAttempt((n) => n + 1)
  }, [])

  const adopt = useCallback((next: ProgrammeView) => setAdopted(next), [])

  const value = useMemo<ProgrammeState>(
    () => ({ status, programme, reload, adopt }),
    [status, programme, reload, adopt],
  )

  return <ProgrammeContext.Provider value={value}>{children}</ProgrammeContext.Provider>
}

