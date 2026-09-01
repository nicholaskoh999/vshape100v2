/**
 * D1 implementation of the workout log store.
 *
 * Intentionally thin — all rules live in workouts.ts. Every statement is
 * prepared with bound values; no part of any statement is built from user
 * input.
 *
 * THE FIRST-WRITER-WINS CLAIM.
 *
 * `insertOccurrence` is the one place a workout's history is created, and it
 * has to be safe when two first Starts run at once — which they can, on
 * separate isolates, with neither having seen the other's write. It is written
 * so that a losing Start stores nothing at all:
 *
 *   1. The occurrence INSERT is ON CONFLICT DO NOTHING. Its primary key means
 *      exactly one concurrent Start can put its `snapshot_id` in the table.
 *   2. Every set INSERT is `INSERT ... SELECT ... WHERE EXISTS (the occurrence
 *      row carrying THIS snapshot's token)`. For the loser that subquery is
 *      false, so each statement inserts zero rows — including at exercise/set
 *      positions the winner never occupied, which is exactly the case a plain
 *      per-row ON CONFLICT would have let through.
 *   3. The whole thing is one `db.batch`, so it commits as a single
 *      transaction against D1's single writer, and the guard in (2) is
 *      evaluated against committed state rather than a stale read.
 *   4. The composite foreign key on (account, date, session, snapshot_id)
 *      backs this up structurally: a set row whose token is not the stored
 *      occurrence's cannot exist even if a future caller bypassed (2).
 *   5. Round 19 Correction 2: the occurrence insert additionally requires that
 *      no training-flex row exists for that account and date, evaluated inside
 *      the same statement. A day resolved as Recovery or Fitness Boxing
 *      therefore cannot have its scheduled session started even by a request
 *      that read "no flex" a moment earlier — and because every set insert is
 *      already gated on the occurrence carrying THIS token, a blocked Start
 *      writes zero sets too, with no extra code. The guard is inert for an
 *      Extra, which was never the day's obligation.
 *
 * None of this depends on timing, on a process-local lock, or on comparing
 * timestamps — a lock inside one isolate would not be seen by another.
 */

import {
  isLoadMode,
  isLoadUnit,
  isResultKind,
  isSetStatus,
  readProvenance,
  type WorkoutHistoryEntry,
  type WorkoutHistoryTotals,
  type WorkoutOccurrenceRecord,
  type WorkoutSetRecord,
  type WorkoutStore,
} from './workouts'

