import { MINUTES_PER_DAY, type RoutineItem, type RouteMinute } from './types'

const EN_DASH = '–'

/**
 * Route minutes → wall clock. Values past 24:00 wrap, so Saturday's
 * `25:00 → 27:00` sleep block reads `01:00` / `03:00`.
 */
export function formatRouteMinute(minute: RouteMinute): string {
  const normalised = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hours = Math.floor(normalised / 60)
  const minutes = normalised % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * The label shown next to an item.
 *
 * Flexible (`window`) items never get a clock range — they show the semantic
 * label the routine accepted instead.
 */
export function timeLabelFor(item: RoutineItem): string {
  switch (item.kind) {
    case 'moment':
      return formatRouteMinute(item.at)
    case 'interval':
      return `${formatRouteMinute(item.start)} ${EN_DASH} ${formatRouteMinute(item.end)}`
    case 'window':
      return item.windowLabel
  }
}

/** Short relative hint, e.g. `in 12 min` / `in 2 h 05`. */
export function formatLead(minutes: number): string {
  if (minutes <= 0) return 'now'
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `in ${hours} h` : `in ${hours} h ${String(rest).padStart(2, '0')}`
}
