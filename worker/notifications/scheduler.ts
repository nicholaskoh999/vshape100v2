/**
 * The scheduled sweep.
 *
 * Once a minute, for every subscribed device: convert the cron event's
 * scheduled minute into THAT device's local wall clock, ask the accepted Today
 * engine what starts exactly then, drop anything already done, and send at
 * most one notification.
 *
 * ## It decides nothing about the schedule
 *
 * Every clock time, the route for the day, the Holiday recovery base, the
 * Training-On overlay, cross-midnight anchoring and previous-day spillover
 * suppression come from shared/today via `dueAt`. This file contains no times
 * and no weekday mapping.
 *
 * ## Fail closed, always
 *
 * A reminder is a claim that something is due. If any truth needed to make
 * that claim is missing — the device's timezone, the day's Holiday state, the
 * completion record, or the workout behind a gym reminder — nothing is sent.
 * Guessing "probably Home", "probably not a Holiday" or "probably not done"
 * would buzz someone about a day they had taken off, or about work they had
 * already finished.
 */

import {
  dueAt,
  gymSessionOf,
  notificationFor,
  type DueItem,
} from '../../shared/notifications/due'
import {
  toEpochMinute,
  wallClockIn,
} from '../../shared/notifications/subscription'
import { completionDayRange, dayKey, type HolidayDays } from '../../shared/today/engine'
import {
  DELIVERY_RETENTION_MINUTES,
  MAX_DELIVERY_ATTEMPTS,
  MAX_SWEEP_SUBSCRIPTIONS,
  type PushStore,
  type PushSubscriptionRow,
} from './notifications'
import { sendPush, type PushOutcome, type VapidConfig } from '../push/webPush'

/**
 * The reads a sweep needs, each able to say "I do not know".
 *
 * Every one returns null on failure rather than an empty value, because an
 * empty value is a claim: "no holidays" and "nothing completed" are answers,
 * and a failed read is not entitled to give them.
 */
export type ScheduleTruth = {
  holidaysFor(
    googleSub: string,
    from: string,
    to: string,
  ): Promise<HolidayDays | null>

  completionsFor(
    googleSub: string,
    from: string,
    to: string,
  ): Promise<ReadonlySet<string> | null>

  /** Has this workout been genuinely finished, under the accepted rule? */
  workoutFinished(
    googleSub: string,
    date: string,
    sessionId: string,
  ): Promise<boolean | null>
}

export type SweepResult = {
  /** Devices considered. */
  examined: number
  /** Notifications actually handed to a push service. */
  sent: number
  /** Devices skipped because required truth was unavailable. */
  withheld: number
  /** Subscriptions retired because the push service said they were gone. */
  retired: number
  /** Occurrences a push service refused, which may be attempted again. */
  retryable: number
  /** Present only when nothing could be sent at all. */
  reason?: 'not_configured'
}

type SendFn = typeof sendPush

/**
 * Resolve what this one device should receive, or null to withhold.
 *
 * Split out from the loop so the fail-closed decisions are all in one place
 * and individually testable.
 */
export async function dueForSubscription(
  subscription: PushSubscriptionRow,
  scheduledTime: number,
  truth: ScheduleTruth,
): Promise<DueItem[] | null> {
  // The device's own wall clock. Without a usable zone there is no local
  // minute to evaluate, so the device is simply not eligible.
  const local = wallClockIn(new Date(scheduledTime), subscription.timezone)
  if (!local) return null

  // The same two-day window Today uses, so a cross-midnight occurrence's
  // anchor day is covered.
  const range = completionDayRange(local)

  const holidays = await truth.holidaysFor(subscription.googleSub, range.from, range.to)
  if (holidays === null) return null

  const completed = await truth.completionsFor(subscription.googleSub, range.from, range.to)
  if (completed === null) return null

  const due = dueAt(local, completed, holidays)
  if (due.length === 0) return []

  // A gym reminder carries a second kind of truth: the workout itself. Someone
  // who trained early has finished the thing being reminded about, even though
  // no routine completion was ticked.
  const kept: DueItem[] = []
  for (const item of due) {
    const session = gymSessionOf(item)
    if (session === null) {
      kept.push(item)
      continue
    }

    const finished = await truth.workoutFinished(
      subscription.googleSub,
      // The anchor day owns the occurrence, so it owns the workout too.
      item.anchorDay,
      session,
    )
    // Unreadable workout truth withholds the WHOLE notification: sending the
    // rest would still be sending on the strength of a read that failed.
    if (finished === null) return null
    if (!finished) kept.push(item)
  }

  return kept
}

