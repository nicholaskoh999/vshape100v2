import { timeLabelFor } from './format'
import { holidayRoute, routeForDate } from './routines'
import {
  MINUTES_PER_DAY,
  type Route,
  type RoutineItem,
  type TodayAgenda,
  type TodayEntry,
  type TodayStatus,
} from './types'

/**
 * Pure Today engine.
 *
 * `buildAgenda(now, completed)` is a total function of its arguments — no
 * `Date.now()`, no globals, no storage. Everything time-dependent enters
 * through `now`, which is what makes the tests deterministic and the live
 * clock a thin controller on top.
 *
 * ## The one non-negotiable rule
 *
 * Time never completes anything. `completed` is the *only* input that can
 * produce `DONE_EARLIER`; every time-derived outcome is NOW / NEXT / LATER /
 * LATE. A task that is past and untouched becomes LATE, never done.
 */

const EMPTY_COMPLETED: ReadonlySet<string> = new Set<string>()
const EMPTY_HOLIDAYS: ReadonlySet<string> = new Set<string>()

/** Local `YYYY-MM-DD` for a date — the identity of a routine day. */
export function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** Minutes since local midnight, truncated — routine boundaries are minutes. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * The half-open span `[start, end)` an item occupies within its own route.
 *
 * Intervals and windows carry their own bounds. A `moment` is a genuinely
 * fixed scheduled point: it occupies exactly the minute it is scheduled for
 * and nothing more. The clock is minute-aligned, so `07:30 Wake up` is NOW
 * only during minute 450 — NEXT at 07:29, LATE at 07:31 if untouched. It
 * never borrows time from the item after it, and there is no grace period.
 */
export function itemSpan(item: RoutineItem): { start: number; end: number } {
  if (item.kind === 'moment') return { start: item.at, end: item.at + 1 }
  return { start: item.start, end: Math.max(item.start, item.end) }
}

type OccurrenceInput = {
  item: RoutineItem
  route: Route
  anchor: Date
  /** Added to route minutes to reach minutes-since-reference-midnight. */
  offset: number
  spillover: boolean
  order: number
}

function toEntry({
  item,
  route,
  anchor,
  offset,
  spillover,
  order,
}: OccurrenceInput): TodayEntry {
  const span = itemSpan(item)
  const anchorDay = dayKey(anchor)
  return {
    key: `${anchorDay}:${item.id}`,
    item,
    anchorDay,
    routeId: route.id,
    spillover,
    start: span.start + offset,
    end: span.end + offset,
    // Replaced below; every entry gets a real status before it is returned.
    status: 'LATER',
    completed: false,
    order,
    timeLabel: timeLabelFor(item),
    flexible: item.kind === 'window',
    crossesMidnight: span.start < MINUTES_PER_DAY && span.end > MINUTES_PER_DAY,
  }
}

/**
 * Time-derived status for one occurrence. Never returns `DONE_EARLIER` —
 * only an explicit user action can do that.
 */
function timeStatus(entry: TodayEntry, nowMinutes: number): TodayStatus {
  if (entry.start <= nowMinutes && nowMinutes < entry.end) return 'NOW'
  if (entry.start > nowMinutes) return 'LATER'
  return 'LATE'
}

/**
 * Resolve the accepted routes into the day's agenda.
 *
 * The reference day contributes every item of its route. The previous day
 * contributes a cross-midnight occurrence **only while it is still running**,
 * so at Tuesday 00:15 Monday's `23:30–00:30` block is the current item and at
 * Tuesday 00:30 it is gone from Today altogether. Likewise Saturday's
 * `01:00–03:00` block is NOW on Sunday at 01:30 and absent from 03:00 on.
 *
 * Today is today's actionable agenda: a missed item from a previous day is
 * history, and history belongs to a later persistence round. This does not
 * soften the rule for the *current* day — an unfinished item whose time has
 * passed today is still LATE and still prominent.
 */
/**
 * The anchor days Today can display for `now`: the reference day, plus the
 * previous day, which is the only day whose occurrences can still be running
 * past local midnight. Stable for the whole calendar day, so persisted
 * completions are fetched once per day rather than on every clock tick.
 */
export function completionDayRange(now: Date): { from: string; to: string } {
  const today = startOfLocalDay(now)
  return { from: dayKey(addDays(today, -1)), to: dayKey(today) }
}

export function buildAgenda(
  now: Date,
  completed: ReadonlySet<string> = EMPTY_COMPLETED,
  holidayDays: ReadonlySet<string> = EMPTY_HOLIDAYS,
): TodayAgenda {
  const today = startOfLocalDay(now)
  const yesterday = addDays(today, -1)
  const nowMinutes = minutesOfDay(now)
  const todayKey = dayKey(today)

  // A Holiday suspends the day entirely. Returning no entries is what makes
  // that honest: there is nothing to be late for, and nothing is marked done
  // in order to achieve it. Yesterday's spillover is dropped too, so a normal
  // day rolling into a Holiday cannot put routine pressure on it.
  if (holidayDays.has(todayKey)) {
    return {
      day: todayKey,
      route: holidayRoute(),
      nowMinutes,
      entries: [],
      holiday: true,
    }
  }

  const todayRoute = routeForDate(today)
  // A Holiday has no items, so a Holiday yesterday spills nothing into today
  // — today's normal route simply resumes.
  const yesterdayRoute = holidayDays.has(dayKey(yesterday))
    ? holidayRoute()
    : routeForDate(yesterday)

  const entries: TodayEntry[] = []
  let order = 0

  for (const item of yesterdayRoute.items) {
    const span = itemSpan(item)
    // Only occurrences that reach past local midnight can belong to today...
    if (span.end <= MINUTES_PER_DAY) continue
    // ...and only for as long as they are actually running.
    const start = span.start - MINUTES_PER_DAY
    const end = span.end - MINUTES_PER_DAY
    if (nowMinutes < start || nowMinutes >= end) continue
    entries.push(
      toEntry({
        item,
        route: yesterdayRoute,
        anchor: yesterday,
        offset: -MINUTES_PER_DAY,
        spillover: true,
        order: order++,
      }),
    )
  }

  for (const item of todayRoute.items) {
    entries.push(
      toEntry({
        item,
        route: todayRoute,
        anchor: today,
        offset: 0,
        spillover: false,
        order: order++,
      }),
    )
  }

  for (const entry of entries) {
    if (completed.has(entry.key)) {
      entry.completed = true
      entry.status = 'DONE_EARLIER'
      continue
    }
    entry.status = timeStatus(entry, nowMinutes)
  }

  // Exactly one upcoming item is NEXT: the closest one still unfinished.
  let next: TodayEntry | undefined
  for (const entry of entries) {
    if (entry.status !== 'LATER') continue
    if (
      !next ||
      entry.start < next.start ||
      (entry.start === next.start && entry.order < next.order)
    ) {
      next = entry
    }
  }
  if (next) next.status = 'NEXT'

  return { day: todayKey, route: todayRoute, nowMinutes, entries, holiday: false }
}
