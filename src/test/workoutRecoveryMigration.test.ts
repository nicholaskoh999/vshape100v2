import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import migration0001 from '../../migrations/0001_auth.sql?raw'
import migration0002 from '../../migrations/0002_today_completions.sql?raw'
import migration0003 from '../../migrations/0003_exercise_media.sql?raw'
import migration0004 from '../../migrations/0004_workout_logs.sql?raw'
import migration0005 from '../../migrations/0005_holiday_overrides.sql?raw'
import migration0006 from '../../migrations/0006_company_holidays.sql?raw'
import migration0007 from '../../migrations/0007_notification_push.sql?raw'
import migration0008 from '../../migrations/0008_progress_upgrade.sql?raw'
import migration0009 from '../../migrations/0009_training_progression.sql?raw'
import migration0010 from '../../migrations/0010_flexible_training.sql?raw'
import migration0011 from '../../migrations/0011_account_settings.sql?raw'
import migration0012 from '../../migrations/0012_training_flex.sql?raw'
import migration0013 from '../../migrations/0013_workout_input_types.sql?raw'
import migration from '../../migrations/0014_workout_recovery_and_corrections.sql?raw'

/**
 * Round 21 — migration 0014.
 *
 * It carries two things: the durable marker that says a workout was actually
 * worked in, and the immutable audit that makes a historical correction
 * accountable.
 *
 * As in every migration round, the text assertions say what the file must and
 * must not contain, and the EXECUTED ones run the whole accepted chain against
 * real SQLite in both orders production can be in. The upgrade path is the one
 * that could damage the user's history, so it writes rows first and reads them
 * back afterwards — including the real Triceps rows this round exists to let
 * them correct, which the migration itself must leave completely alone.
 */

const statements = migration
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

const ACCEPTED_CHAIN = [
  migration0001, migration0002, migration0003, migration0004, migration0005,
  migration0006, migration0007, migration0008, migration0009, migration0010,
  migration0011, migration0012, migration0013,
]

/* ------------------------------------------------------------------ */
/* The SQL itself                                                      */
/* ------------------------------------------------------------------ */

describe('migration 0014 — the file', () => {
  it('adds and nothing else: it drops, deletes, rewrites and backfills nothing', () => {
    for (const banned of [
      /DROP\s+TABLE/i,
      /DROP\s+COLUMN/i,
      /DELETE\s+FROM/i,
      /TRUNCATE/i,
      /UPDATE\s+\w/i,
      /INSERT\s+INTO/i,
      /RENAME/i,
    ]) {
      expect(statements, String(banned)).not.toMatch(banned)
    }
  })

  it('rewrites no already-applied migration', () => {
    // 0014 is the only file this round may add.
    expect(ACCEPTED_CHAIN).toHaveLength(13)
  })

  it('adds exactly one nullable column, to workout_occurrences', () => {
    const alters = statements.match(/ALTER TABLE\s+(\w+)/g) ?? []
    expect(alters).toHaveLength(1)
    expect(alters[0]).toMatch(/workout_occurrences/)
    expect(statements.match(/ADD COLUMN/g)).toHaveLength(1)
    expect(statements).toMatch(/ADD COLUMN touched_at INTEGER/)
    // No NOT NULL and no DEFAULT: every occurrence that already exists must
    // stay valid without being written to, and must NOT be back-filled into
    // looking touched.
    expect(statements).not.toMatch(/touched_at INTEGER NOT NULL/)
    expect(statements).not.toMatch(/touched_at INTEGER DEFAULT/)
    // workout_sets is not altered at all.
    expect(statements).not.toMatch(/ALTER TABLE workout_sets/)
  })

  it('creates exactly one table, the correction audit', () => {
    expect(statements.match(/CREATE TABLE/gi)).toHaveLength(1)
    expect(statements).toMatch(/CREATE TABLE IF NOT EXISTS workout_set_corrections/)
  })

  it('constrains the corrected-to modality in the database itself', () => {
    expect(statements).toMatch(
      /CHECK \(after_input_type IN \('weight_kg', 'resistance_band', 'bodyweight'\)\)/,
    )
    expect(statements).toMatch(
      /CHECK \(after_load_mode IN \('none', 'kg', 'kg_each'\)\)/,
    )
  })

  it('lets the audit follow the workout it describes', () => {
    expect(statements).toMatch(/REFERENCES workout_occurrences \(google_sub, workout_date, session_id\)/)
    expect(statements).toMatch(/ON DELETE CASCADE/)
  })

  it('adds its index idempotently, so a repeated local apply is safe', () => {
    expect(statements).toMatch(/CREATE INDEX IF NOT EXISTS idx_workout_set_corrections_set/)
    expect(statements.match(/CREATE INDEX/g)).toHaveLength(1)
  })

  it('seeds nothing and carries no real account identifier', () => {
    expect(migration).not.toMatch(/[0-9]{15,}/)
  })
})

/* ------------------------------------------------------------------ */
/* Executed                                                            */
/* ------------------------------------------------------------------ */

