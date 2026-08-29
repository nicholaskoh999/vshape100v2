import { timeLabelFor } from './format'
import { routeForDate } from './routines'
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

function declaredStart(item: RoutineItem): number {
  return item.kind === 'moment' ? item.at : item.start
}

function declaredEnd(item: RoutineItem): number {
  return item.kind === 'moment' ? item.at : Math.max(item.start, item.end)
}

/**
 * The span an item occupies within its own route.
 *
 * Intervals and windows carry their own bounds. A `moment` has no duration of
 * its own, so it holds the current slot until the next thing in the route
 * begins — derived from the accepted routine rather than an invented grace
 * period. A moment with nothing after it holds until the route ends.
 */
export function itemSpan(
  item: RoutineItem,
  items: readonly RoutineItem[],
): { start: number; end: number } {
  const start = declaredStart(item)
  if (item.kind !== 'moment') return { start, end: declaredEnd(item) }

  let end = Number.POSITIVE_INFINITY
  for (const other of items) {
    const otherStart = declaredStart(other)
    if (otherStart > start && otherStart < end) end = otherStart
  }
  if (end === Number.POSITIVE_INFINITY) {
    end = Math.max(start, ...items.map(declaredEnd))
  }
  return { start, end }
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
  const span = itemSpan(item, route.items)
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
 * contributes only the occurrences that reach past local midnight, so at
 * Tuesday 00:15 Monday's `23:30–00:30` block is still the current item, and
 * on Sunday at 01:30 Saturday's `01:00–03:00` block is.
 */
export function buildAgenda(
  now: Date,
  completed: ReadonlySet<string> = EMPTY_COMPLETED,
): TodayAgenda {
  const today = startOfLocalDay(now)
  const yesterday = addDays(today, -1)
  const todayRoute = routeForDate(today)
  const yesterdayRoute = routeForDate(yesterday)
  const nowMinutes = minutesOfDay(now)

  const entries: TodayEntry[] = []
  let order = 0

  for (const item of yesterdayRoute.items) {
    if (itemSpan(item, yesterdayRoute.items).end <= MINUTES_PER_DAY) continue
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

  return { day: dayKey(today), route: todayRoute, nowMinutes, entries }
}
