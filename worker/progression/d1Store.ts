/**
 * D1 implementation of the progression store.
 *
 * Intentionally thin — all rules live in progression.ts and in
 * shared/progression/. Every statement is prepared with bound values; no part
 * of any statement is built from user input.
 *
 * TWO INVARIANTS ARE RESTATED IN SQL RATHER THAN ASSUMED.
 *
 * `google_sub = ?` appears in the WHERE clause of every single statement, so an
 * account can only ever reach its own workouts and its own calibration.
 *
 * The ownership join 0004 established is repeated on every set read: a set row
 * counts only while it carries the snapshot token of the occurrence it is filed
 * under. A row left behind by a losing concurrent Start matches on date and
 * session but not on token, so it can never become progression evidence.
 *
 * ROUND 17: SCHEDULED EVIDENCE ONLY, STATED IN SQL.
 *
 * Every read below admits an occurrence only when it satisfies the WHOLE
 * persisted scheduled invariant. An Extra Workout already lives under its own
 * session slug, so a session-scoped read could not reach it by accident — but
 * progression must not depend on that. The recommendation for next Monday is
 * derived from the SCHEDULED Monday history and nothing else, and this is where
 * that is asserted rather than assumed. Voluntary extra work is real training
 * and factual history; it is not evidence about an obligation the user has not
 * yet performed.
 *
 * WHY `kind` ALONE IS NOT ENOUGH.
 *
 * Correction 1 established that provenance is a PAIR, and that a row whose two
 * halves contradict each other cannot be read at all: a scheduled workout
 * carrying a source session is exactly as unreadable as an unknown kind, and
 * `readProvenance` refuses both. Filtering on `kind = 'scheduled'` alone would
 * have let one of those contradictions — `kind = 'scheduled'` with
 * `source_session_id = 'tuesday'` — straight into the lanes, because SQL cannot
 * call into that reader. So the invariant is restated here in the only
 * vocabulary this layer has.
 *
 * This filter is deliberately at least as strict as `readProvenance`: where the
 * two could ever diverge, SQL excludes rather than admits. An empty-string
 * source is the only such case, it is not a value this application writes, and
 * dropping a corrupt row from progression evidence is the safe direction.
 */

import type { ProgressionSetRow } from '../../shared/progression/engine'
import { isCalibrationFeedback } from '../../shared/progression/lane'
import { isLoadUnit } from '../../shared/workoutLog'
import type { CalibrationRow, ProgressionOccurrence, ProgressionStore } from './progression'

type SetRow = {
  workout_date: string
  exercise_order: number
  set_index: number
  exercise_id_snapshot: string
  exercise_name_snapshot: string
  prescription_snapshot: string
  result_kind_snapshot: string
  load_mode_snapshot: string
  per_side_snapshot: number
  /** Round 20. Null on any row written before it. */
  input_type_snapshot: string | null
  actual_band_label: string | null
  actual_band_count: number | null
  status: string
  actual_load_value: number | null
  actual_load_unit: string | null
  actual_result: number | null
}

type OccurrenceRow = {
  workout_date: string
  session_id: string
  session_intensity_snapshot: string
  started_at: number
}

type DateRow = { workout_date: string }

type CalibrationD1Row = {
  exercise_order: number
  workout_date: string
  session_id: string
  lane_fingerprint: string
  feedback: string
  observed_load_value: number
  observed_load_unit: string
  chosen_load_value: number | null
  chosen_load_unit: string | null
  updated_at: number
}

/**
 * Map a stored set row across UNTOUCHED.
 *
 * The persisted enums are carried as the strings they are, not cast into the
 * app's types. Reading them is the engine's job, and it must be able to see a
 * value that should not exist in order to fail closed on it.
 */
function toSetRow(row: SetRow): ProgressionSetRow {
  return {
    workoutDate: row.workout_date,
    exerciseOrder: row.exercise_order,
    setIndex: row.set_index,
    exerciseId: row.exercise_id_snapshot,
    exerciseName: row.exercise_name_snapshot,
    prescription: row.prescription_snapshot,
    resultKind: row.result_kind_snapshot,
    loadMode: row.load_mode_snapshot,
    perSide: row.per_side_snapshot,
    inputTypeSnapshot: row.input_type_snapshot,
    bandLabel: row.actual_band_label,
    bandCount: row.actual_band_count,
    status: row.status,
    loadValue: row.actual_load_value,
    loadUnit: row.actual_load_unit,
    result: row.actual_result,
  }
}

const SET_COLUMNS = `s.workout_date, s.exercise_order, s.set_index,
  s.exercise_id_snapshot, s.exercise_name_snapshot, s.prescription_snapshot,
  s.result_kind_snapshot, s.load_mode_snapshot, s.per_side_snapshot,
  s.input_type_snapshot, s.actual_band_label, s.actual_band_count,
  s.status, s.actual_load_value, s.actual_load_unit, s.actual_result`

/**
 * The full persisted SCHEDULED provenance invariant, unqualified.
 *
 * One definition, used by every read that admits scheduled evidence, so the
 * rule cannot drift apart between them.
 */
const SCHEDULED_PROVENANCE = `kind = 'scheduled' AND source_session_id IS NULL`

/** The same invariant, qualified for the joins that alias the table as `o`. */
const SCHEDULED_PROVENANCE_O = `o.kind = 'scheduled' AND o.source_session_id IS NULL`

const OWNERSHIP_JOIN = `o.google_sub   = s.google_sub
               AND o.workout_date = s.workout_date
               AND o.session_id   = s.session_id
               AND o.snapshot_id  = s.snapshot_id
               AND ${SCHEDULED_PROVENANCE_O}`

