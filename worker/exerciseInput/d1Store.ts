/**
 * D1 implementation of the exercise input type store.
 *
 * Intentionally thin — all rules live in exerciseInput.ts. Every statement is
 * prepared with bound values; no part of any statement is built from user
 * input, and `google_sub` is always the authenticated account.
 */

import { isWorkoutInputType } from '../../shared/workoutInput'
import type {
  ExerciseInputTypeRecord,
  ExerciseInputTypeStore,
} from './exerciseInput'

type InputTypeRow = {
  google_sub: string
  exercise_id: string
  input_type: string
  updated_at: number
}

/**
 * Map a stored row back to a record, or null when the stored value is not a
 * type this build understands.
 *
 * Re-checked rather than cast even though the column carries a CHECK
 * constraint. A value that cannot be read is dropped rather than repaired to
 * weight_kg: silently treating an unreadable setting as kilograms is precisely
 * the failure this round exists to eliminate, and an absent setting at least
 * leaves the exercise behaving as it did before.
 */
function toRecord(row: InputTypeRow): ExerciseInputTypeRecord | null {
  if (!isWorkoutInputType(row.input_type)) return null
  return {
    googleSub: row.google_sub,
    exerciseId: row.exercise_id,
    inputType: row.input_type,
    updatedAt: row.updated_at,
  }
}

const COLUMNS = `google_sub, exercise_id, input_type, updated_at`

export function createD1ExerciseInputTypeStore(db: D1Database): ExerciseInputTypeStore {
  return {
    async list(googleSub) {
      const result = await db
        .prepare(
          `SELECT ${COLUMNS}
             FROM exercise_input_types
            WHERE google_sub = ?
            ORDER BY exercise_id`,
        )
        .bind(googleSub)
        .all<InputTypeRow>()

      const records: ExerciseInputTypeRecord[] = []
      for (const row of result.results ?? []) {
        const record = toRecord(row)
        if (record) records.push(record)
      }
      return records
    },

    async read(googleSub, exerciseId) {
      const row = await db
        .prepare(
          `SELECT ${COLUMNS}
             FROM exercise_input_types
            WHERE google_sub = ? AND exercise_id = ?`,
        )
        .bind(googleSub, exerciseId)
        .first<InputTypeRow>()

      return row ? toRecord(row) : null
    },

    async save(record) {
      // Upsert on the account/exercise key: one current setting, replaced in
      // place. `created_at` is preserved on update so the row remembers when
      // the exercise was first configured.
      await db
        .prepare(
          `INSERT INTO exercise_input_types
             (google_sub, exercise_id, input_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (google_sub, exercise_id)
           DO UPDATE SET input_type = excluded.input_type,
                         updated_at = excluded.updated_at`,
        )
        .bind(
          record.googleSub,
          record.exerciseId,
          record.inputType,
          record.updatedAt,
          record.updatedAt,
        )
        .run()
    },
  }
}
