/**
 * D1 implementation of the settings store.
 *
 * Intentionally thin — the rules live in settings.ts. Every statement is
 * prepared with bound values; no part of any statement is built from user
 * input, and `google_sub = ?` appears in every one, so an account can only ever
 * reach its own row.
 */

import { parseFoundationStartDate } from '../../shared/settings'
import type { AccountSettings, SettingsStore } from './settings'

type SettingsRow = {
  google_sub: string
  foundation_start_date: string | null
  created_at: number
  updated_at: number
}

export function createD1SettingsStore(db: D1Database): SettingsStore {
  return {
    async find(googleSub) {
      const row = await db
        .prepare(
          `SELECT google_sub, foundation_start_date, created_at, updated_at
             FROM account_settings
            WHERE google_sub = ?`,
        )
        .bind(googleSub)
        .first<SettingsRow>()

      if (!row) return null

      // Re-validated on the way out, never cast. The column's GLOB proves only
      // the shape, so an impossible stored date reads as "no preference" — the
      // account falls back to the legacy default rather than being counted from
      // a date that does not exist.
      return {
        foundationStartDate: parseFoundationStartDate(row.foundation_start_date),
      } satisfies AccountSettings
    },

    async save(googleSub, settings, now) {
      // One row per account. Saving again replaces the value; `created_at` is
      // preserved so a correction does not rewrite when the account first chose.
      await db
        .prepare(
          `INSERT INTO account_settings
             (google_sub, foundation_start_date, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (google_sub)
           DO UPDATE SET foundation_start_date = excluded.foundation_start_date,
                         updated_at            = excluded.updated_at`,
        )
        .bind(googleSub, settings.foundationStartDate, now, now)
        .run()
    },
  }
}
