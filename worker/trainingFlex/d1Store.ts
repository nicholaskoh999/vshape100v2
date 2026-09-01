/**
 * D1 implementation of the training flex store.
 *
 * Intentionally thin — the rules live in trainingFlex.ts. Every statement is
 * prepared with bound values; no part of any statement is built from user
 * input, and `google_sub = ?` appears in every one, so an account can only ever
 * reach its own rows.
 */

import type { StoredFlexRow, TrainingFlexStore } from './trainingFlex.ts'

type FlexRow = {
  local_date: string
  kind: string | null
}

export function createD1TrainingFlexStore(db: D1Database): TrainingFlexStore {
  return {
    async listRange(googleSub, from, to) {
      const { results } = await db
        .prepare(
          `SELECT local_date, kind
             FROM training_flex
            WHERE google_sub = ?
              AND local_date >= ?
              AND local_date <= ?
            ORDER BY local_date`,
        )
        .bind(googleSub, from, to)
        .all<FlexRow>()

      // Returned RAW. The column's CHECK proves only the shape it had when it
      // was written; classifying the value is the rules layer's job, in one
      // place, so an unrecognised kind fails closed rather than being repaired
      // into something plausible here.
      return (results ?? []).map(
        (row): StoredFlexRow => ({ localDate: row.local_date, kind: row.kind }),
      )
    },

    async put(googleSub, date, kind, now) {
      // One row per account per day. Choosing again replaces the kind;
      // `created_at` is preserved so a change of mind does not rewrite when the
      // day was first decided.
      await db
        .prepare(
          `INSERT INTO training_flex
             (google_sub, local_date, kind, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (google_sub, local_date)
           DO UPDATE SET kind       = excluded.kind,
                         updated_at = excluded.updated_at`,
        )
        .bind(googleSub, date, kind, now, now)
        .run()
    },

    async clear(googleSub, date) {
      await db
        .prepare(`DELETE FROM training_flex WHERE google_sub = ? AND local_date = ?`)
        .bind(googleSub, date)
        .run()
    },
  }
}
