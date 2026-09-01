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
import migration from '../../migrations/0010_flexible_training.sql?raw'

/**
 * Round 17 — migration 0010.
 *
 * Two kinds of assertion, and the second is the one that matters.
 *
 * The text assertions below say what the file must and must not contain. The
 * EXECUTED ones actually run the whole accepted chain against real SQLite, in
 * both of the orders production can be in:
 *
 *   clean install   0001 → … → 0010
 *   upgrade         0001 → … → 0009, real data written, THEN 0010
 *
 * The upgrade path is the one that could lose history, so it is the one that
 * writes rows first and reads them back afterwards. A migration that "looks
 * additive" is not the same as one that provably left existing workouts
 * readable, and only the second is worth shipping.
 */

/**
 * The migration with its `--` commentary removed.
 *
 * These files carry long explanations of WHY, and the prose legitimately
 * contains words like ALTER and RENAME while describing what is deliberately
 * not being done. An assertion about the SQL must look at the statements, not
 * at the reasoning around them.
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
]

/* ------------------------------------------------------------------ */
/* The SQL itself                                                      */
/* ------------------------------------------------------------------ */

describe('migration 0010 — the file', () => {
  it('adds columns and nothing else: it drops, deletes and rewrites nothing', () => {
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

  it('touches only workout_occurrences, and only by adding to it', () => {
    // Two ADD COLUMNs, both on the occurrence table. No other table is altered,
    // and in particular workout_sets — where every frozen snapshot lives — is
    // not mentioned at all.
    const alters = statements.match(/ALTER TABLE\s+(\w+)/g) ?? []
    expect(alters).toHaveLength(2)
    expect(alters.every((line) => /workout_occurrences/.test(line))).toBe(true)
    expect(statements).not.toMatch(/workout_sets/)
    expect(statements).not.toMatch(/workout_calibration/)
    expect(statements.match(/ADD COLUMN/g)).toHaveLength(2)
  })

  it('creates no table, so nothing can be recreated in place of an old one', () => {
    expect(statements).not.toMatch(/CREATE TABLE/i)
  })

  it('defaults existing history to scheduled truth', () => {
    // This is what makes the upgrade path safe without a backfill.
    expect(statements).toMatch(/ADD COLUMN kind TEXT NOT NULL DEFAULT 'scheduled'/)
  })

  it('records the source session as nullable provenance, not identity', () => {
    expect(statements).toMatch(/ADD COLUMN source_session_id TEXT/)
    // No NOT NULL: a scheduled workout has no source, and neither does any row
    // that already exists.
    expect(statements).not.toMatch(/source_session_id TEXT NOT NULL/)
  })

  it('adds its index idempotently, so a repeated local apply is safe', () => {
    expect(statements).toMatch(/CREATE INDEX IF NOT EXISTS idx_workout_occurrences_kind/)
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

function columnsOf(db: DatabaseSync, table: string): Map<string, { notnull: number; dflt: unknown }> {
  const rows = db
    .prepare(`SELECT name, "notnull", dflt_value FROM pragma_table_info(?)`)
    .all(table) as { name: string; notnull: number; dflt_value: unknown }[]
  return new Map(rows.map((row) => [row.name, { notnull: row.notnull, dflt: row.dflt_value }]))
}

/** One started workout, written the way 0004 stores one. */
function seedScheduledWorkout(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO workout_occurrences
       (google_sub, workout_date, session_id, snapshot_id,
        session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
        started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('sub-1', '2026-08-31', 'monday', 'token-1', 'Monday', 'Back Width + Biceps', 'HARD', 1, 2)

  db.prepare(
    `INSERT INTO workout_sets
       (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
        exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
        equipment_snapshot, result_kind_snapshot, load_mode_snapshot, per_side_snapshot,
        status, actual_load_value, actual_load_unit, actual_result, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'sub-1', '2026-08-31', 'monday', 'token-1', 0, 0,
    'lat-pulldown', 'Lat Pulldown', '4 × 10–15', 'BAND 20kg', 'reps', 'kg', 0,
    'completed', 30, 'kg', 12, 3,
  )
}

describe('migration 0010 — clean install (0001 → 0010)', () => {
  it('applies on top of the whole accepted chain', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])

    const columns = columnsOf(db, 'workout_occurrences')
    expect(columns.has('kind')).toBe(true)
    expect(columns.has('source_session_id')).toBe(true)
    expect(columns.get('kind')?.notnull).toBe(1)
    expect(columns.get('source_session_id')?.notnull).toBe(0)
    db.close()
  })

  it('stores a scheduled and an extra occurrence on the same date without collision', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])

    const insert = db.prepare(
      `INSERT INTO workout_occurrences
         (google_sub, workout_date, session_id, snapshot_id, kind, source_session_id,
          session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
          started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('sub-1', '2026-09-07', 'monday', 't1', 'scheduled', null, 'Monday', 'F', 'HARD', 1, 1)
    // The same account, the same date, the same source template — and it fits,
    // because the reserved slug makes it a different occurrence.
    insert.run('sub-1', '2026-09-07', 'extra', 't2', 'extra', 'monday', 'Monday', 'F', 'HARD', 2, 2)

    const rows = db
      .prepare(`SELECT session_id, kind, source_session_id FROM workout_occurrences ORDER BY session_id`)
      .all() as { session_id: string; kind: string; source_session_id: string | null }[]

    expect(rows).toEqual([
      { session_id: 'extra', kind: 'extra', source_session_id: 'monday' },
      { session_id: 'monday', kind: 'scheduled', source_session_id: null },
    ])
    db.close()
  })

  it('still refuses a SECOND extra on the same account and date', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, [...ACCEPTED_CHAIN, migration])

    const insert = db.prepare(
      `INSERT INTO workout_occurrences
         (google_sub, workout_date, session_id, snapshot_id, kind, source_session_id,
          session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
          started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run('sub-1', '2026-09-07', 'extra', 't1', 'extra', 'monday', 'Monday', 'F', 'HARD', 1, 1)

    // One Extra per account per local date is the occurrence primary key, not a
    // rule the API remembers to apply.
    expect(() =>
      insert.run('sub-1', '2026-09-07', 'extra', 't2', 'extra', 'tuesday', 'Tuesday', 'G', 'HARD', 2, 2),
    ).toThrow()
    db.close()
  })
})

describe('migration 0010 — upgrade from the accepted production state (0001–0009 → 0010)', () => {
  it('leaves an existing workout readable, and reads it as scheduled', () => {
    const db = new DatabaseSync(':memory:')
    // Exactly what production is before this round.
    apply(db, ACCEPTED_CHAIN)
    seedScheduledWorkout(db)

    const before = db
      .prepare(`SELECT * FROM workout_occurrences`)
      .all() as Record<string, unknown>[]
    const setsBefore = db.prepare(`SELECT * FROM workout_sets`).all() as Record<string, unknown>[]

    apply(db, [migration])

    const after = db.prepare(`SELECT * FROM workout_occurrences`).all() as Record<string, unknown>[]
    const setsAfter = db.prepare(`SELECT * FROM workout_sets`).all() as Record<string, unknown>[]

    expect(after).toHaveLength(1)
    // The pre-existing workout is scheduled truth, with no backfill statement.
    expect(after[0].kind).toBe('scheduled')
    expect(after[0].source_session_id).toBeNull()

    // Every column 0004 froze is byte-identical afterwards. The frozen snapshot
    // is history, and this migration must not be able to touch it.
    for (const key of Object.keys(before[0])) {
      expect(after[0][key], key).toEqual(before[0][key])
    }
    expect(setsAfter).toEqual(setsBefore)
    db.close()
  })

  it('lets an Extra be added afterwards, beside the migrated scheduled workout', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    seedScheduledWorkout(db)
    apply(db, [migration])

    db.prepare(
      `INSERT INTO workout_occurrences
         (google_sub, workout_date, session_id, snapshot_id, kind, source_session_id,
          session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
          started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sub-1', '2026-08-31', 'extra', 't2', 'extra', 'monday', 'Monday', 'F', 'HARD', 5, 5)

    const scheduled = db
      .prepare(`SELECT COUNT(*) AS n FROM workout_occurrences WHERE kind = 'scheduled'`)
      .get() as { n: number }
    const extra = db
      .prepare(`SELECT COUNT(*) AS n FROM workout_occurrences WHERE kind = 'extra'`)
      .get() as { n: number }

    // The scheduled-only filter every progression read now carries returns the
    // migrated workout and only it.
    expect(scheduled.n).toBe(1)
    expect(extra.n).toBe(1)
    db.close()
  })

  it('is safe to run its index step twice', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, ACCEPTED_CHAIN)
    apply(db, [migration])

    // The ADD COLUMNs are not idempotent — SQLite has no IF NOT EXISTS for
    // them — but the migration ledger applies each file exactly once, and the
    // index step is guarded so a partially-applied file can be re-run.
    expect(() =>
      db.exec(`CREATE INDEX IF NOT EXISTS idx_workout_occurrences_kind
                 ON workout_occurrences (google_sub, kind, session_id, workout_date)`),
    ).not.toThrow()
    db.close()
  })
})
