import { PROGRAMME_SESSION_IDS, type ProgrammeSessionId, type ProgrammeSessions } from '../../shared/programme/programme'
import type { ProgrammeStore, ProgrammeWrite, StoredProgramme } from './programme'

/**
 * D1 implementation of the programme store.
 *
 * HOW ONE SAVE IS MADE ATOMIC.
 *
 * A save replaces the account's whole programme, which is many statements. All
 * of them run in ONE `db.batch`, and D1 commits a batch as a single
 * transaction — so a save cannot land half-written by failing part way.
 *
 * That alone is not enough, because a batch that SUCCEEDS can still be the
 * wrong one: two tabs can both submit a save built on the same revision. So the
 * batch also carries a compare-and-swap, and every statement after the first is
 * guarded on it:
 *
 *   1. the revision statement sets `write_token` to a value only this writer
 *      knows, and only if the stored revision is the one this writer read
 *      (or, for a first edit, only if no row exists at all)
 *
 *   2. every other statement carries
 *        WHERE EXISTS (SELECT 1 FROM programme_revisions
 *                       WHERE google_sub = ? AND write_token = ?)
 *
 * A writer that lost the compare-and-swap never has its token stored, so every
 * one of its dependent statements matches nothing. The batch still commits —
 * as a complete no-op. `changes` on the first statement is then how the caller
 * learns it lost.
 *
 * Guarding on the TOKEN rather than on the revision is what makes the two cases
 * uniform. Guarding on the revision would not work, because statement 1 has
 * already moved it.
 */

/**
 * The slice of D1 this store actually uses.
 *
 * Declared structurally rather than taking the ambient `D1Database` for one
 * specific reason: it lets the REAL store statements be executed against real
 * SQLite in the test suite, which is how Round 22's compare-and-swap and batch
 * atomicity are proved rather than assumed. `D1Database` satisfies this, so
 * `createD1ProgrammeStore(env.DB)` is unchanged at the call site.
 *
 * Following the same local-declaration convention as src/test/nodeSqlite.d.ts:
 * a test should not be the reason to widen what a whole project can see.
 */
export type ProgrammeD1Statement = {
  bind: (...values: unknown[]) => ProgrammeD1Statement
  first: <T>() => Promise<T | null>
  all: <T>() => Promise<{ results?: T[] }>
}

export type ProgrammeD1 = {
  prepare: (sql: string) => ProgrammeD1Statement
  batch: (
    statements: ProgrammeD1Statement[],
  ) => Promise<{ meta?: { changes?: number } }[]>
}

