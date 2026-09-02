import type { BodyWeightRecord, BodyWeightStore } from './bodyWeight'
import type { ProgressHistoryStore } from './history'
import type { CompletedSetRow } from './performance'

/**
 * D1 implementation of the Progress stores.
 *
 * Intentionally thin — every rule lives in bodyWeight.ts, history.ts and
 * performance.ts. Every statement is prepared with bound values; no part of any
 * statement is built from user input, and `google_sub` appears in the WHERE
 * clause of every one of them, so a row can only ever be read or written under
 * its own account.
 */

type WeightRow = {
  google_sub: string
  local_date: string
  weight_tenths_kg: number
  created_at: number
  updated_at: number
}

function toWeightRecord(row: WeightRow): BodyWeightRecord {
  return {
    googleSub: row.google_sub,
    localDate: row.local_date,
    weightTenths: row.weight_tenths_kg,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const WEIGHT_COLUMNS = 'google_sub, local_date, weight_tenths_kg, created_at, updated_at'

export function createD1BodyWeightStore(db: D1Database): BodyWeightStore {
  return {
    async listAll(googleSub) {
      const result = await db
        .prepare(
          `SELECT ${WEIGHT_COLUMNS}
             FROM body_weight_entries
            WHERE google_sub = ?
            ORDER BY local_date ASC`,
        )
        .bind(googleSub)
        .all<WeightRow>()

      return (result.results ?? []).map(toWeightRecord)
    },

    async listRange(googleSub, from, to) {
      // Dates are zero-padded YYYY-MM-DD text, so plain SQL comparison is
      // exact calendar ordering and this is a contiguous slice of the index.
      const result = await db
        .prepare(
          `SELECT ${WEIGHT_COLUMNS}
             FROM body_weight_entries
            WHERE google_sub = ? AND local_date >= ? AND local_date <= ?
            ORDER BY local_date ASC`,
        )
        .bind(googleSub, from, to)
        .all<WeightRow>()

      return (result.results ?? []).map(toWeightRecord)
    },

    async lifetimeEdges(googleSub) {
      // Three tiny reads instead of one large one. A lifetime summary needs
      // the newest two measurements, the oldest, and the total — reading every
      // row to find three of them would be work for nothing, and sending every
      // row to the browser so React could find them would be worse.
      //
      // None of these is affected by the chart's 30D / 90D window: the window
      // decides what is drawn, not what "since first" means.
      const newest = await db
        .prepare(
          `SELECT ${WEIGHT_COLUMNS}
             FROM body_weight_entries
            WHERE google_sub = ?
            ORDER BY local_date DESC
            LIMIT 2`,
        )
        .bind(googleSub)
        .all<WeightRow>()

      const oldest = await db
        .prepare(
          `SELECT ${WEIGHT_COLUMNS}
             FROM body_weight_entries
            WHERE google_sub = ?
            ORDER BY local_date ASC
            LIMIT 1`,
        )
        .bind(googleSub)
        .first<WeightRow>()

      const total = await db
        .prepare(`SELECT COUNT(*) AS total FROM body_weight_entries WHERE google_sub = ?`)
        .bind(googleSub)
        .first<{ total: number }>()

      return {
        newest: (newest.results ?? []).map(toWeightRecord),
        oldest: oldest ? toWeightRecord(oldest) : null,
        count: total?.total ?? 0,
      }
    },

    async save({ googleSub, localDate, weightTenths, now }) {
      // ONE account × ONE local date = ONE entry. The conflict target is the
      // primary key, so saving the same date again updates that row in a
      // single statement — there is no read-then-write window in which a
      // second request could insert a duplicate.
      //
      // `created_at` is deliberately left alone on update: the entry is still
      // the same measurement day, corrected.
      await db
        .prepare(
          `INSERT INTO body_weight_entries
             (google_sub, local_date, weight_tenths_kg, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (google_sub, local_date)
           DO UPDATE SET weight_tenths_kg = excluded.weight_tenths_kg,
                         updated_at = excluded.updated_at`,
        )
        .bind(googleSub, localDate, weightTenths, now, now)
        .run()
    },

    async remove(googleSub, localDate) {
      // Scoped to the account AND the date. It can never reach another
      // account's measurement, and the response says nothing about whether a
      // row was there — see the route.
      await db
        .prepare(
          `DELETE FROM body_weight_entries
            WHERE google_sub = ? AND local_date = ?`,
        )
        .bind(googleSub, localDate)
        .run()
    },
  }
}

type SetRow = {
  exercise_id_snapshot: string
  exercise_name_snapshot: string
  result_kind_snapshot: string
  load_mode_snapshot: string
  per_side_snapshot: number
  /** Round 20. Null on any row written before it. */
  input_type_snapshot: string | null
  actual_band_label: string | null
  actual_band_count: number | null
  actual_load_value: number | null
  actual_load_unit: string | null
  actual_result: number
  workout_date: string
  session_id: string
  started_at: number
}

export function createD1ProgressHistoryStore(db: D1Database): ProgressHistoryStore {
  return {
    async listCompletedSets(googleSub, limit, offset) {
      // The join is the ownership rule 0004 established, restated here rather
      // than assumed: a set row may only count when it carries the snapshot
      // token of the occurrence it is filed under. A row left behind by a
      // losing concurrent Start matches on date and session but NOT on token,
      // so it can never enter a Personal Best.
      //
      // `status = 'completed'` is the whole eligibility rule for Progress.
      // Pending sets have not happened and skipped ones did not happen, and
      // neither is a performance.
      //
      // Ordering is fully deterministic, which is what makes the paged read
      // below safe: an unstable order could show one row twice and miss
      // another across chunk boundaries.
      const result = await db
        .prepare(
          `SELECT s.exercise_id_snapshot,
                  s.exercise_name_snapshot,
                  s.result_kind_snapshot,
                  s.load_mode_snapshot,
                  s.per_side_snapshot,
                  s.input_type_snapshot,
                  s.actual_band_label,
                  s.actual_band_count,
                  s.actual_load_value,
                  s.actual_load_unit,
                  s.actual_result,
                  s.workout_date,
                  s.session_id,
                  -- The occurrence's own start time. Two sessions on one local
                  -- date are separate workouts, and this is the only fact that
                  -- says which of them came first.
                  o.started_at
             FROM workout_sets s
             JOIN workout_occurrences o
               ON o.google_sub = s.google_sub
              AND o.workout_date = s.workout_date
              AND o.session_id = s.session_id
              AND o.snapshot_id = s.snapshot_id
            WHERE s.google_sub = ?
              AND s.status = 'completed'
              AND s.actual_result IS NOT NULL
            ORDER BY s.workout_date ASC,
                     s.session_id ASC,
                     s.exercise_order ASC,
                     s.set_index ASC
            LIMIT ? OFFSET ?`,
        )
        .bind(googleSub, limit, offset)
        .all<SetRow>()

      return (result.results ?? []).map(
        (row): CompletedSetRow => ({
          exerciseId: row.exercise_id_snapshot,
          exerciseName: row.exercise_name_snapshot,
          resultKind: row.result_kind_snapshot,
          loadMode: row.load_mode_snapshot,
          perSide: row.per_side_snapshot,
          inputTypeSnapshot: row.input_type_snapshot,
          bandLabel: row.actual_band_label,
          bandCount: row.actual_band_count,
          loadValue: row.actual_load_value,
          loadUnit: row.actual_load_unit,
          result: row.actual_result,
          workoutDate: row.workout_date,
          sessionId: row.session_id,
          startedAt: row.started_at,
        }),
      )
    },
  }
}