/**
 * Run one scheduled minute.
 *
 * `scheduledTime` is the cron event's own timestamp, not the wall clock at
 * execution. Cloudflare may start a scheduled event a little late, and a 20:30
 * event that begins at 20:30:20 is still the 20:30 event — using execution
 * time would silently skip the minute it was meant to serve.
 */
export async function runScheduledSweep(input: {
  scheduledTime: number
  store: PushStore
  truth: ScheduleTruth
  vapid: VapidConfig | null
  now?: number
  send?: SendFn
}): Promise<SweepResult> {
  const { scheduledTime, store, truth, vapid } = input
  const now = input.now ?? scheduledTime
  const send = input.send ?? sendPush

  const result: SweepResult = { examined: 0, sent: 0, withheld: 0, retired: 0, retryable: 0 }

  // No VAPID configuration means no way to authenticate a push. That is a
  // deployment state, not an error: the rest of the app keeps working and the
  // sweep simply sends nothing.
  if (!vapid) return { ...result, reason: 'not_configured' }

  const triggerMinute = toEpochMinute(new Date(scheduledTime))
  const subscriptions = await store.listAll(MAX_SWEEP_SUBSCRIPTIONS)

  for (const subscription of subscriptions) {
    result.examined += 1

    let due: DueItem[] | null
    try {
      due = await dueForSubscription(subscription, scheduledTime, truth)
    } catch {
      // A thrown read is an unknown, not a "nothing due".
      due = null
    }

    if (due === null) {
      result.withheld += 1
      continue
    }
    if (due.length === 0) continue

    const notification = notificationFor(due)
    if (!notification) continue

    // Claim BEFORE sending. An overlapping invocation, an already-sent
    // occurrence and a terminally-failed one all lose here, so one device
    // gets at most one buzz per minute. Only an occurrence the push service
    // explicitly refused can be claimed again.
    const claimed = await store.claimDelivery(
      subscription.id,
      subscription.googleSub,
      triggerMinute,
      now,
      MAX_DELIVERY_ATTEMPTS,
    )
    if (!claimed) continue

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      to: notification.to,
      // Deterministic per device and minute, so a replaced notification
      // collapses onto the previous one instead of stacking.
      tag: `vshape-${triggerMinute}`,
    })

    let outcome: PushOutcome
    try {
      outcome = await send(
        {
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        payload,
        vapid,
        now,
      )
    } catch {
      // A thrown send never produced an answer, so we cannot prove the push
      // service did not take it. Ambiguous, and therefore never retried.
      outcome = { status: 'ambiguous' }
    }

    if (outcome.status === 'sent') {
      result.sent += 1
      await store.markDelivery(subscription.id, triggerMinute, 'sent')
      continue
    }

    if (outcome.status === 'expired') {
      // Gone means gone: retire THIS device and nothing else. The claim is
      // marked terminal, though the subscription it belonged to is leaving.
      await store.markDelivery(subscription.id, triggerMinute, 'rejected')
      result.retired += 1
      await store.removeById(subscription.id)
      continue
    }

    if (outcome.status === 'retryable') {
      // The service refused it outright, so nothing was delivered and the
      // same trigger minute may be attempted again by a later invocation.
      result.retryable += 1
      await store.markDelivery(subscription.id, triggerMinute, 'retryable')
      continue
    }

    // rejected or ambiguous: terminal for this occurrence. The subscription
    // itself stays — one bad minute is not evidence the device is gone.
    await store.markDelivery(
      subscription.id,
      triggerMinute,
      outcome.status === 'rejected' ? 'rejected' : 'ambiguous',
    )
  }

  // Bounded hygiene. Claims are infrastructure, never history.
  await store.pruneDeliveries(triggerMinute - DELIVERY_RETENTION_MINUTES)

  return result
}

