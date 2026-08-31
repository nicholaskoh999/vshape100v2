/**
 * Holiday records expanded into per-day truth.
 *
 * The Today engine asks a simple question of each date — is it a Holiday, what
 * is it called, did the user keep training — and a stored record is a RANGE.
 * Expanding once, here, keeps that range logic in a single place instead of
 * duplicating it in every consumer.
 *
 * Shared because the notification scheduler needs exactly the same expansion
 * the page uses: a Holiday that suppresses the routine on screen must suppress
 * the reminder too.
 */

import type { HolidayRecord } from '../holiday'
import { addLocalDays } from '../localDate'
import type { HolidayDays } from './engine'

/**
 * The Holiday dates in a span, each with the truth that date needs.
 *
 * `trainingOn` is passed through as stored; whether it can actually APPLY to a
 * given date is decided downstream, where the weekend rule lives — a Saturday
 * inside a Training-On range never gains a session.
 */
export function holidayDaysOf(
  holidays: readonly HolidayRecord[],
  span: { from: string; to: string },
): HolidayDays {
  const days = new Map<string, { name: string; trainingOn: boolean }>()
  for (const holiday of holidays) {
    // Clip to the span so a long range cannot expand without bound.
    const start = holiday.startDate < span.from ? span.from : holiday.startDate
    const end = holiday.endDate > span.to ? span.to : holiday.endDate
    for (let date: string | null = start; date !== null && date <= end; ) {
      // Company dates cannot overlap custom ones — the server refuses it — so
      // first-writer-wins here is never reached in practice.
      if (!days.has(date)) {
        days.set(date, { name: holiday.name, trainingOn: holiday.trainingOn })
      }
      date = addLocalDays(date, 1)
    }
  }
  return days
}
