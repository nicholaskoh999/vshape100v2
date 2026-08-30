import { useCallback, useEffect, useMemo, useState } from 'react'

import { addLocalDays } from '@shared/localDate'
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

  const attempt = useMemo(
    () => ({ span, id: `${span?.from ?? ''}..${span?.to ?? ''}#${retries}` }),
    [span, retries],
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  const matched = loaded?.id === attempt.id

  // No span means nothing to fetch — a settled empty state, not a spinner.
  const status: HolidayStatus = !span
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

/**
 * The set of dates covered by Holiday records, for a span.
 *
 * Expanding a range into individual days keeps the consumer (Today) a simple
 * membership test rather than a second copy of the range logic.
 */
export function holidayDaysOf(
  holidays: readonly HolidayRecord[],
  span: { from: string; to: string },
): Set<string> {
  const days = new Set<string>()
  for (const holiday of holidays) {
    // Clip to the span so a long range cannot expand without bound.
    const start = holiday.startDate < span.from ? span.from : holiday.startDate
    const end = holiday.endDate > span.to ? span.to : holiday.endDate
    for (let date: string | null = start; date !== null && date <= end; ) {
      days.add(date)
      date = addLocalDays(date, 1)
    }
  }
  return days
}