const CALIBRATION_COLUMNS = `google_sub, workout_date, session_id, exercise_order,
  lane_fingerprint, feedback, observed_load_value, observed_load_unit,
  chosen_load_value, chosen_load_unit, created_at, updated_at`

export function createD1ProgressionStore(db: D1Database): ProgressionStore {
  return {
    async findOccurrence(googleSub, workoutDate, sessionId) {
      const row = await db
        .prepare(
          `SELECT workout_date, session_id, session_intensity_snapshot, started_at
             FROM workout_occurrences
            WHERE google_sub = ? AND workout_date = ? AND session_id = ?
              AND ${SCHEDULED_PROVENANCE}`,
        )
        .bind(googleSub, workoutDate, sessionId)
        .first<OccurrenceRow>()

      if (!row) return null
      const occurrence: ProgressionOccurrence = {
        workoutDate: row.workout_date,
        sessionId: row.session_id,
        intensity: row.session_intensity_snapshot,
        startedAt: row.started_at,
      }
      return occurrence
    },

    async listOccurrenceSets(googleSub, workoutDate, sessionId) {
      const result = await db
        .prepare(
          `SELECT ${SET_COLUMNS}
             FROM workout_sets s
             JOIN workout_occurrences o ON ${OWNERSHIP_JOIN}
            WHERE s.google_sub = ? AND s.workout_date = ? AND s.session_id = ?
            ORDER BY s.exercise_order, s.set_index`,
        )
        .bind(googleSub, workoutDate, sessionId)
        .all<SetRow>()

      return (result.results ?? []).map(toSetRow)
    },

    async listEarlierDates(googleSub, sessionId, before, limit) {
      // Occurrences of THIS session only, strictly before the workout being
      // guided. Dates are zero-padded text, so `<` is exact calendar ordering.
      const result = await db
        .prepare(
          `SELECT workout_date
             FROM workout_occurrences
            WHERE google_sub = ? AND session_id = ? AND workout_date < ?
              AND ${SCHEDULED_PROVENANCE}
            ORDER BY workout_date DESC
            LIMIT ?`,
        )
        .bind(googleSub, sessionId, before, limit)
        .all<DateRow>()

      return (result.results ?? []).map((row) => row.workout_date)
    },

    async listSetsBefore(googleSub, sessionId, from, before, limit) {
      const result = await db
        .prepare(
          `SELECT ${SET_COLUMNS}
             FROM workout_sets s
             JOIN workout_occurrences o ON ${OWNERSHIP_JOIN}
            WHERE s.google_sub = ?
              AND s.session_id = ?
              AND s.workout_date >= ?
              AND s.workout_date < ?
            ORDER BY s.workout_date ASC, s.exercise_order ASC, s.set_index ASC
            LIMIT ?`,
        )
        .bind(googleSub, sessionId, from, before, limit)
        .all<SetRow>()

      return (result.results ?? []).map(toSetRow)
    },

    async listCalibration(googleSub, workoutDate, sessionId) {
      const result = await db
        .prepare(
          `SELECT ${CALIBRATION_COLUMNS}
             FROM workout_calibration
            WHERE google_sub = ? AND workout_date = ? AND session_id = ?
            ORDER BY exercise_order`,
        )
        .bind(googleSub, workoutDate, sessionId)
        .all<CalibrationD1Row>()

      const rows: CalibrationRow[] = []
      for (const row of result.results ?? []) {
        // A stored value outside its vocabulary is dropped rather than cast.
        // Losing a calibration returns the lane to asking; honouring an
        // unreadable one would act on something nobody said.
        if (!isCalibrationFeedback(row.feedback)) continue
        if (!isLoadUnit(row.observed_load_unit)) continue
        const chosen =
          row.chosen_load_value !== null && isLoadUnit(row.chosen_load_unit)
            ? { value: row.chosen_load_value, unit: row.chosen_load_unit }
            : null

        rows.push({
          exerciseOrder: row.exercise_order,
          workoutDate: row.workout_date,
          sessionId: row.session_id,
          fingerprint: row.lane_fingerprint,
          feedback: row.feedback,
          observedLoad: { value: row.observed_load_value, unit: row.observed_load_unit },
          chosenLoad: chosen,
          updatedAt: row.updated_at,
        })
      }
      return rows
    },

    async saveCalibration(record) {
      // One row per occurrence slot. Judging the same set again replaces the
      // answer; `created_at` is preserved so the first judgement's time is not
      // rewritten by a correction.
      await db
        .prepare(
          `INSERT INTO workout_calibration (${CALIBRATION_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (google_sub, workout_date, session_id, exercise_order)
           DO UPDATE SET lane_fingerprint    = excluded.lane_fingerprint,
                         feedback            = excluded.feedback,
                         observed_load_value = excluded.observed_load_value,
                         observed_load_unit  = excluded.observed_load_unit,
                         chosen_load_value   = excluded.chosen_load_value,
                         chosen_load_unit    = excluded.chosen_load_unit,
                         updated_at          = excluded.updated_at`,
        )
        .bind(
          record.googleSub,
          record.workoutDate,
          record.sessionId,
          record.exerciseOrder,
          record.fingerprint,
          record.feedback,
          record.observedLoad.value,
          record.observedLoad.unit,
          record.chosenLoad ? record.chosenLoad.value : null,
          record.chosenLoad ? record.chosenLoad.unit : null,
          record.now,
          record.now,
        )
        .run()
    },

    async removeCalibration(googleSub, workoutDate, sessionId, exerciseOrder) {
      await db
        .prepare(
          `DELETE FROM workout_calibration
            WHERE google_sub = ? AND workout_date = ? AND session_id = ?
              AND exercise_order = ?`,
        )
        .bind(googleSub, workoutDate, sessionId, exerciseOrder)
        .run()
    },
  }
}
