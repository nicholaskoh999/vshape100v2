import { useCallback, useMemo, useState } from 'react'

import { buildAgenda } from './model/engine'
import { groupByStatus } from './model/ordering'
import { useTodayClock } from './useTodayClock'

/**
 * Completion memory for the current session.
 *
 * ROUND 03 SCOPE: this lives in React state and nowhere else. No
 * localStorage, no sessionStorage, no IndexedDB, no cookies, no API, no D1.
 * A refresh clears it, and that is the accepted limitation for this round —
 * real persistence arrives later. Do not "temporarily" back this with
 * storage; a half-real store is worse than an honestly empty one.
 */
function useCompletionMemory() {
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set<string>())

  const toggle = useCallback((key: string) => {
    setCompleted((previous) => {
      const next = new Set(previous)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])

  return { completed, toggle }
}

/**
 * Today, wired up: live clock → pure engine → grouped view model.
 *
 * The clock is the only impure part. Everything the UI renders is derived by
 * `buildAgenda`, so a minute boundary and a completion flow through exactly
 * the same recompute.
 */
export function useToday() {
  const now = useTodayClock()
  const { completed, toggle } = useCompletionMemory()

  const agenda = useMemo(() => buildAgenda(now, completed), [now, completed])
  const groups = useMemo(() => groupByStatus(agenda.entries), [agenda])

  return { now, agenda, groups, toggle }
}
