import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchHolidays, type HolidayRecord } from './holidayApi'

/**
 * Holiday records intersecting a local-date span.
 *
 * The three states stay distinct, matching the other hooks in the app:
 *
 *   loading → we do not know yet, so no day may claim to be Home
 *   ready   → the server answered; the span may legitimately have none
 *   error   → the request failed; say so rather than showing a false empty
 *
 * That last one matters more here than elsewhere: silently falling back to
 * "no holidays" would tell someone their planned Holiday is a normal training
 * day and put the routine's pressure back on it.
 */

export type HolidayStatus = 'loading' | 'ready' | 'error'

export type HolidayState = {
  status: HolidayStatus
  holidays: HolidayRecord[]
  reload: () => void
}

const EMPTY: HolidayRecord[] = []

type Loaded = { id: string; holidays: HolidayRecord[] }

export function useHolidays(span: { from: string; to: string } | null): HolidayState {
  const [retries, setRetries] = useState(0)

  // Keyed on the span's VALUES, not the object's identity. Today rebuilds its
  // range object on every clock tick, so depending on identity would refetch
  // once a minute and flick the status back to "unknown" — which now hides the
  // routine. The dates are what actually decide the request.
  const from = span?.from ?? null
  const to = span?.to ?? null

  const attempt = useMemo(
    () => ({
      span: from !== null && to !== null ? { from, to } : null,
      id: `${from ?? ''}..${to ?? ''}#${retries}`,
    }),
    [from, to, retries],
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  const matched = loaded?.id === attempt.id

  // No span means nothing to fetch — a settled empty state, not a spinner.
  const status: HolidayStatus = !attempt.span
    ? 'ready'
    : matched
      ? 'ready'
      : failedId === attempt.id
        ? 'error'
        : 'loading'

  const holidays = matched ? (loaded as Loaded).holidays : EMPTY

  useEffect(() => {
    if (!attempt.span) return

    const controller = new AbortController()
    let active = true

    fetchHolidays(attempt.span, controller.signal)
      .then((result) => {
        if (!active) return
        setLoaded({ id: attempt.id, holidays: result })
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        console.error('Holidays could not be loaded', error)
        setFailedId(attempt.id)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => setRetries((n) => n + 1), [])

  return { status, holidays, reload }
}

// The expansion itself lives in shared/today so the notification scheduler
// applies exactly the same Holiday truth the page does.
export { holidayDaysOf } from '@shared/today/holidayDays'
