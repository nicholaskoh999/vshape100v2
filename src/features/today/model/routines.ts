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
 * Home Mode — Monday to Friday.
 *
 * `weekday` is a JS day index (1 = Monday … 5 = Friday); it only decides which
 * training session the gym slot links to.
 */
function homeRoute(weekday: number): Route {
  const sessionId = weekdaySessionIds[weekday - 1]

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
    {
      kind: 'interval',
      id: 'gym-training',
      title: 'Gym training',
      start: at(20, 30),
      end: at(21, 30),
      icon: 'gym',
      ...(sessionId ? { to: `/training/${sessionId}` } : {}),
    },
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
 * Sunday — Recovery route.
 *
 * Nothing on Sunday has an accepted clock time, so every item is a window.
 */
function sundayRoute(): Route {
  const items: RoutineItem[] = [
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
      note: 'No gym today.',
    },
  ]

  return {
    id: 'sunday',
    label: 'Recovery route',
    summary: 'Natural wake, weekly progress check, room reset. No gym.',
    items,
  }
}

/**
 * The route for a Holiday date.
 *
 * Deliberately empty. Holiday is EXEMPT: suspending the day's pressure means
 * there is nothing to do, not a list of things quietly marked complete.
 */
export function holidayRoute(): Route {
  return {
    id: 'holiday',
    label: 'Holiday',
    summary: 'A planned pause from the normal routine. Foundation Day continues.',
    items: [],
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