/** Local date of an instant in a device's zone, or null. Used by callers. */
export function localDayIn(instant: Date, timeZone: string): string | null {
  const local = wallClockIn(instant, timeZone)
  return local ? dayKey(local) : null
}

/* ------------------------------------------------------------------ */
/* The production retry driver                                         */
/* ------------------------------------------------------------------ */

/**
 * Backoff before each extra attempt, in milliseconds.
 *
 * One entry per retry beyond the first attempt, so the length is bounded by
 * MAX_DELIVERY_ATTEMPTS. Short on purpose: these are exact-time reminders, and
 * the whole sequence has to finish while "20:30" still means something. Eight
 * seconds of total patience sits comfortably inside one cron minute and
 * nowhere near the push TTL.
 */
export const RETRY_BACKOFF_MS = [2_000, 6_000]

/** Real waiting. Injectable so a test does not have to sit through it. */
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type DeliveryRun = {
  /** One entry per attempt actually made. */
  attempts: SweepResult[]
  /** Notifications delivered across the whole run. */
  sent: number
  /** Occurrences still refused when the run gave up. */
  unresolved: number
}

/**
 * Deliver one scheduled minute, retrying the refusals it is safe to retry.
 *
 * ## Why this exists
 *
 * Correction 1 made a refused occurrence RECLAIMABLE, but nothing ever came
 * back to reclaim it: the scheduled handler ran one sweep and returned
 * successfully, so a 503 became a `retryable` row that no code would ever pick
 * up again. The reclaim was correct and unreachable.
 *
 * Rather than assume Cloudflare replays a scheduled event — which is not
 * something to bet a feature on — the retry happens HERE, inside the same
 * invocation, driven by what the sweep reports.
 *
 * ## The scheduled minute never moves
 *
 * Every attempt passes the ORIGINAL `scheduledTime`. That keeps one identity
 * for the occurrence across the whole run: the same local wall clock is
 * evaluated, the same trigger minute is claimed, and a device that already
 * received its notification is excluded by its own `sent` claim rather than by
 * anything this loop remembers.
 *
 * Everything else the claim already decides: `rejected`, `ambiguous` and
 * `expired` are terminal, so a retry sweep simply does not re-claim them, and
 * a device that succeeded on attempt one cannot be sent to on attempt two.
 */
export async function runScheduledDelivery(input: {
  scheduledTime: number
  store: PushStore
  truth: ScheduleTruth
  vapid: VapidConfig | null
  now?: number
  send?: SendFn
  sleep?: (ms: number) => Promise<void>
}): Promise<DeliveryRun> {
  const sleep = input.sleep ?? realSleep
  const attempts: SweepResult[] = []

  for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    const result = await runScheduledSweep({
      scheduledTime: input.scheduledTime,
      store: input.store,
      truth: input.truth,
      vapid: input.vapid,
      // The scheduled minute is the truth for every attempt; only the wall
      // clock used for claim bookkeeping moves on.
      now: input.now,
      send: input.send,
    })
    attempts.push(result)

    // Nothing was refused in a way worth retrying, so the run is done. This is
    // also the exit for an unconfigured deployment, which reports no work.
    if (result.retryable === 0) break

    const backoff = RETRY_BACKOFF_MS[attempt]
    // Out of budget: the remaining refusals stay `retryable` in the table,
    // which is honest — they were not delivered and nothing pretended
    // otherwise.
    if (backoff === undefined) break

    await sleep(backoff)
  }

  return {
    attempts,
    sent: attempts.reduce((total, result) => total + result.sent, 0),
    unresolved: attempts[attempts.length - 1]?.retryable ?? 0,
  }
}
