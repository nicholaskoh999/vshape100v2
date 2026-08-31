import type { Route, RouteId, RoutineItem, RouteMinute } from './types'
import { MINUTES_PER_DAY } from './types'

/**
 * The accepted daily routes.
 *
 * Every clock value below comes straight from the accepted routine. Where the
 * routine is deliberately flexible ("after work", "morning / afternoon",
 * "evening 1-hour reset") the item is a `window`: the engine still needs
 * bounds to order the day, but those bounds are a documented convention and
 * the UI renders `windowLabel` instead of a clock range.
 */

/** `h:m` → route minutes. Values past 24:00 stay past 24:00 on purpose. */
export function at(hours: number, minutes = 0): RouteMinute {
  return hours * 60 + minutes
}

/**
 * Coarse day parts used ONLY as ordering bounds for flexible items.
 * These are not accepted clock times and are never displayed.
 */
export const dayPart = {
  morningStart: at(6),
  middayStart: at(12),
  eveningStart: at(17),
  nightStart: at(22),
  dayEnd: MINUTES_PER_DAY,
} as const

const weekdaySessionIds = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

/**
 * The training session a weekday plans, or null when it plans none.
 *
 * `weekday` is a JS day index (0 = Sunday … 6 = Saturday). Saturday and Sunday
 * plan no gym, so they answer null rather than naming a session that does not
 * exist.
 *
 * This is the ONLY Monday-to-Friday mapping in the app. Today's route builds
 * its gym link from it, and anything deriving training days from the calendar
 * reads the same function, so the two cannot drift apart.
 */
export function sessionIdForWeekday(weekday: number): string | null {
  return weekdaySessionIds[weekday - 1] ?? null
}

/**
 * The accepted evening gym slot.
 *
 * The one definition of when training happens and where it links. The Holiday
 * overlay reuses it rather than restating 20:30–21:30, so a Training-On
 * Holiday can never disagree with the ordinary weekday about the session.
 */
export function gymTrainingItem(sessionId: string | null): RoutineItem {
  return {
    kind: 'interval',
    id: 'gym-training',
    title: 'Gym training',
    start: at(20, 30),
    end: at(21, 30),
    icon: 'gym',
    ...(sessionId ? { to: `/training/${sessionId}` } : {}),
  }
}

/** The copy that is only true while nothing is planned. */
const NO_GYM_NOTE = 'No gym today.'

/**
 * Home Mode — Monday to Friday.
 *
 * `weekday` is a JS day index (1 = Monday … 5 = Friday); it only decides which
 * training session the gym slot links to.
 */
function homeRoute(weekday: number): Route {
  const sessionId = sessionIdForWeekday(weekday)

  const items: RoutineItem[] = [
    { kind: 'moment', id: 'wake-up', title: 'Wake up', at: at(7, 30), icon: 'sunrise' },
    {
      kind: 'interval',
      id: 'work',
      title: 'Work',
      start: at(8),
      end: at(17),
      icon: 'work',
    },
    { kind: 'moment', id: 'back-home', title: 'Back home', at: at(17, 30), icon: 'home' },
    {
      kind: 'interval',
      id: 'cook-dinner',
      title: 'Cook dinner + shower',
      start: at(17, 30),
      end: at(18, 30),
      icon: 'cook',
    },
    {
      kind: 'interval',
      id: 'dinner-netflix',
      title: 'Dinner + Netflix',
      start: at(18, 30),
      end: at(20, 30),
      icon: 'dinner',
    },
    gymTrainingItem(sessionId),
    {
      kind: 'interval',
      id: 'shower-rest',
      title: 'Shower + rest',
      start: at(21, 30),
      end: at(22),
      icon: 'shower',
    },
    {
      kind: 'interval',
      id: 'reading',
      title: 'Reading',
      start: at(22),
      end: at(22, 30),
      icon: 'reading',
    },
    {
      kind: 'interval',
      id: 'evening-netflix',
      title: 'Netflix',
      start: at(22, 30),
      end: at(23, 30),
      icon: 'netflix',
    },
    {
      // Crosses midnight: 23:30 → 00:30 is 1410 → 1470, never truncated at 1440.
      kind: 'interval',
      id: 'ready-to-sleep',
      title: 'Ready to sleep',
      start: at(23, 30),
      end: at(24, 30),
      icon: 'sleep',
      note: 'Runs past midnight',
    },
  ]

  return {
    id: 'home',
    label: 'Home Mode',
    summary: 'Work day with gym in the evening.',
    items,
  }
}

