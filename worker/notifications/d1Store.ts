/**
 * D1 implementation of the push subscription store.
 *
 * Intentionally thin — all rules live in notifications.ts. Every statement is
 * prepared with bound values; no part of any statement is built from input.
 *
 * `google_sub` appears in the WHERE clause of every ACCOUNT-scoped statement,
 * so a subscription can only be removed under the account that holds it.
 *
 * The one deliberate exception is `upsertByEndpoint`, which is keyed on the
 * endpoint hash ALONE. That is the point: a browser endpoint must exist once
 * in the whole table, so a device that signs into another account is rebound
 * rather than left attached to both.
 */

import type { PushStore, PushSubscriptionRow } from './notifications'

type Row = {
  id: string
  google_sub: string
  endpoint: string
  endpoint_hash: string
  p256dh: string
  auth: string
  timezone: string
  created_at: number
  updated_at: number
}

function toRow(row: Row): PushSubscriptionRow {
  return {
    id: row.id,
    googleSub: row.google_sub,
    endpoint: row.endpoint,
    endpointHash: row.endpoint_hash,
    p256dh: row.p256dh,
    auth: row.auth,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const COLUMNS = `id, google_sub, endpoint, endpoint_hash, p256dh, auth, timezone, created_at, updated_at`

export function createD1PushStore(db: D1Database): PushStore {
  return {
    async upsertByEndpoint(row) {
      // ON CONFLICT on the endpoint's unique index, so re-enabling the same
      // browser under a different account REPLACES the owner rather than
      // adding a second row for the same device.
      await db
        .prepare(
          `INSERT INTO push_subscriptions (${COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (endpoint_hash)
           DO UPDATE SET id = excluded.id,
                         google_sub = excluded.google_sub,
                         endpoint = excluded.endpoint,
                         p256dh = excluded.p256dh,
                         auth = excluded.auth,
                         timezone = excluded.timezone,
                         updated_at = excluded.updated_at`,
        )
        .bind(
          row.id,
          row.googleSub,
          row.endpoint,
          row.endpointHash,
          row.p256dh,
          row.auth,
          row.timezone,
          row.createdAt,
          row.updatedAt,
        )
        .run()
    },

    async findByEndpointHash(endpointHash) {
      const row = await db
        .prepare(`SELECT ${COLUMNS} FROM push_subscriptions WHERE endpoint_hash = ?`)
        .bind(endpointHash)
        .first<Row>()
      return row ? toRow(row) : null
    },

    async removeOwned(googleSub, endpointHash) {
      // Account-scoped: one account can never remove another's device.
      const result = await db
        .prepare(
          `DELETE FROM push_subscriptions WHERE google_sub = ? AND endpoint_hash = ?`,
        )
        .bind(googleSub, endpointHash)
        .run()
      return (result.meta?.changes ?? 0) > 0
    },

    async removeById(id) {
      const result = await db
        .prepare(`DELETE FROM push_subscriptions WHERE id = ?`)
        .bind(id)
        .run()
      return (result.meta?.changes ?? 0) > 0
    },

    async listAll(limit) {
      const result = await db
        .prepare(`SELECT ${COLUMNS} FROM push_subscriptions ORDER BY created_at ASC LIMIT ?`)
        .bind(limit)
        .all<Row>()
      return (result.results ?? []).map(toRow)
    },

    async claimDelivery(subscriptionId, googleSub, triggerMinute, now) {
      // The claim is the primary key, so this INSERT is the whole mutual
      // exclusion: SQLite evaluates it atomically and D1 has a single writer,
      // so a concurrent or retried invocation writes zero rows and knows it
      // lost. No read-then-write, and no process-memory set.
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO notification_deliveries
             (subscription_id, google_sub, trigger_minute, claimed_at, status)
           VALUES (?, ?, ?, ?, 'claimed')`,
        )
        .bind(subscriptionId, googleSub, triggerMinute, now)
        .run()

      return (result.meta?.changes ?? 0) > 0
    },

    async markDelivery(subscriptionId, triggerMinute, status) {
      await db
        .prepare(
          `UPDATE notification_deliveries SET status = ?
            WHERE subscription_id = ? AND trigger_minute = ?`,
        )
        .bind(status, subscriptionId, triggerMinute)
        .run()
    },

    async pruneDeliveries(beforeMinute) {
      await db
        .prepare(`DELETE FROM notification_deliveries WHERE trigger_minute < ?`)
        .bind(beforeMinute)
        .run()
    },
  }
}
