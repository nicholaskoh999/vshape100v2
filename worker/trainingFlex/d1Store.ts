/**
 * D1 implementation of the training flex store.
 *
 * Intentionally thin — the rules live in trainingFlex.ts. Every statement is
 * prepared with bound values; no part of any statement is built from user
 * input, and `google_sub = ?` appears in every one, so an account can only ever
 * reach its own rows.
 *
 * ── THE EXCLUSION IS ENFORCED AT WRITE TIME (Round 19 Correction 2) ─────────
 *
 * A handler-level "is there a workout yet?" read cannot make the two choices
 * mutually exclusive, because the read and the write are not the same
 * operation: two isolates can both read "no workout", and then both commit.
 * The pre-read in the route stays, but only to produce a fast, friendly 409 —
 * it is NOT the safety mechanism.
 *
 * `put` is therefore a CONDITIONAL insert: the row is written only if, at the
 * moment the statement commits, no scheduled occurrence exists for that account
 * and date. D1 has a single writer, so the subquery is evaluated against
 * committed state, not against whatever the caller last read. A losing write
 * inserts nothing and says so, and nothing about the workout is touched.
 *
 * This is the same standard `workout_sets` already holds itself to in
 * ../workouts/d1Store.ts, and for the same reason.
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

    async put(googleSub, date, kind, scheduledSessionId, now) {
      // One row per account per day. Choosing again replaces the kind;
      // `created_at` is preserved so a change of mind does not rewrite when the
      // day was first decided.
      //
      // The WHERE NOT EXISTS is the guard. It names the day's own scheduled
      // session and requires the stored provenance to be 'scheduled', so an
      // Extra recorded on the same date cannot block the choice — Extra is not
      // the day's obligation and never was.
      //
      // A day that plans no session passes a sessionId that matches nothing,
      // so the subquery is empty and the write proceeds: there is no
      // obligation to be in conflict with.
      const result = await db
        .prepare(
          `INSERT INTO training_flex
             (google_sub, local_date, kind, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
                  SELECT 1 FROM workout_occurrences
                   WHERE google_sub   = ?
                     AND workout_date = ?
                     AND session_id   = ?
                     AND kind         = 'scheduled'
            )
           ON CONFLICT (google_sub, local_date)
           DO UPDATE SET kind       = excluded.kind,
                         updated_at = excluded.updated_at`,
        )
        .bind(
          googleSub,
          date,
          kind,
          now,
          now,
          // The guard's own bindings.
          googleSub,
          date,
          scheduledSessionId ?? '',
        )
        .run()

      // Authoritative: D1 reports the rows the statement actually affected.
      // Zero means the guard refused it, which is the only conditional here.
      return { written: (result.meta?.changes ?? 0) > 0 }
    },

    async clear(googleSub, date) {
      await db
        .prepare(`DELETE FROM training_flex WHERE google_sub = ? AND local_date = ?`)
        .bind(googleSub, date)
        .run()
    },
  }
}