export function createD1ProgrammeStore(db: ProgrammeD1): ProgrammeStore {
  return {
    async read(googleSub) {
      // Three reads rather than a join: the shapes are different, the volumes
      // are tiny, and a join would have to invent rows for an account whose
      // library is non-empty but whose weekday happens to be.
      const revisionRow = await db
        .prepare('SELECT revision FROM programme_revisions WHERE google_sub = ?')
        .bind(googleSub)
        .first<{ revision: number }>()

      // No revision row means this account has never edited. The caller
      // resolves the shared Foundation seed; nothing is written here.
      if (!revisionRow) return null

      const exerciseRows = await db
        .prepare(
          `SELECT exercise_id, name, archived, is_custom
             FROM programme_exercises
            WHERE google_sub = ?
            ORDER BY name COLLATE NOCASE, exercise_id`,
        )
        .bind(googleSub)
        .all<{
          exercise_id: string
          name: string
          archived: number
          is_custom: number
        }>()

      const slotRows = await db
        .prepare(
          `SELECT session_id, exercise_id, position, set_count, result_kind,
                  target_min, target_max, per_side, equipment
             FROM programme_slots
            WHERE google_sub = ?
            ORDER BY session_id, position`,
        )
        .bind(googleSub)
        .all<{
          session_id: string
          exercise_id: string
          position: number
          set_count: number
          result_kind: string
          target_min: number
          target_max: number
          per_side: number
          equipment: string | null
        }>()

      const sessions = {} as ProgrammeSessions
      for (const sessionId of PROGRAMME_SESSION_IDS) sessions[sessionId] = []

      for (const row of slotRows.results ?? []) {
        // A session_id the app does not know is skipped rather than trusted.
        // The CHECK in migration 0015 already refuses one, so this is a
        // belt-and-braces read, not an expected branch.
        if (!(PROGRAMME_SESSION_IDS as readonly string[]).includes(row.session_id)) continue
        sessions[row.session_id as ProgrammeSessionId].push({
          exerciseId: row.exercise_id,
          position: row.position,
          setCount: row.set_count,
          resultKind: row.result_kind === 'seconds' ? 'seconds' : 'reps',
          targetMin: row.target_min,
          targetMax: row.target_max,
          perSide: row.per_side === 1,
          equipment: row.equipment,
        })
      }

      const stored: StoredProgramme = {
        revision: revisionRow.revision,
        exercises: (exerciseRows.results ?? []).map((row) => ({
          exerciseId: row.exercise_id,
          name: row.name,
          archived: row.archived === 1,
          custom: row.is_custom === 1,
        })),
        sessions,
      }
      return stored
    },

    async write(googleSub, write: ProgrammeWrite) {
      const statements: ProgrammeD1Statement[] = []

      // ---- 1. the compare-and-swap -------------------------------------
      if (write.expectedRevision === 0) {
        // FIRST EDIT. The account has no row, so winning means being the one
        // whose INSERT lands. ON CONFLICT DO NOTHING makes a second writer
        // starting from the same fallback a clean no-op rather than an error,
        // and it cannot overwrite the winner's token.
        statements.push(
          db
            .prepare(
              `INSERT INTO programme_revisions (google_sub, revision, write_token, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (google_sub) DO NOTHING`,
            )
            .bind(googleSub, write.nextRevision, write.writeToken, write.now),
        )
      } else {
        // ORDINARY EDIT. Eligibility travels inside the write: the row is
        // proved to still be at the revision this author read at the moment it
        // is replaced.
        statements.push(
          db
            .prepare(
              `UPDATE programme_revisions
                  SET revision = ?, write_token = ?, updated_at = ?
                WHERE google_sub = ? AND revision = ?`,
            )
            .bind(
              write.nextRevision,
              write.writeToken,
              write.now,
              googleSub,
              write.expectedRevision,
            ),
        )
      }

      // The guard every dependent statement carries. Only the writer that won
      // step 1 has its token stored, so a loser's statements match nothing.
      const GUARD =
        'EXISTS (SELECT 1 FROM programme_revisions WHERE google_sub = ? AND write_token = ?)'

      // ---- 2. clear what is being replaced -----------------------------
      statements.push(
        db
          .prepare(`DELETE FROM programme_slots WHERE google_sub = ? AND ${GUARD}`)
          .bind(googleSub, googleSub, write.writeToken),
      )
      statements.push(
        db
          .prepare(`DELETE FROM programme_exercises WHERE google_sub = ? AND ${GUARD}`)
          .bind(googleSub, googleSub, write.writeToken),
      )

      // ---- 3. write the desired programme ------------------------------
      for (const exercise of write.exercises) {
        statements.push(
          db
            .prepare(
              `INSERT INTO programme_exercises
                 (google_sub, exercise_id, name, archived, is_custom, created_at, updated_at)
               SELECT ?, ?, ?, ?, ?, ?, ?
                WHERE ${GUARD}`,
            )
            .bind(
              googleSub,
              exercise.exerciseId,
              exercise.name,
              exercise.archived ? 1 : 0,
              exercise.custom ? 1 : 0,
              write.now,
              write.now,
              googleSub,
              write.writeToken,
            ),
        )
      }

      for (const sessionId of PROGRAMME_SESSION_IDS) {
        for (const slot of write.sessions[sessionId]) {
          statements.push(
            db
              .prepare(
                `INSERT INTO programme_slots
                   (google_sub, session_id, exercise_id, position, set_count,
                    result_kind, target_min, target_max, per_side, equipment)
                 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                  WHERE ${GUARD}`,
              )
              .bind(
                googleSub,
                sessionId,
                slot.exerciseId,
                slot.position,
                slot.setCount,
                slot.resultKind,
                slot.targetMin,
                slot.targetMax,
                slot.perSide ? 1 : 0,
                slot.equipment,
                googleSub,
                write.writeToken,
              ),
          )
        }
      }

      // ---- 4. a custom exercise's required input type -------------------
      //
      // Written here, in the SAME batch, rather than by the exercise-input
      // module afterwards. A custom exercise created without its modality
      // would be unstartable, so the two land together or not at all. The row
      // belongs to exercise_input_types, which remains the canonical truth for
      // input types; this only ever INSERTs the one a creation supplies.
      if (write.inputType) {
        statements.push(
          db
            .prepare(
              `INSERT INTO exercise_input_types
                 (google_sub, exercise_id, input_type, created_at, updated_at)
               SELECT ?, ?, ?, ?, ?
                WHERE ${GUARD}
               ON CONFLICT (google_sub, exercise_id) DO NOTHING`,
            )
            .bind(
              googleSub,
              write.inputType.exerciseId,
              write.inputType.inputType,
              write.now,
              write.now,
              googleSub,
              write.writeToken,
            ),
        )
      }

      const results = await db.batch(statements)

      // The first statement is the compare-and-swap. It changed a row only if
      // this writer won; if it did not, every guarded statement above matched
      // nothing and the batch committed as a no-op.
      return (results[0]?.meta?.changes ?? 0) > 0
    },
  }
}