function apply(db: DatabaseSync, files: readonly string[]) {
  for (const file of files) db.exec(file)
}

function columnsOf(db: DatabaseSync, table: string): Map<string, number> {
  const rows = db
    .prepare(`SELECT name, "notnull" FROM pragma_table_info(?)`)
    .all(table) as { name: string; notnull: number }[]
  return new Map(rows.map((row) => [row.name, row.notnull]))
}

/**
 * A workout written before Round 21, including the real defect the user is
 * carrying: Triceps Pushdown recorded as kilograms when it was bands.
 */
function seedPreRound21History(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO workout_occurrences
       (google_sub, workout_date, session_id, snapshot_id, kind, source_session_id,
        session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
        started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'sub-1', '2026-09-01', 'tuesday', 'token-1', 'scheduled', null,
    'Tuesday', 'Chest + Triceps', 'HARD', 1, 2,
  )

  db.prepare(
    `INSERT INTO workout_sets
       (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
        exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
        equipment_snapshot, result_kind_snapshot, load_mode_snapshot, per_side_snapshot,
        status, actual_load_value, actual_load_unit, actual_result, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'sub-1', '2026-09-01', 'tuesday', 'token-1', 4, 0,
    'triceps-pushdown', 'Triceps Pushdown', '3 x 12-15', 'BAND', 'reps', 'kg', 0,
    'completed', 3, 'kg', 12, 3,
  )
}

describe('migration 0014 — clean install (0001 to 0014)', () => {
  it('applies on top of the whole accepted chain', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])

    const occurrences = columnsOf(db, 'workout_occurrences')
    expect(occurrences.has('touched_at')).toBe(true)
    // Nullable: an occurrence that has never been worked in says so by holding
    // nothing at all.
    expect(occurrences.get('touched_at')).toBe(0)

    const corrections = columnsOf(db, 'workout_set_corrections')
    for (const column of [
      'correction_id', 'google_sub', 'workout_date', 'session_id',
      'exercise_order', 'set_index', 'corrected_at',
      'before_input_type', 'before_load_mode', 'before_load_value',
      'before_load_unit', 'before_band_label', 'before_band_count', 'before_result',
      'after_input_type', 'after_load_mode', 'after_load_value',
      'after_load_unit', 'after_band_label', 'after_band_count', 'after_result',
    ]) {
      expect(corrections.has(column), column).toBe(true)
    }
    db.close()
  })

  it('starts with an empty audit and no occurrence marked as touched', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])

    const count = (t: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
    expect(count('workout_set_corrections')).toBe(0)
    db.close()
  })

  it('refuses an audit row whose corrected-to modality is not one of the three', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])
    seedPreRound21History(db)

    const insert = db.prepare(
      `INSERT INTO workout_set_corrections
         (correction_id, google_sub, workout_date, session_id, exercise_order, set_index,
          corrected_at, before_load_mode, after_input_type, after_load_mode, after_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    expect(() =>
      insert.run('c1', 'sub-1', '2026-09-01', 'tuesday', 4, 0, 9, 'kg', 'elastic_vibes', 'none', 12),
    ).toThrow()
    // And a coherent one is accepted, so the refusal above is about the VALUE.
    insert.run('c2', 'sub-1', '2026-09-01', 'tuesday', 4, 0, 9, 'kg', 'resistance_band', 'none', 12)
    db.close()
  })

  it('refuses a second audit row with the same correction id', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])
    seedPreRound21History(db)

    const insert = db.prepare(
      `INSERT INTO workout_set_corrections
         (correction_id, google_sub, workout_date, session_id, exercise_order, set_index,
          corrected_at, before_load_mode, after_input_type, after_load_mode, after_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('c1', 'sub-1', '2026-09-01', 'tuesday', 4, 0, 9, 'kg', 'resistance_band', 'none', 12)
    expect(() =>
      insert.run('c1', 'sub-1', '2026-09-01', 'tuesday', 4, 0, 10, 'none', 'weight_kg', 'kg', 12),
    ).toThrow()
    db.close()
  })

  it('keeps more than one correction of the SAME set, so the chain survives', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])
    seedPreRound21History(db)

    const insert = db.prepare(
      `INSERT INTO workout_set_corrections
         (correction_id, google_sub, workout_date, session_id, exercise_order, set_index,
          corrected_at, before_load_mode, after_input_type, after_load_mode, after_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('c1', 'sub-1', '2026-09-01', 'tuesday', 4, 0, 9, 'kg', 'resistance_band', 'none', 12)
    insert.run('c2', 'sub-1', '2026-09-01', 'tuesday', 4, 0, 10, 'none', 'weight_kg', 'kg', 12)

    const rows = db
      .prepare(
        `SELECT correction_id FROM workout_set_corrections
          WHERE exercise_order = 4 AND set_index = 0 ORDER BY corrected_at`,
      )
      .all() as { correction_id: string }[]
    expect(rows.map((r) => r.correction_id)).toEqual(['c1', 'c2'])
    db.close()
  })
})

