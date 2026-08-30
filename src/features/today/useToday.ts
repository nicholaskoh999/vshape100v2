import { useMemo } from 'react'

import { holidayDaysOf, useHolidays } from '@/features/calendar/useHolidays'
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
 *
 * Holiday overrides arrive the same way: the server says which dates are
 * Holiday, and the engine decides what that means. Until they have loaded the
 * agenda is built without them, so a Holiday day briefly shows its normal
 * route rather than the reverse — the page never invents a Holiday that is
 * not stored.
 */
export function useToday() {
  const now = useTodayClock()

  // Only the day matters for hydration, so this is stable between clock ticks
  // and shifts exactly once when the local calendar day changes.
  const range = useMemo(() => completionDayRange(now), [now])
  const completions = useTodayCompletions(range)

  // The same two days Today can display: yesterday (for spillover) and today.
  const holidays = useHolidays(range)
  const holidayDays = useMemo(
    () => holidayDaysOf(holidays.holidays, range),
    [holidays.holidays, range],
  )

  const agenda = useMemo(
    () => buildAgenda(now, completions.completed, holidayDays),
    [now, completions.completed, holidayDays],
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
    holidayStatus: holidays.status,
  }
}