/** Saturday — Chill route. Work still happens; the evening is deliberately loose. */
function saturdayRoute(): Route {
  const items: RoutineItem[] = [
    { kind: 'moment', id: 'wake-up', title: 'Wake up', at: at(7, 30), icon: 'sunrise' },
    { kind: 'interval', id: 'work', title: 'Work', start: at(8), end: at(17), icon: 'work' },
    {
      // No exact times were accepted for the Saturday evening, so it is a
      // window bounded by the two things that were: work ending and the
      // sleep block starting.
      kind: 'window',
      id: 'chill',
      title: 'Chill / Netflix / rest',
      start: at(17),
      end: at(25),
      icon: 'chill',
      windowLabel: 'After work · flexible',
      note: 'No gym today.',
    },
    {
      // 01:00–03:00 belongs to the Saturday route even though it lands on
      // Sunday's calendar date: 25:00 → 27:00.
      kind: 'interval',
      id: 'ready-to-sleep',
      title: 'Ready to sleep',
      start: at(25),
      end: at(27),
      icon: 'sleep',
      note: 'After midnight — still Saturday’s route',
    },
  ]

  return {
    id: 'saturday',
    label: 'Chill route',
    summary: 'Work, then a loose evening. No gym.',
    items,
  }
}

/**
 * The Sunday recovery items.
 *
 * Extracted because a Holiday borrows this exact template as its base. One
 * definition means "Sunday" and "the Holiday base day" cannot drift apart —
 * changing the recovery day changes both, which is the point.
 *
 * Nothing here has an accepted clock time, so every item is a window.
 */
function recoveryItems(): RoutineItem[] {
  return [
    {
      kind: 'window',
      id: 'natural-wake',
      title: 'Natural wake',
      start: dayPart.morningStart,
      end: dayPart.middayStart,
      icon: 'sunrise',
      windowLabel: 'No alarm',
      note: 'Wake up whenever the body does.',
    },
    {
      kind: 'window',
      id: 'weekly-progress',
      title: 'Weekly Progress check',
      start: dayPart.morningStart,
      end: dayPart.eveningStart,
      icon: 'progress',
      windowLabel: 'Morning or afternoon',
      to: '/progress',
    },
    {
      kind: 'window',
      id: 'room-reset',
      title: 'Room reset',
      start: dayPart.eveningStart,
      end: dayPart.nightStart,
      icon: 'reset',
      windowLabel: 'Evening · 1 hour',
    },
    {
      kind: 'window',
      id: 'free-time',
      title: 'Free time / Netflix / rest',
      start: dayPart.middayStart,
      end: dayPart.dayEnd,
      icon: 'chill',
      windowLabel: 'Whenever',
      note: NO_GYM_NOTE,
    },
  ]
}

/** Sunday — Recovery route. */
function sundayRoute(): Route {
  return {
    id: 'sunday',
    label: 'Recovery route',
    summary: 'Natural wake, weekly progress check, room reset. No gym.',
    items: recoveryItems(),
  }
}

/** What a Holiday date needs to know about itself to build its route. */
export type HolidayRouteOptions = {
  /** Human-readable name, e.g. "Merdeka Day". Empty when unnamed. */
  name?: string
  /** Did the user choose to keep training on this Holiday? */
  trainingOn?: boolean
  /** JS weekday of the actual date (0 = Sunday), so Training On can pick the
   *  session that weekday already plans. The weekday is NOT changed by the
   *  Holiday — only the routine is. */
  weekday?: number
}

/**
 * The route for a Holiday date.
 *
 * A Holiday suspends the WORK day, so it borrows the Sunday recovery template
 * rather than being empty: there is still a day to live, just not a work one.
 * Work and Back home do not return, because those are what a Holiday removes.
 *
 * Training On adds exactly one thing — the gym session that weekday already
 * planned — and removes the "No gym today" line, which would otherwise
 * contradict the session sitting right below it.
 *
 * Saturday and Sunday Holidays never gain a session: there is no underlying
 * weekday plan to restore, and inventing one would be inventing training the
 * user never scheduled.
 */
export function holidayRoute(options: HolidayRouteOptions = {}): Route {
  const { name = '', trainingOn = false, weekday } = options

  const sessionId =
    trainingOn && weekday !== undefined ? sessionIdForWeekday(weekday) : null
  const training = sessionId !== null

  const items: RoutineItem[] = recoveryItems().map((item) => {
    if (!training || item.note !== NO_GYM_NOTE) return item
    // Drop the note rather than blanking it, so no empty line is rendered.
    const withoutNote = { ...item }
    delete withoutNote.note
    return withoutNote
  })

  if (training) items.push(gymTrainingItem(sessionId))

  return {
    id: 'holiday',
    label: 'Holiday',
    name,
    trainingOn: training,
    // The summary describes what is actually on screen. A Holiday is not an
    // empty day, so it must not be described as one.
    summary: training
      ? 'Work is paused. The recovery-day schedule, plus today’s training session.'
      : 'Work is paused. The recovery-day schedule, and no training required.',
    items,
  }
}

/** Which route a JS day index follows (0 = Sunday). */
export function routeIdForWeekday(weekday: number): RouteId {
  if (weekday === 0) return 'sunday'
  if (weekday === 6) return 'saturday'
  return 'home'
}

/** The accepted route for a calendar date, in local time. */
export function routeForDate(date: Date): Route {
  const weekday = date.getDay()
  if (weekday === 0) return sundayRoute()
  if (weekday === 6) return saturdayRoute()
  return homeRoute(weekday)
}
