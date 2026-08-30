/**
 * D1 implementation of the workout log store.
 *
 * Intentionally thin — all rules live in workouts.ts. Every statement is
 * prepared with bound values; no part of any statement is built from user
 * input.
 *
 * The Start path writes the occurrence and every expected set in one
 * `db.batch`, which D1 runs as a single transaction: a workout is never left
 * half-created. Both inserts are ON CONFLICT DO NOTHING, never DO UPDATE, so
 * a repeat Start cannot rewrite a stored snapshot.
 */

import {
  isLoadMode,
  isLoadUnit,
  isResultKind,
  isSetStatus,
  type WorkoutOccurrenceRecord,
  type WorkoutSetRecord,
  type WorkoutStore,
} from './workouts'

type OccurrenceRow = {
  google_sub: string
  workout_date: string
  session_id: string
  session_day_snapshot: string
  session_focus_snapshot: string
  session_intensity_snapshot: string
  started_at: number
  updated_at: number
}

type SetRow = {
  google_sub: string
  workout_date: string
  session_id: string
  exercise_order: number
  set_index: number
  exercise_id_snapshot: string
  exercise_name_snapshot: string
  prescription_snapshot: string
  equipment_snapshot: string | null
  result_kind_snapshot: string
  load_mode_snapshot: string
  per_side_snapshot: number
  status: string
  actual_load_value: number | null
  actual_load_unit: string | null
  actual_result: number | null
  updated_at: number
}

function toOccurrence(row: OccurrenceRow): WorkoutOccurrenceRecord {
  return {
    googleSub: row.google_sub,
    workoutDate: row.workout_date,
    sessionId: row.session_id,
    day: row.session_day_snapshot,
    focus: row.session_focus_snapshot,
    intensity: row.session_intensity_snapshot,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Map a stored row back to a record.
 *
 * The enum-ish columns are re-checked rather than cast: they carry CHECK
 * constraints, but the reader should not assume the shape of data it did not
 * write in this process.
 */
function toSet(row: SetRow): WorkoutSetRecord {
  return {
    googleSub: row.google_sub,
    workoutDate: row.workout_date,
    sessionId: row.session_id,
    exerciseOrder: row.exercise_order,
    setIndex: row.set_index,
    exerciseId: row.exercise_id_snapshot,
    exerciseName: row.exercise_name_snapshot,
    prescription: row.prescription_snapshot,
    equipment: row.equipment_snapshot,
    resultKind: isResultKind(row.result_kind_snapshot) ? row.result_kind_snapshot : 'reps',
    loadMode: isLoadMode(row.load_mode_snapshot) ? row.load_mode_snapshot : 'none',
    perSide: row.per_side_snapshot === 1,
    status: isSetStatus(row.status) ? row.status : 'pending',
    loadValue: row.actual_load_value,
    loadUnit: isLoadUnit(row.actual_load_unit) ? row.actual_load_unit : null,
    result: row.actual_result,
    updatedAt: row.updated_at,
  }
}

const OCCURRENCE_COLUMNS = `google_sub, workout_date, session_id,
  session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
  started_at, updated_at`

const SET_COLUMNS = `google_sub, workout_date, session_id, exercise_order, set_index,
  exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
  equipment_snapshot, result_kind_snapshot, load_mode_snapshot, per_side_snapshot,
  status, actual_load_value, actual_load_unit, actual_result, updated_at`

export function createD1WorkoutStore(db: D1Database): WorkoutStore {
  return {
    async findOccurrence(googleSub, workoutDate, sessionId) {
      const row = await db
        .prepare(
          `SELECT ${OCCURRENCE_COLUMNS}
             FROM workout_occurrences
            WHERE google_sub = ? AND workout_date = ? AND session_id = ?`,
        )
        .bind(googleSub, workoutDate, sessionId)
        .first<OccurrenceRow>()

      return row ? toOccurrence(row) : null
    },

    async listSets(googleSub, workoutDate, sessionId) {
      const result = await db
        .prepare(
          `SELECT ${SET_COLUMNS}
             FROM workout_sets
            WHERE google_sub = ? AND workout_date = ? AND session_id = ?
            ORDER BY exercise_order, set_index`,
        )
        .bind(googleSub, workoutDate, sessionId)
        .all<SetRow>()

      return (result.results ?? []).map(toSet)
    },

    async insertOccurrence(occurrence, sets) {
      // ON CONFLICT DO NOTHING on both tables is the historical invariant in
      // SQL: a second Start writes nothing at all, so the original snapshot
      // survives regardless of what the caller sent this time.
      const statements = [
        db
          .prepare(
            `INSERT INTO workout_occurrences (${OCCURRENCE_COLUMNS})
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (google_sub, workout_date, session_id) DO NOTHING`,
          )
          .bind(
            occurrence.googleSub,
            occurrence.workoutDate,
            occurrence.sessionId,
            occurrence.day,
            occurrence.focus,
            occurrence.intensity,
            occurrence.startedAt,
            occurrence.updatedAt,
          ),
        ...sets.map((set) =>
          db
            .prepare(
              `INSERT INTO workout_sets (${SET_COLUMNS})
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (google_sub, workout_date, session_id, exercise_order, set_index)
               DO NOTHING`,
            )
            .bind(
              set.googleSub,
              set.workoutDate,
              set.sessionId,
              set.exerciseOrder,
              set.setIndex,
              set.exerciseId,
              set.exerciseName,
              set.prescription,
              set.equipment,
              set.resultKind,
              set.loadMode,
              set.perSide ? 1 : 0,
              set.status,
              set.loadValue,
              set.loadUnit,
              set.result,
              set.updatedAt,
            ),
        ),
      ]

      // One batch = one transaction, so the occurrence and its sets appear
      // together or not at all.
      await db.batch(statements)
    },

    async findSet(googleSub, workoutDate, sessionId, exerciseOrder, setIndex) {
      const row = await db
        .prepare(
          `SELECT ${SET_COLUMNS}
             FROM workout_sets
            WHERE google_sub = ? AND workout_date = ? AND session_id = ?
              AND exercise_order = ? AND set_index = ?`,
        )
        .bind(googleSub, workoutDate, sessionId, exerciseOrder, setIndex)
        .first<SetRow>()

      return row ? toSet(row) : null
    },

    async updateSet(record) {
      // Only the live logging columns are assignable. The snapshot columns are
      // not in this statement at all, so no code path can rewrite history.
      await db
        .prepare(
          `UPDATE workout_sets
              SET status = ?,
                  actual_load_value = ?,
                  actual_load_unit = ?,
                  actual_result = ?,
                  updated_at = ?
            WHERE google_sub = ? AND workout_date = ? AND session_id = ?
              AND exercise_order = ? AND set_index = ?`,
        )
        .bind(
          record.status,
          record.loadValue,
          record.loadUnit,
          record.result,
          record.updatedAt,
          record.googleSub,
          record.workoutDate,
          record.sessionId,
          record.exerciseOrder,
          record.setIndex,
        )
        .run()
    },

    async touchOccurrence(googleSub, workoutDate, sessionId, updatedAt) {
      await db
        .prepare(
          `UPDATE workout_occurrences
              SET updated_at = ?
            WHERE google_sub = ? AND workout_date = ? AND session_id = ?`,
        )
        .bind(updatedAt, googleSub, workoutDate, sessionId)
        .run()
    },
  }
}
