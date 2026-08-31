/**
 * Push subscription rules and the storage boundary.
 *
 * A subscription belongs to a BROWSER. Enabling reminders here must never
 * speak for another device, and disabling here must never silence one.
 *
 * This module owns the rules; it never talks to D1 and never touches HTTP,
 * matching holiday/holiday.ts and workouts/workouts.ts.
 */

import { hashEndpoint, type PushSubscriptionInput } from '../../shared/notifications/subscription'

export * from '../../shared/notifications/subscription'

/** A stored subscription. The account is present but never leaves the server. */
export type PushSubscriptionRow = {
  id: string
  googleSub: string
  endpoint: string
  endpointHash: string
  p256dh: string
  auth: string
  timezone: string
  createdAt: number
  updatedAt: number
}

/**
 * Storage boundary.
 *
 * `upsertByEndpoint` is deliberately keyed on the endpoint hash rather than on
 * the account: one browser endpoint may exist exactly once in the whole table.
 * That is what stops a device that signed into a second account from staying
 * attached to the first and receiving both accounts' reminders.
 */
export interface PushStore {
  /** Insert or replace the row for this endpoint, under this account. */
  upsertByEndpoint(row: PushSubscriptionRow): Promise<void>

  /** The subscription for an endpoint, whatever account holds it. */
  findByEndpointHash(endpointHash: string): Promise<PushSubscriptionRow | null>

  /** Remove an endpoint owned by this account. Returns whether a row went. */
  removeOwned(googleSub: string, endpointHash: string): Promise<boolean>

  /** Remove by internal id, used when a push service says it is gone. */
  removeById(id: string): Promise<boolean>

  /** Every subscription, for the scheduled sweep. */
  listAll(limit: number): Promise<PushSubscriptionRow[]>

  /**
   * Claim one (subscription, trigger minute) pair.
   *
   * Returns true only for the caller that created the claim. A concurrent or
   * retried invocation loses and must not send. The claim is a conditional
   * INSERT, not a read-then-write, so two overlapping cron events cannot both
   * believe they were first.
   */
  claimDelivery(
    subscriptionId: string,
    googleSub: string,
    triggerMinute: number,
    now: number,
  ): Promise<boolean>

  /** Record the outcome of a claim. Never gates correctness. */
  markDelivery(subscriptionId: string, triggerMinute: number, status: 'sent' | 'failed'): Promise<void>

  /** Drop claims older than a cutoff. Operational hygiene only. */
  pruneDeliveries(beforeMinute: number): Promise<void>
}

/** Most subscriptions one scheduled sweep will consider. */
export const MAX_SWEEP_SUBSCRIPTIONS = 500

/** How long delivery claims are kept. Two days is ample for retry windows. */
export const DELIVERY_RETENTION_MINUTES = 2 * 24 * 60

export function newSubscriptionId(): string {
  return crypto.randomUUID()
}

/**
 * Register or reconcile this browser's subscription.
 *
 * Called both when the user first enables reminders and, silently, whenever an
 * already-enabled browser reports a different timezone — travel should follow
 * the same local-clock semantics the Today page already uses, and that must
 * not require asking for permission again.
 *
 * If the endpoint is already stored under a DIFFERENT account, the row is
 * replaced rather than duplicated, so the device ends up attached to exactly
 * the account that is signed in now.
 */
export async function saveSubscription(
  store: PushStore,
  googleSub: string,
  input: PushSubscriptionInput,
  now: number = Date.now(),
  id: string = newSubscriptionId(),
): Promise<PushSubscriptionRow> {
  const endpointHash = await hashEndpoint(input.endpoint)
  const existing = await store.findByEndpointHash(endpointHash)

  const row: PushSubscriptionRow = {
    // Keep the id when this is the same device re-registering, so delivery
    // claims already made for this minute still apply to it.
    id: existing && existing.googleSub === googleSub ? existing.id : id,
    googleSub,
    endpoint: input.endpoint,
    endpointHash,
    p256dh: input.p256dh,
    auth: input.auth,
    timezone: input.timezone,
    createdAt: existing && existing.googleSub === googleSub ? existing.createdAt : now,
    updatedAt: now,
  }

  await store.upsertByEndpoint(row)
  return row
}

/**
 * Disable reminders for THIS browser.
 *
 * Scoped to the account and the endpoint, so it can neither silence another
 * device nor remove a subscription belonging to somebody else.
 */
export async function removeSubscription(
  store: PushStore,
  googleSub: string,
  endpoint: string,
): Promise<boolean> {
  return store.removeOwned(googleSub, await hashEndpoint(endpoint))
}

/** The browser-safe view of a subscription. No endpoint, no keys, no account. */
export type SubscriptionStatus = {
  enabled: boolean
  /** Echoed so a device can tell whether the server agrees with its clock. */
  timezone: string | null
}

export function toStatus(row: PushSubscriptionRow | null): SubscriptionStatus {
  return row ? { enabled: true, timezone: row.timezone } : { enabled: false, timezone: null }
}
