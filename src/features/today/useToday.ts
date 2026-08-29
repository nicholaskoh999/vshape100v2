import { useMemo } from 'react'

import { buildAgenda, completionDayRange } from './model/engine'
import { groupByStatus } from './model/ordering'
import { useTodayClock } from './useTodayClock'
import { useTodayCompletions } from './useTodayCompletions'

/**
 * Today, wired up: live clock → persisted completions → pure engine →
 * grouped view model.
 *
 * The clock and the network are the only impure parts. Everything the UI
 * renders is derived by `buildAgenda`, so a minute boundary, a hydration and
 * a completion all flow through exactly the same recompute — the server only
 * ever supplies *which* occurrence keys are done, never a Today status.
 */
export function useToday() {
  const now = useTodayClock()

  // Only the day matters for hydration, so this is stable between clock ticks
  // and shifts exactly once when the local calendar day changes.
  const range = useMemo(() => completionDayRange(now), [now])
  const completions = useTodayCompletions(range)

  const agenda = useMemo(
    () => buildAgenda(now, completions.completed),
    [now, completions.completed],
  )
  const groups = useMemo(() => groupByStatus(agenda.entries), [agenda])

  return {
    now,
    agenda,
    groups,
    toggle: completions.toggle,
    hydration: completions.hydration,
    pending: completions.pending,
    failure: completions.failure,
    retryHydration: completions.retryHydration,
    dismissFailure: completions.dismissFailure,
  }
}