type OccurrenceRow = {
  google_sub: string
  workout_date: string
  session_id: string
  snapshot_id: string
  kind: string | null
  source_session_id: string | null
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
  snapshot_id: string
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

/**
 * A stored occurrence whose provenance cannot be read.
 *
 * Thrown rather than returned, so it can never be mistaken for "this account
 * has not started that workout" — which is what a null return means here, and
 * which would let a Start proceed against a row we cannot understand. The
 * route turns it into a controlled 500; every schedule-sensitive caller
 * therefore gets a refusal instead of a manufactured answer.
 */
export class UnreadableProvenanceError extends Error {
  constructor() {
    super('workout occurrence provenance could not be read')
    this.name = 'UnreadableProvenanceError'
  }
}

function toOccurrence(row: OccurrenceRow): WorkoutOccurrenceRecord {
  // Re-checked, never cast, and never defaulted. 0010's DEFAULT already gave
  // every pre-Round-17 row 'scheduled', so an unreadable value here is a
  // corrupt row rather than an old one — and promoting it to scheduled would
  // hand the most privileged status in the app to data we cannot read.
  const provenance = readProvenance(row.kind, row.source_session_id)
  if (!provenance) throw new UnreadableProvenanceError()

  return {
    googleSub: row.google_sub,
    workoutDate: row.workout_date,
    sessionId: row.session_id,
    snapshotId: row.snapshot_id,
    kind: provenance.kind,
    sourceSessionId: provenance.sourceSessionId,
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
    snapshotId: row.snapshot_id,
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

const OCCURRENCE_COLUMNS = `google_sub, workout_date, session_id, snapshot_id,
  kind, source_session_id,
  session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
  started_at, updated_at`

const SET_COLUMN_NAMES = [
  'google_sub',
  'workout_date',
  'session_id',
  'snapshot_id',
  'exercise_order',
  'set_index',
  'exercise_id_snapshot',
  'exercise_name_snapshot',
  'prescription_snapshot',
  'equipment_snapshot',
  'result_kind_snapshot',
  'load_mode_snapshot',
  'per_side_snapshot',
  'status',
  'actual_load_value',
  'actual_load_unit',
  'actual_result',
  'updated_at',
] as const

const SET_COLUMNS = SET_COLUMN_NAMES.join(', ')
/** The same columns qualified for the ownership join in `listSets`. */
const SET_COLUMNS_QUALIFIED = SET_COLUMN_NAMES.map((name) => `s.${name}`).join(', ')
const SET_PLACEHOLDERS = SET_COLUMN_NAMES.map(() => '?').join(', ')

/**
 * The ownership join, shared by every read that spans both tables.
 *
 * A set counts towards its occurrence only while it carries that occurrence's
 * snapshot token — the same rule `listSets` applies, so history can never
 * report a set that does not belong to the workout it is filed under.
 */
const OWNERSHIP_JOIN = `o.google_sub   = s.google_sub
               AND o.workout_date = s.workout_date
               AND o.session_id   = s.session_id
               AND o.snapshot_id  = s.snapshot_id`

type HistoryRow = {
  workout_date: string
  session_id: string
  kind: string | null
  source_session_id: string | null
  session_day_snapshot: string
  session_focus_snapshot: string
  session_intensity_snapshot: string
  started_at: number
  updated_at: number
  total_sets: number
  completed_sets: number
  skipped_sets: number
}

type TotalsRow = {
  recorded_workouts: number
  recorded_sets: number
  completed_sets: number
  skipped_sets: number
}

function toHistoryEntry(row: HistoryRow): WorkoutHistoryEntry {
  const completed = row.completed_sets ?? 0
  const skipped = row.skipped_sets ?? 0
  // History reports what was recorded, so an unreadable row is MARKED rather
  // than thrown on: one corrupt occurrence must not hide an account's whole
  // training history. `null` travels outward and every schedule-sensitive
  // consumer refuses it; nothing substitutes a value for it.
  const provenance = readProvenance(row.kind, row.source_session_id)

  return {
    date: row.workout_date,
    sessionId: row.session_id,
    kind: provenance ? provenance.kind : null,
    sourceSessionId: provenance ? provenance.sourceSessionId : null,
    day: row.session_day_snapshot,
    focus: row.session_focus_snapshot,
    intensity: row.session_intensity_snapshot,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    progress: {
      total: row.total_sets ?? 0,
      completed,
      skipped,
      // Traversal only. Kept separate from `completed` all the way out.
      resolved: completed + skipped,
    },
  }
}

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
      // Joined on the ownership token, so a read can only ever return the sets
      // of the Start that owns the stored occurrence. The foreign key already
      // makes a foreign-token row impossible; this makes the read provably
      // coherent without depending on that.
      const result = await db
        .prepare(
          `SELECT ${SET_COLUMNS_QUALIFIED}
             FROM workout_sets s
             JOIN workout_occurrences o
               ON  o.google_sub   = s.google_sub
               AND o.workout_date = s.workout_date
               AND o.session_id   = s.session_id
               AND o.snapshot_id  = s.snapshot_id
            WHERE s.google_sub = ? AND s.workout_date = ? AND s.session_id = ?
            ORDER BY s.exercise_order, s.set_index`,
        )
        .bind(googleSub, workoutDate, sessionId)
        .all<SetRow>()

      return (result.results ?? []).map(toSet)
    },

    async insertOccurrence(occurrence, sets) {
      const statements = [
        // One concurrent Start wins this insert; the others no-op, leaving
        // their token nowhere in the table.
        db
          .prepare(
            // Two conditions, both evaluated as part of the write.
            //
            // ON CONFLICT DO NOTHING settles concurrent Starts: exactly one
            // token reaches the table.
            //
            // WHERE NOT EXISTS settles the Round 19 exclusion: a day the user
            // explicitly resolved as Recovery or Fitness Boxing cannot have its
            // scheduled session started, and that is decided HERE rather than by
            // an earlier read the winner may already have invalidated.
            //
            // The `? = 'scheduled'` term carries this occurrence's own kind, so
            // the guard applies to a scheduled Start and is inert for an Extra —
            // Extra is voluntary and was never the day's obligation.
            `INSERT INTO workout_occurrences (${OCCURRENCE_COLUMNS})
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              WHERE NOT EXISTS (
                    SELECT 1 FROM training_flex
                     WHERE google_sub = ? AND local_date = ? AND ? = 'scheduled'
              )
             ON CONFLICT (google_sub, workout_date, session_id) DO NOTHING`,
          )
          .bind(
            occurrence.googleSub,
            occurrence.workoutDate,
            occurrence.sessionId,
            occurrence.snapshotId,
            occurrence.kind,
            occurrence.sourceSessionId,
            occurrence.day,
            occurrence.focus,
            occurrence.intensity,
            occurrence.startedAt,
            occurrence.updatedAt,
            // The flex guard's own bindings.
            occurrence.googleSub,
            occurrence.workoutDate,
            occurrence.kind,
          ),
        ...sets.map((set) =>
          db
            .prepare(
              // Guarded insert: the row is written only while the stored
              // occurrence carries THIS snapshot's token. A losing Start
              // inserts nothing here, at any position.
              `INSERT INTO workout_sets (${SET_COLUMNS})
               SELECT ${SET_PLACEHOLDERS}
                WHERE EXISTS (
                      SELECT 1 FROM workout_occurrences
                       WHERE google_sub = ? AND workout_date = ?
                         AND session_id = ? AND snapshot_id = ?
                )
               ON CONFLICT (google_sub, workout_date, session_id, exercise_order, set_index)
               DO NOTHING`,
            )
            .bind(
              set.googleSub,
              set.workoutDate,
              set.sessionId,
              set.snapshotId,
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
              // The guard's own bindings.
              set.googleSub,
              set.workoutDate,
              set.sessionId,
              set.snapshotId,
            ),
        ),
      ]

      // One batch = one transaction, so the claim above is evaluated and
      // committed as a unit against D1's single writer.
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
      // Only the live logging columns are assignable. The snapshot columns and
      // the ownership token are not in this statement at all, so no code path
      // can rewrite history or re-home a set.
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

    async listRecent(googleSub, limit) {
      // Newest first by the user's own workout date, then by when it was
      // started, then by session id — a total order, so paging is stable.
      // LEFT JOIN so an occurrence with no set rows still reports honestly
      // rather than disappearing from history.
      const result = await db
        .prepare(
          `SELECT o.workout_date, o.session_id, o.kind, o.source_session_id,
                  o.session_day_snapshot, o.session_focus_snapshot,
                  o.session_intensity_snapshot, o.started_at, o.updated_at,
                  COUNT(s.set_index) AS total_sets,
                  SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completed_sets,
                  SUM(CASE WHEN s.status = 'skipped'   THEN 1 ELSE 0 END) AS skipped_sets
             FROM workout_occurrences o
             LEFT JOIN workout_sets s
               ON ${OWNERSHIP_JOIN}
            WHERE o.google_sub = ?
            GROUP BY o.workout_date, o.session_id, o.snapshot_id
            ORDER BY o.workout_date DESC, o.started_at DESC, o.session_id ASC
            LIMIT ?`,
        )
        .bind(googleSub, limit)
        .all<HistoryRow>()

      return (result.results ?? []).map(toHistoryEntry)
    },

    async listInRange(googleSub, from, to, limit) {
      // The same shape and ordering as listRecent, narrowed to an inclusive
      // local-date span. Dates are zero-padded text, so a plain BETWEEN is
      // exact calendar ordering. `google_sub` stays in the WHERE clause, so a
      // range read can only ever see this account's own workouts.
      const result = await db
        .prepare(
          `SELECT o.workout_date, o.session_id, o.kind, o.source_session_id,
                  o.session_day_snapshot, o.session_focus_snapshot,
                  o.session_intensity_snapshot, o.started_at, o.updated_at,
                  COUNT(s.set_index) AS total_sets,
                  SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS completed_sets,
                  SUM(CASE WHEN s.status = 'skipped'   THEN 1 ELSE 0 END) AS skipped_sets
             FROM workout_occurrences o
             LEFT JOIN workout_sets s
               ON ${OWNERSHIP_JOIN}
            WHERE o.google_sub = ?
              AND o.workout_date >= ?
              AND o.workout_date <= ?
            GROUP BY o.workout_date, o.session_id, o.snapshot_id
            ORDER BY o.workout_date DESC, o.started_at DESC, o.session_id ASC
            LIMIT ?`,
        )
        .bind(googleSub, from, to, limit)
        .all<HistoryRow>()

      return (result.results ?? []).map(toHistoryEntry)
    },

    async totals(googleSub) {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM workout_occurrences WHERE google_sub = ?)
               AS recorded_workouts,
             (SELECT COUNT(*)
                FROM workout_sets s
                JOIN workout_occurrences o ON ${OWNERSHIP_JOIN}
               WHERE s.google_sub = ?) AS recorded_sets,
             (SELECT COUNT(*)
                FROM workout_sets s
                JOIN workout_occurrences o ON ${OWNERSHIP_JOIN}
               WHERE s.google_sub = ? AND s.status = 'completed') AS completed_sets,
             (SELECT COUNT(*)
                FROM workout_sets s
                JOIN workout_occurrences o ON ${OWNERSHIP_JOIN}
               WHERE s.google_sub = ? AND s.status = 'skipped') AS skipped_sets`,
        )
        .bind(googleSub, googleSub, googleSub, googleSub)
        .first<TotalsRow>()

      const completed = row?.completed_sets ?? 0
      const skipped = row?.skipped_sets ?? 0
      const result: WorkoutHistoryTotals = {
        workouts: row?.recorded_workouts ?? 0,
        sets: row?.recorded_sets ?? 0,
        completed,
        skipped,
        resolved: completed + skipped,
      }
      return result
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
