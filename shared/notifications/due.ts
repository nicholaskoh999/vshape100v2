/**
 * What is due at a given minute.
 *
 * This is NOT a scheduler. It asks the accepted Today engine what the day
 * holds and then filters, so every clock time, every route, the Holiday
 * recovery base, the Training-On overlay, cross-midnight anchoring and
 * previous-day spillover suppression all come from the one definition in
 * shared/today. Nothing here restates 07:30 or 20:30, and nothing here decides
 * what a Holiday means.
 *
 * ## Only exact times notify
 *
 * A `window` item carries ordering bounds, not an accepted clock time — the
 * user never agreed that "Room reset" happens at 17:00, only that it happens
 * in the evening. Turning those bounds into an alarm would invent a promise
 * the product never made, so windows are excluded outright. That is why a
 * Holiday recovery day sends nothing: every one of its items is a window.
 */

import { buildAgenda, minutesOfDay, type HolidayDays } from '../today/engine'
import type { TodayEntry } from '../today/types'

/** One item that starts exactly now, ready to be delivered. */
export type DueItem = {
  /**
   * The Today occurrence key, `anchorDay:itemId`.
   *
   * The SAME identity the page and the completion store use, which is what
   * makes cross-midnight correct: Saturday's 01:00 sleep block is keyed to
   * Saturday, the day whose route owns it, not to the Sunday it lands on.
   */
  key: string
  itemId: string
  title: string
  /**
   * The local date whose route owns this occurrence.
   *
   * Not necessarily the date it lands on: Saturday's 01:00 sleep block is
   * anchored to Saturday. Anything looking up per-day truth for the item must
   * use THIS date, not the calendar date of the trigger.
   */
  anchorDay: string
  /** Same-origin app route this item links to, when it has one. */
  to?: string
}

/** The gym item's id, the one occurrence that also has workout truth. */
export const GYM_ITEM_ID = 'gym-training'

/**
 * The training session a due gym item refers to.
 *
 * Read back out of the item's own link rather than re-deriving it from the
 * weekday, so there is no second copy of the weekday-to-session mapping — the
 * link was built from `sessionIdForWeekday` and this simply reads it.
 */
export function gymSessionOf(item: DueItem): string | null {
  if (item.itemId !== GYM_ITEM_ID) return null
  const match = /^\/training\/([a-z]+)$/.exec(item.to ?? '')
  return match ? match[1] : null
}

/** Does this entry have an accepted clock start, rather than ordering bounds? */
export function hasExactStart(entry: TodayEntry): boolean {
  return entry.item.kind === 'moment' || entry.item.kind === 'interval'
}

/**
 * Everything that begins at this exact local minute and is still outstanding.
 *
 * `now` is already the device's own local wall clock — the caller converts,
 * because only the caller knows which timezone this device is in.
 *
 * Completed occurrences are dropped here rather than at delivery, so an item
 * finished early is simply never due.
 */
export function dueAt(
  now: Date,
  completed: ReadonlySet<string>,
  holidayDays: HolidayDays,
): DueItem[] {
  const agenda = buildAgenda(now, completed, holidayDays)
  const minute = minutesOfDay(now)

  return agenda.entries
    .filter(hasExactStart)
    // `start` is measured against the reference day's midnight, so a spillover
    // occurrence is already offset into today's frame and compares directly.
    .filter((entry) => entry.start === minute)
    .filter((entry) => !entry.completed)
    .map((entry) => ({
      key: entry.key,
      itemId: entry.item.id,
      title: entry.item.title,
      anchorDay: entry.anchorDay,
      ...(entry.item.to ? { to: entry.item.to } : {}),
    }))
}

/**
 * The one notification for a minute, or null when nothing is due.
 *
 * Two items can legitimately start in the same minute — 17:30 is both "Back
 * home" and "Cook dinner + shower" — and two banners for one moment is two
 * interruptions for one event. They are coalesced into a single notification.
 *
 * The click target is only inherited when exactly ONE item is due; with
 * several, no single destination is the right one, so it opens Today.
 */
export type DueNotification = {
  title: string
  body: string
  /** Same-origin path only. Never a URL from anywhere else. */
  to: string
  /** Deterministic per trigger minute, so a retry replaces rather than stacks. */
  items: DueItem[]
}

export const TODAY_PATH = '/today'

export function notificationFor(due: readonly DueItem[]): DueNotification | null {
  if (due.length === 0) return null

  const titles = due.map((item) => item.title)
  const single = due.length === 1 ? due[0] : null

  return {
    title: single ? single.title : 'Up now',
    // Factual: what is starting, nothing more. No streak pressure, no urging.
    body: titles.join(' · '),
    to: single?.to ?? TODAY_PATH,
    items: [...due],
  }
}
