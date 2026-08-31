import { describe, expect, it } from 'vitest'

import migration from '../../migrations/0007_notification_push.sql?raw'

/**
 * Round 14 — migration 0007.
 *
 * Two properties matter enough to assert on the SQL itself.
 *
 * The unique index on `endpoint_hash` is what stops one browser being attached
 * to two accounts: without it, signing into a second account would leave the
 * device receiving the first account's routine on its lock screen.
 *
 * The delivery table's primary key IS the mutual exclusion. Cloudflare may
 * retry or overlap a scheduled event, and a claim that is merely "checked
 * then written" would let two invocations both believe they were first. A
 * conflicting INSERT cannot.
 */

describe('migration 0007', () => {
  it('is additive: it drops and rewrites nothing', () => {
    for (const banned of [/DROP\s+TABLE/i, /DELETE\s+FROM/i, /ALTER\s+TABLE/i, /TRUNCATE/i]) {
      expect(migration, String(banned)).not.toMatch(banned)
    }
  })

  it('creates both tables idempotently', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS push_subscriptions/)
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS notification_deliveries/)
  })

  it('stores a subscription per device, under an account', () => {
    for (const column of [
      'google_sub',
      'endpoint',
      'endpoint_hash',
      'p256dh',
      'auth',
      'timezone',
      'created_at',
      'updated_at',
    ]) {
      expect(migration, column).toMatch(new RegExp(`\\b${column}\\b`))
    }
    // Account-scoped identity, so a lookup can never cross accounts.
    expect(migration).toMatch(/PRIMARY KEY \(google_sub, id\)/)
  })

  it('allows one browser endpoint exactly once, globally', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint[\s\S]*?\(endpoint_hash\)/,
    )
  })

  it('requires a timezone, because the schedule is local-clock', () => {
    // A row with no usable zone cannot be evaluated at all, so the column is
    // NOT NULL rather than defaulted to something that would guess an hour.
    expect(migration).toMatch(/timezone TEXT NOT NULL/)
    expect(migration).not.toMatch(/timezone TEXT NOT NULL DEFAULT/)
  })

  it('makes the delivery claim itself the primary key', () => {
    expect(migration).toMatch(/PRIMARY KEY \(subscription_id, trigger_minute\)/)
  })

  it('records the trigger minute, not a wall-clock timestamp', () => {
    expect(migration).toMatch(/trigger_minute INTEGER NOT NULL/)
  })

  it('bounds delivery claims so they never become a history', () => {
    // Prunable by minute. Nothing user-facing is ever built from this table.
    expect(migration).toMatch(/idx_notification_deliveries_minute/)
    expect(migration).toMatch(/NOT a user-facing notification history/i)
  })

  it('holds no account identifier of any real person', () => {
    expect(migration).not.toMatch(/[0-9]{15,}/)
    expect(migration).not.toMatch(/INSERT INTO/)
  })
})
