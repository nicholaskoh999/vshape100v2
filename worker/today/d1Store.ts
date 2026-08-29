/**
 * D1 implementation of the Today completion store.
 *
 * Intentionally thin — all rules live in completions.ts. Every statement is
 * prepared with bound values; no part of any statement is built from user
 * input.
 */

import type { CompletionRecord, CompletionStore } from './completions'

type CompletionRow = {
  google_sub: string
  occurrence_key: string
  anchor_day: string
  completed_at: number
}

function toRecord(row: CompletionRow): CompletionRecord {
  return {
    googleSub: row.google_sub,
    occurrenceKey: row.occurrence_key,
    anchorDay: row.anchor_day,
    completedAt: row.completed_at,
  }
}

export function createD1CompletionStore(db: D1Database): CompletionStore {
  return {
    async listRange(googleSub, from, to) {
      const result = await db
        .prepare(
          `SELECT google_sub, occurrence_key, anchor_day, completed_at
             FROM today_completions
            WHERE google_sub = ? AND anchor_day >= ? AND anchor_day <= ?
            ORDER BY anchor_day, occurrence_key`,
        )
        .bind(googleSub, from, to)
        .all<CompletionRow>()

      return (result.results ?? []).map(toRecord)
    },

    async insertIfAbsent(record) {
      // ON CONFLICT DO NOTHING makes a repeated complete a no-op and keeps
      // the original completed_at instead of moving it on every click.
      await db
        .prepare(
          `INSERT INTO today_completions
             (google_sub, occurrence_key, anchor_day, completed_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (google_sub, occurrence_key) DO NOTHING`,
        )
        .bind(
          record.googleSub,
          record.occurrenceKey,
          record.anchorDay,
          record.completedAt,
        )
        .run()
    },

    async remove(googleSub, occurrenceKey) {
      await db
        .prepare(
          `DELETE FROM today_completions
            WHERE google_sub = ? AND occurrence_key = ?`,
        )
        .bind(googleSub, occurrenceKey)
        .run()
    },
  }
}
