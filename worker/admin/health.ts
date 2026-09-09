/**
 * Health classification — the rules, with no I/O.
 *
 * THE ONE PRINCIPLE: a status is a CLAIM, and every claim here has to be backed
 * by something this build actually observed. Where there is no evidence the
 * answer is `unknown`, and `unknown` is never rounded up to `healthy` because a
 * row of green ticks looks better.
 *
 * That matters most for the scheduler. This app records no heartbeat: the
 * scheduled sweep writes to `notification_deliveries` only when a reminder is
 * genuinely due, so an empty ledger is the normal state of a quiet Tuesday
 * afternoon and proves nothing at all about whether cron is running. The one
 * thing that IS evidence is a recent claim — the handler cannot have written it
 * without running.
 */

import type { CronReason, HealthStatus } from '../../shared/admin'

/**
 * How recent a delivery claim has to be to count as evidence the sweep ran.
 *
 * Ten minutes, against a once-a-minute cron. Generous enough to absorb a late
 * invocation and a quiet stretch between reminders; short enough that "the
 * scheduler ran" still means something close to now.
 */
export const CRON_FRESH_MS = 10 * 60 * 1000

/** What a read of the delivery ledger turned up. */
export type SweepReading =
  /** The ledger was read. `at` is the newest claim, or null when there are none. */
  | { readable: true; at: number | null }
  /** The ledger could not be read at all. */
  | { readable: false }

export type CronHealth = {
  status: HealthStatus
  reason: CronReason
  lastSweepAt: number | null
}

/**
 * Classify the cron / notification scheduler.
 *
 * Order matters. Unconfigured VAPID is checked FIRST because it is the one
 * condition that is certainly wrong and certainly provable: the sweep may be
 * running perfectly and still be unable to deliver anything, and a page that
 * reported that as "unknown" would be hiding a real, fixable fault behind a
 * shrug.
 *
 * Everything after it is an absence of evidence, and all of it reads `unknown`.
 */
export function classifyCron(input: {
  vapidConfigured: boolean
  sweep: SweepReading
  now: number
  freshMs?: number
}): CronHealth {
  const lastSweepAt = input.sweep.readable ? input.sweep.at : null

  if (!input.vapidConfigured) {
    return { status: 'warning', reason: 'vapid_unconfigured', lastSweepAt }
  }
  if (!input.sweep.readable) {
    return { status: 'unknown', reason: 'unreadable', lastSweepAt: null }
  }
  if (input.sweep.at === null) {
    // An empty ledger is not a failure. Nothing was due.
    return { status: 'unknown', reason: 'no_observed_sweep', lastSweepAt: null }
  }

  const freshMs = input.freshMs ?? CRON_FRESH_MS
  const age = input.now - input.sweep.at
  // A claim dated in the future is not evidence of anything; it is a clock
  // disagreement. Treated as stale rather than as a fresh sweep.
  if (age >= 0 && age <= freshMs) {
    return { status: 'healthy', reason: 'observed_sweep', lastSweepAt: input.sweep.at }
  }
  return { status: 'unknown', reason: 'stale_observation', lastSweepAt: input.sweep.at }
}
