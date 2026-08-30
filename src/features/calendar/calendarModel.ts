/**
 * Month grid and day typing for the Calendar.
 *
 * Pure: every function is a total function of its arguments, so the month view
 * and its tests share exactly the same derivation. Dates are local calendar
 * text throughout — nothing here builds a `Date` from a string.
 */

import {
  addLocalDays,
  fromDayIndex,
  isWithinRange,
  toDayIndex,
  weekdayOf,
} from '@shared/localDate'
import type { HolidayRecord } from '@shared/holiday'

/**
 * What a calendar day is.
 *
 * `holiday` is an OVERRIDE: it replaces whatever the weekday would otherwise
 * have been, which is why it is resolved first below.
 */
export type DayType = 'training' | 'saturday' | 'sunday' | 'holiday'

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  training: 'Training',
  saturday: 'Chill',
  sunday: 'Recovery',
  holiday: 'Holiday',
}

/** One cell of the month grid. */
export type CalendarDay = {
  /** Local `YYYY-MM-DD`. */
  date: string
  /** Day of month, for the label. */
  dayOfMonth: number
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean
  type: DayType
  /** The Holiday covering this day, when there is one. */
  holiday: HolidayRecord | null
}

/** Month names, from the calendar parts — never locale-parsed from a string. */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Weekday headers, Monday first — the training week starts on Monday. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** `2026-09` → `September 2026`. */
export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`
}

/** The Holiday covering a date, or null. */
export function holidayFor(
  date: string,
  holidays: readonly HolidayRecord[],
): HolidayRecord | null {
  for (const holiday of holidays) {
    if (isWithinRange(date, holiday.startDate, holiday.endDate)) return holiday
  }
  return null
}

/**
 * The type of one day.
 *
 * Holiday wins: it is an override of the underlying weekday, not a peer of it,
 * so a Holiday Saturday reads as Holiday rather than Chill.
 */
export function dayTypeFor(date: string, holidays: readonly HolidayRecord[]): DayType {
  if (holidayFor(date, holidays)) return 'holiday'
  const weekday = weekdayOf(date)
  if (weekday === 0) return 'sunday'
  if (weekday === 6) return 'saturday'
  return 'training'
}

/** First day of a month as a local date. */
export function firstOfMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}

/** Step a year/month pair by whole months. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 }
}

/** The year/month a local date belongs to. */
export function monthOf(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) }
}

/**
 * The Monday-first grid for a month, padded to whole weeks.
 *
 * Padding days belong to the neighbouring months and are marked `inMonth:
 * false` so the UI can dim them; they still carry a real date and a real type,
 * because a Holiday can legitimately span the boundary.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  holidays: readonly HolidayRecord[] = [],
): CalendarDay[] {
  const first = firstOfMonth(year, month)
  const firstIndex = toDayIndex(first)
  if (firstIndex === null) return []

  // Monday-first: shift Sunday (0) to the end of the week.
  const firstWeekday = (weekdayOf(first) ?? 1)
  const lead = (firstWeekday + 6) % 7

  const next = shiftMonth(year, month, 1)
  const nextFirstIndex = toDayIndex(firstOfMonth(next.year, next.month))
  const daysInMonth = (nextFirstIndex ?? firstIndex) - firstIndex

  const start = firstIndex - lead
  const total = Math.ceil((lead + daysInMonth) / 7) * 7

  const days: CalendarDay[] = []
  for (let offset = 0; offset < total; offset += 1) {
    const date = fromDayIndex(start + offset)
    const holiday = holidayFor(date, holidays)
    days.push({
      date,
      dayOfMonth: Number(date.slice(8, 10)),
      inMonth: date.slice(0, 7) === first.slice(0, 7),
      type: holiday ? 'holiday' : dayTypeFor(date, []),
      holiday,
    })
  }
  return days
}

/** The inclusive span a grid covers, for the list read. */
export function gridSpan(days: readonly CalendarDay[]): { from: string; to: string } | null {
  if (days.length === 0) return null
  return { from: days[0].date, to: days[days.length - 1].date }
}

/** An ordered inclusive selection from two clicked dates. */
export function orderSelection(a: string, b: string): { start: string; end: string } {
  return a <= b ? { start: a, end: b } : { start: b, end: a }
}

/** How many days an inclusive selection covers. */
export function selectionLength(start: string, end: string): number {
  const from = toDayIndex(start)
  const to = toDayIndex(end)
  if (from === null || to === null) return 0
  return to - from + 1
}

/** `2026-09-10` → `10 Sep 2026`. Formatted from the parts, never parsed. */
export function formatLocalDate(date: string): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1]
  if (!month) return date
  return `${Number(date.slice(8, 10))} ${month.slice(0, 3)} ${date.slice(0, 4)}`
}

/** "10 Sep 2026" or "10 – 14 Sep 2026" for a range. */
export function formatRange(start: string, end: string): string {
  if (start === end) return formatLocalDate(start)
  return `${formatLocalDate(start)} – ${formatLocalDate(end)}`
}

/** The day after a date, for extending a selection. Null when malformed. */
export function nextDay(date: string): string | null {
  return addLocalDays(date, 1)
}