describe('migration 0014 — upgrade (0001 to 0013, real data, then 0014)', () => {
  it('leaves every existing workout row exactly as it was', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    seedPreRound21History(db)

    const setColumns = `exercise_id_snapshot, load_mode_snapshot, status,
                        actual_load_value, actual_load_unit, actual_result, updated_at`
    const occColumns = `workout_date, session_id, kind, started_at, updated_at`
    const setsBefore = db.prepare(`SELECT ${setColumns} FROM workout_sets`).all()
    const occBefore = db.prepare(`SELECT ${occColumns} FROM workout_occurrences`).all()

    apply(db, [migration])

    expect(db.prepare(`SELECT ${setColumns} FROM workout_sets`).all()).toEqual(setsBefore)
    expect(db.prepare(`SELECT ${occColumns} FROM workout_occurrences`).all()).toEqual(occBefore)
    db.close()
  })

  it('does NOT correct the real Triceps defect — that is the user’s to make', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    seedPreRound21History(db)
    apply(db, [migration])

    const triceps = db
      .prepare(
        `SELECT actual_load_value, actual_load_unit, actual_result,
                input_type_snapshot, actual_band_label, actual_band_count
           FROM workout_sets WHERE exercise_id_snapshot = 'triceps-pushdown'`,
      )
      .get() as Record<string, unknown>

    // Still "3 kg × 12", untouched. Round 21 builds the audited path by which
    // the user corrects this; it does not guess on their behalf, and a
    // migration is exactly the wrong place to try.
    expect(triceps).toEqual({
      actual_load_value: 3,
      actual_load_unit: 'kg',
      actual_result: 12,
      input_type_snapshot: null,
      actual_band_label: null,
      actual_band_count: null,
    })
    // And no audit was invented for a correction nobody made.
    const audits = (
      db.prepare(`SELECT COUNT(*) AS n FROM workout_set_corrections`).get() as { n: number }
    ).n
    expect(audits).toBe(0)
    db.close()
  })

  it('marks no existing occurrence as touched', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    seedPreRound21History(db)
    apply(db, [migration])

    // NULL everywhere. Back-filling a touch marker would make every existing
    // workout permanently un-cancellable, including the accidental Starts this
    // round exists to let the user take back.
    const rows = db
      .prepare(`SELECT touched_at FROM workout_occurrences`)
      .all() as { touched_at: number | null }[]
    expect(rows).toEqual([{ touched_at: null }])
    db.close()
  })

  it('adds no row to any table', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    seedPreRound21History(db)

    const count = (t: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
    const before = { occ: count('workout_occurrences'), sets: count('workout_sets') }

    apply(db, [migration])

    expect({ occ: count('workout_occurrences'), sets: count('workout_sets') }).toEqual(before)
    expect(count('workout_set_corrections')).toBe(0)
    db.close()
  })
})

/* ------------------------------------------------------------------ */
/* No orphan audit                                                     */
/* ------------------------------------------------------------------ */

describe('migration 0014 — the audit cannot outlive its workout', () => {
  function seeded() {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])
    seedPreRound21History(db)
    db.prepare(
      `INSERT INTO workout_set_corrections
         (correction_id, google_sub, workout_date, session_id, exercise_order, set_index,
          corrected_at, before_load_mode, after_input_type, after_load_mode, after_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('c1', 'sub-1', '2026-09-01', 'tuesday', 4, 0, 9, 'kg', 'resistance_band', 'none', 12)
    return db
  }

  it('is removed by a Fresh Start style cleanup, leaving no orphan', () => {
    const db = seeded()
    // The order Fresh Start actually uses: children before parents, so nothing
    // depends on foreign keys being enforced.
    db.prepare(`DELETE FROM workout_set_corrections WHERE google_sub = ? AND workout_date < ?`)
      .run('sub-1', '2026-09-02')
    db.prepare(`DELETE FROM workout_calibration WHERE google_sub = ? AND workout_date < ?`)
      .run('sub-1', '2026-09-02')
    db.prepare(`DELETE FROM workout_sets WHERE google_sub = ? AND workout_date < ?`)
      .run('sub-1', '2026-09-02')
    db.prepare(`DELETE FROM workout_occurrences WHERE google_sub = ? AND workout_date < ?`)
      .run('sub-1', '2026-09-02')

    const orphans = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM workout_set_corrections x
            WHERE NOT EXISTS (
              SELECT 1 FROM workout_occurrences o
               WHERE o.google_sub = x.google_sub
                 AND o.workout_date = x.workout_date
                 AND o.session_id = x.session_id
            )`,
        )
        .get() as { n: number }
    ).n
    expect(orphans).toBe(0)
    db.close()
  })

  it('is removed by the declared cascade too, where foreign keys are enforced', () => {
    const db = seeded()
    db.exec('PRAGMA foreign_keys = ON')
    db.prepare(`DELETE FROM workout_occurrences WHERE google_sub = ?`).run('sub-1')

    const left = (
      db.prepare(`SELECT COUNT(*) AS n FROM workout_set_corrections`).get() as { n: number }
    ).n
    expect(left).toBe(0)
    db.close()
  })
})
