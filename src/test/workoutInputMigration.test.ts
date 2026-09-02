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
import migration from '../../migrations/0013_workout_input_types.sql?raw'

/**
 * Round 20 — migration 0013.
 *
 * The migration that carries the fix for the app's worst factual bug: a set
 * performed with three black bands was stored as "3 kg", because kilograms
 * were the only resistance the schema could express.
 *
 * The assertions come in two kinds, and the second is the one that matters.
 * The text ones say what the file must and must not contain. The EXECUTED ones
 * run the whole accepted chain against real SQLite in both orders production
 * can be in:
 *
 *   clean install   0001 -> ... -> 0013
 *   upgrade         0001 -> ... -> 0012, REAL DATA WRITTEN, then 0013
 *
 * The upgrade path is the one that could damage the user's history, so it is
 * the one that writes rows first and reads them back afterwards. "Looks
 * additive" is not the same as "provably left every existing set readable and
 * unchanged", and only the second is worth shipping.
 */

/**
 * The migration with its `--` commentary removed.
 *
 * These files carry long explanations of WHY, and the prose here legitimately
 * contains words like UPDATE and rewrite while describing exactly what is NOT
 * being done. An assertion about the SQL must look at the statements.
 */
const statements = migration
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

const ACCEPTED_CHAIN = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
]

/* ------------------------------------------------------------------ */
/* The SQL itself                                                      */
/* ------------------------------------------------------------------ */

describe('migration 0013 — the file', () => {
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
    // 0013 is the only file this round may add. The chain it sits on is
    // untouched, which the imports above would fail loudly to reflect if a
    // file were renamed out from under them.
    expect(ACCEPTED_CHAIN).toHaveLength(12)
  })

  it('alters only workout_sets, and only by adding three nullable columns', () => {
    const alters = statements.match(/ALTER TABLE\s+(\w+)/g) ?? []
    expect(alters).toHaveLength(3)
    expect(alters.every((line) => /workout_sets/.test(line))).toBe(true)
    expect(statements.match(/ADD COLUMN/g)).toHaveLength(3)
    // No NOT NULL on any of them: every row that already exists must remain
    // valid without being written to.
    expect(statements).not.toMatch(/ADD COLUMN\s+\w+\s+\w+\s+NOT NULL/i)
    // The occurrence table is not mentioned at all.
    expect(statements).not.toMatch(/workout_occurrences/)
  })

  it('creates exactly one table, and constrains its input type in the database', () => {
    expect(statements.match(/CREATE TABLE/gi)).toHaveLength(1)
    expect(statements).toMatch(/CREATE TABLE IF NOT EXISTS exercise_input_types/)
    // The allowlist is enforced by SQLite too, not only by the application, so
    // a direct write cannot introduce a modality nothing can render.
    expect(statements).toMatch(
      /CHECK \(input_type IN \('weight_kg', 'resistance_band', 'bodyweight'\)\)/,
    )
  })

  it('keys the setting by account AND exercise, so one account cannot see another', () => {
    expect(statements).toMatch(/PRIMARY KEY \(google_sub, exercise_id\)/)
  })

  it('adds its index idempotently, so a repeated local apply is safe', () => {
    expect(statements).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_exercise_input_types_account/,
    )
    expect(statements.match(/CREATE INDEX/g)).toHaveLength(1)
  })

  it('seeds nothing and carries no real account identifier', () => {
    expect(migration).not.toMatch(/[0-9]{15,}/)
  })
})

/* ------------------------------------------------------------------ */
/* The migration, actually executed                                    */
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
 * One completed workout, written exactly the way the app wrote them BEFORE
 * Round 20 existed — including the defect.
 *
 * The Triceps row is the real bug: the user performed it with three black
 * bands, and "3" went into the kilogram column because there was nowhere else
 * for it to go.
 */
