/**
 * Today domain model.
 *
 * Deliberately small: enough shape to describe the accepted Home Mode /
 * Saturday / Sunday routes honestly, and nothing else. No persistence, no
 * scheduling beyond the current day and its spillover.
 *
 * ## Time representation
 *
 * Every routine time is a **route minute**: minutes since 00:00 of the day the
 * route is anchored to. Values are allowed to run past 1440 so that an
 * interval can cross midnight without being truncated — `23:30–00:30` is
 * `1410 → 1470`, and Saturday's `01:00–03:00` sleep block is `1500 → 1620`
 * because it belongs to the Saturday route even though it lands on Sunday's
 * calendar date.
 */

/** Which accepted route a day follows. */
export type RouteId = 'home' | 'saturday' | 'sunday'

/** Minutes since 00:00 of the anchoring day. May exceed 1440 (see above). */
export type RouteMinute = number

export const MINUTES_PER_DAY = 1440

/**
 * How precisely an item is scheduled.
 *
 * - `moment`   — a fixed point in time, e.g. `07:30 Wake up`. It occupies
 *                exactly the minute it is scheduled for: NOW at 07:30, LATE
 *                at 07:31 if untouched. It is never widened into an interval.
 * - `interval` — a fixed start and end, e.g. `20:30–21:30 Gym training`.
 *                Crossing midnight is just an end past 1440.
 * - `window`   — a *flexible* item. The user never accepted an exact clock
 *                range for it, so the engine stores a coarse availability
 *                window purely for ordering and never renders it as a clock
 *                time. The UI shows `windowLabel` instead.
 */
export type ItemKind = 'moment' | 'interval' | 'window'

type ItemBase = {
  /** Stable slug, unique within a route. */
  id: string
  title: string
  /** One short supporting line. Optional. */
  note?: string
  icon: TodayIcon
  /** Optional in-app destination, e.g. the training session for the gym slot. */
  to?: string
}

export type MomentItem = ItemBase & {
  kind: 'moment'
  at: RouteMinute
}

export type IntervalItem = ItemBase & {
  kind: 'interval'
  start: RouteMinute
  end: RouteMinute
}

export type WindowItem = ItemBase & {
  kind: 'window'
  /**
   * Coarse availability bounds. These are an engine convention derived from
   * the surrounding accepted anchors (e.g. "after work" starts when work
   * ends) — they are NOT user-accepted clock times and must never be shown
   * as one.
   */
  start: RouteMinute
  end: RouteMinute
  /** Semantic label shown instead of a clock range, e.g. "Evening · 1 hour". */
  windowLabel: string
}

export type RoutineItem = MomentItem | IntervalItem | WindowItem

export type Route = {
  id: RouteId
  /** Shown as the day's route name, e.g. "Home Mode". */
  label: string
  /** One line describing the shape of the day. */
  summary: string
  items: RoutineItem[]
}

/** The five accepted Today states. */
export type TodayStatus = 'NOW' | 'NEXT' | 'LATER' | 'LATE' | 'DONE_EARLIER'

/**
 * One routine item resolved against a concrete day.
 *
 * `start`/`end` are normalised to minutes relative to **the reference day's
 * 00:00**, so a spillover instance from yesterday carries negative values
 * (`23:30` yesterday is `-30`). A spillover occurrence is present only while
 * it is still running; once it ends it leaves today's agenda entirely.
 */
export type TodayEntry = {
  /**
   * Identity of this occurrence: `<anchor day>:<item id>`. Yesterday's
   * spillover and today's same-named item are different occurrences, so
   * completing one never completes the other.
   */
  key: string
  item: RoutineItem
  /** Calendar date (local, `YYYY-MM-DD`) the item's route is anchored to. */
  anchorDay: string
  routeId: RouteId
  /** True when this occurrence came from the previous day's route. */
  spillover: boolean
  start: number
  end: number
  status: TodayStatus
  completed: boolean
  /** Stable tiebreak: order of declaration, spillover occurrences first. */
  order: number
  /** `20:30 – 21:30`, `07:30`, or the window label for flexible items. */
  timeLabel: string
  /** Flexible items never render a clock time. */
  flexible: boolean
  /** The occurrence spans local midnight. */
  crossesMidnight: boolean
}

export type TodayAgenda = {
  /** Reference calendar day (local, `YYYY-MM-DD`). */
  day: string
  route: Route
  /** Minutes since the reference day's 00:00. */
  nowMinutes: number
  /** Every occurrence, already in display order. */
  entries: TodayEntry[]
}

/** Icon slugs the Today UI knows how to render (Lucide only). */
export type TodayIcon =
  | 'sunrise'
  | 'work'
  | 'home'
  | 'cook'
  | 'dinner'
  | 'gym'
  | 'shower'
  | 'reading'
  | 'netflix'
  | 'sleep'
  | 'chill'
  | 'progress'
  | 'reset'