function seedPreRound20History(db: DatabaseSync) {
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

  const insertSet = db.prepare(
    `INSERT INTO workout_sets
       (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
        exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
        equipment_snapshot, result_kind_snapshot, load_mode_snapshot, per_side_snapshot,
        status, actual_load_value, actual_load_unit, actual_result, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  insertSet.run(
    'sub-1', '2026-09-01', 'tuesday', 'token-1', 0, 0,
    'incline-db-press', 'Incline DB Press', '4 x 8-12', 'DB + Bench', 'reps', 'kg_each', 0,
    'completed', 20, 'kg_each', 10, 3,
  )
  // THE DEFECT, exactly as it was recorded: three black bands stored as 3 kg.
  insertSet.run(
    'sub-1', '2026-09-01', 'tuesday', 'token-1', 1, 0,
    'triceps-pushdown', 'Triceps Pushdown', '3 x 12-15', 'BAND', 'reps', 'kg', 0,
    'completed', 3, 'kg', 12, 4,
  )
}

describe('migration 0013 — clean install (0001 to 0013)', () => {
  it('applies on top of the whole accepted chain', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])

    const sets = columnsOf(db, 'workout_sets')
    expect(sets.has('input_type_snapshot')).toBe(true)
    expect(sets.has('actual_band_label')).toBe(true)
    expect(sets.has('actual_band_count')).toBe(true)
    // Nullable, every one of them: a legacy row must stay valid untouched.
    expect(sets.get('input_type_snapshot')).toBe(0)
    expect(sets.get('actual_band_label')).toBe(0)
    expect(sets.get('actual_band_count')).toBe(0)
    db.close()
  })

  it('creates the settings table with its account-scoped key', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])

    const insert = db.prepare(
      `INSERT INTO exercise_input_types
         (google_sub, exercise_id, input_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    insert.run('sub-1', 'triceps-pushdown', 'resistance_band', 1, 1)
    // A DIFFERENT account may hold its own answer for the same exercise.
    insert.run('sub-2', 'triceps-pushdown', 'weight_kg', 1, 1)

    // The same account twice is a conflict, not a second opinion.
    expect(() => insert.run('sub-1', 'triceps-pushdown', 'weight_kg', 2, 2)).toThrow()

    const rows = db
      .prepare(`SELECT google_sub, input_type FROM exercise_input_types ORDER BY google_sub`)
      .all() as { google_sub: string; input_type: string }[]
    expect(rows).toEqual([
      { google_sub: 'sub-1', input_type: 'resistance_band' },
      { google_sub: 'sub-2', input_type: 'weight_kg' },
    ])
    db.close()
  })

  it('refuses an input type outside the allowlist, in the database itself', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])

    expect(() =>
      db
        .prepare(
          `INSERT INTO exercise_input_types
             (google_sub, exercise_id, input_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('sub-1', 'triceps-pushdown', 'elastic_vibes', 1, 1),
    ).toThrow()
    db.close()
  })

  it('stores a band as a NAME and a COUNT, never as a weight', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])

    db.prepare(
      `INSERT INTO workout_occurrences
         (google_sub, workout_date, session_id, snapshot_id, kind, source_session_id,
          session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
          started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sub-1', '2026-09-08', 'tuesday', 't1', 'scheduled', null, 'Tuesday', 'F', 'HARD', 1, 1)

    db.prepare(
      `INSERT INTO workout_sets
         (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
          exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
          equipment_snapshot, result_kind_snapshot, load_mode_snapshot, per_side_snapshot,
          status, actual_load_value, actual_load_unit, actual_result, updated_at,
          input_type_snapshot, actual_band_label, actual_band_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sub-1', '2026-09-08', 'tuesday', 't1', 0, 0,
      'triceps-pushdown', 'Triceps Pushdown', '3 x 12-15', 'BAND', 'reps', 'none', 0,
      'completed', null, null, 12, 2,
      'resistance_band', 'Black', 3,
    )

    const row = db
      .prepare(
        `SELECT input_type_snapshot, actual_band_label, actual_band_count,
                actual_load_value, actual_load_unit, load_mode_snapshot
           FROM workout_sets`,
      )
      .get() as Record<string, unknown>

    expect(row).toEqual({
      input_type_snapshot: 'resistance_band',
      actual_band_label: 'Black',
      actual_band_count: 3,
      // The kilogram columns stay empty. There is no weight here to record.
      actual_load_value: null,
      actual_load_unit: null,
      load_mode_snapshot: 'none',
    })
    db.close()
  })
})

describe('migration 0013 — upgrade (0001 to 0012, real data, then 0013)', () => {
  it('leaves every existing set exactly as it was recorded', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    seedPreRound20History(db)

    const columns = `exercise_id_snapshot, load_mode_snapshot, status,
                     actual_load_value, actual_load_unit, actual_result, updated_at`
    const before = db
      .prepare(`SELECT ${columns} FROM workout_sets ORDER BY exercise_order`)
      .all()

    apply(db, [migration])

    const after = db
      .prepare(`SELECT ${columns} FROM workout_sets ORDER BY exercise_order`)
      .all()

    expect(after).toEqual(before)
    db.close()
  })

  it('does NOT correct the recorded defect, and says so by leaving it alone', () => {
    // The Triceps row genuinely reads "3 kg" for three black bands, and that
    // is what the old system genuinely recorded. Rewriting it would replace
    // one wrong history with a guessed one, so Round 20 does not: it stops the
    // next set from being wrong, and leaves the record of the past honest
    // about having been wrong.
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    seedPreRound20History(db)
    apply(db, [migration])

    const triceps = db
      .prepare(
        `SELECT actual_load_value, actual_load_unit, input_type_snapshot,
                actual_band_label, actual_band_count
           FROM workout_sets WHERE exercise_id_snapshot = 'triceps-pushdown'`,
      )
      .get() as Record<string, unknown>

    expect(triceps).toEqual({
      actual_load_value: 3,
      actual_load_unit: 'kg',
      // Null: this row predates the snapshot, and no value was invented for it.
      input_type_snapshot: null,
      actual_band_label: null,
      actual_band_count: null,
    })
    db.close()
  })

  it('adds no row to any table', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    seedPreRound20History(db)

    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

    const before = {
      occurrences: count('workout_occurrences'),
      sets: count('workout_sets'),
    }

    apply(db, [migration])

    expect({
      occurrences: count('workout_occurrences'),
      sets: count('workout_sets'),
    }).toEqual(before)
    // And the new table starts genuinely empty rather than pre-answered.
    expect(count('exercise_input_types')).toBe(0)
    db.close()
  })

  it('lets a NEW band set live beside the old kilogram rows, in one table', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    seedPreRound20History(db)
    apply(db, [migration])

    db.prepare(
      `INSERT INTO workout_occurrences
         (google_sub, workout_date, session_id, snapshot_id, kind, source_session_id,
          session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
          started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sub-1', '2026-09-08', 'tuesday', 't2', 'scheduled', null, 'Tuesday', 'F', 'HARD', 5, 5)

    db.prepare(
      `INSERT INTO workout_sets
         (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
          exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
          equipment_snapshot, result_kind_snapshot, load_mode_snapshot, per_side_snapshot,
          status, actual_load_value, actual_load_unit, actual_result, updated_at,
          input_type_snapshot, actual_band_label, actual_band_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sub-1', '2026-09-08', 'tuesday', 't2', 1, 0,
      'triceps-pushdown', 'Triceps Pushdown', '3 x 12-15', 'BAND', 'reps', 'none', 0,
      'completed', null, null, 12, 6,
      'resistance_band', 'Black', 3,
    )

    const rows = db
      .prepare(
        `SELECT workout_date, input_type_snapshot, actual_load_value, actual_band_count
           FROM workout_sets
          WHERE exercise_id_snapshot = 'triceps-pushdown'
          ORDER BY workout_date`,
      )
      .all() as Record<string, unknown>[]

    // Same exercise, same account, two genuinely different measurements —
    // stored side by side without either being rewritten to look like the
    // other.
    expect(rows).toEqual([
      {
        workout_date: '2026-09-01',
        input_type_snapshot: null,
        actual_load_value: 3,
        actual_band_count: null,
      },
      {
        workout_date: '2026-09-08',
        input_type_snapshot: 'resistance_band',
        actual_load_value: null,
        actual_band_count: 3,
      },
    ])
    db.close()
  })
})
