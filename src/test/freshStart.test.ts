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

import {
  FRESH_START_PRESERVED_TABLES,
  freshStartInventory,
  freshStartOrphanChecks,
  freshStartStatements,
  parseFreshStartTarget,
} from '@shared/freshStart'

/**
 * Round 18 — the Fresh Start reset, executed against real SQLite.
 *
 * The logic is pure and the schema is the accepted migration chain, so these
 * run the ACTUAL statements the operator script would run, against the ACTUAL
 * tables production has. Nothing here touches a network or a real database.
 *
 * The cutover is 2026-09-01: everything strictly before it goes, and 2026-09-01
 * itself — Day 1 of the new Foundation — must survive.
 */

const CHAIN = [
  migration0001, migration0002, migration0003, migration0004, migration0005, migration0006,
  migration0007, migration0008, migration0009, migration0010, migration0011, migration0012,
]

const CUTOFF = '2026-09-01'
const MINE = 'sub-mine'
const THEIRS = 'sub-theirs'

function migrated(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  for (const file of CHAIN) db.exec(file)
  return db
}

function addOccurrence(
  db: DatabaseSync,
  googleSub: string,
  date: string,
  sessionId: string,
  kind: 'scheduled' | 'extra' = 'scheduled',
) {
  const token = `${googleSub}-${date}-${sessionId}`
  db.prepare(
    `INSERT INTO workout_occurrences
       (google_sub, workout_date, session_id, snapshot_id, kind, source_session_id,
        session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
        started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    googleSub, date, sessionId, token, kind, kind === 'extra' ? 'monday' : null,
    'Monday', 'Back Width + Biceps', 'HARD', 1, 1,
  )

  db.prepare(
    `INSERT INTO workout_sets
       (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
        exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
        equipment_snapshot, result_kind_snapshot, load_mode_snapshot, per_side_snapshot,
        status, actual_load_value, actual_load_unit, actual_result, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 'reps', 'kg', 0, 'completed', 60, 'kg', 15, 1)`,
  ).run(
    googleSub, date, sessionId, token,
    'lat-pulldown', 'Lat Pulldown', '4 × 10–15', 'BAND 20kg',
  )

  db.prepare(
    `INSERT INTO workout_calibration
       (google_sub, workout_date, session_id, exercise_order, lane_fingerprint, feedback,
        observed_load_value, observed_load_unit, chosen_load_value, chosen_load_unit,
        created_at, updated_at)
     VALUES (?, ?, ?, 0, 'fp', 'good', 60, 'kg', NULL, NULL, 1, 1)`,
  ).run(googleSub, date, sessionId)
}

/** Rows in every table a Fresh Start must leave alone. */
function seedPreserved(db: DatabaseSync, googleSub: string) {
  db.prepare(
    `INSERT INTO auth_sessions
       (session_hash, google_sub, email, name, picture, trusted, created_at, last_seen_at, expires_at, revoked_at)
     VALUES (?, ?, 'a@example.com', NULL, NULL, 1, 1, 1, 9999999999999, NULL)`,
  ).run(`hash-${googleSub}`, googleSub)

  db.prepare(
    `INSERT INTO account_settings (google_sub, foundation_start_date, created_at, updated_at)
     VALUES (?, ?, 1, 1)`,
  ).run(googleSub, CUTOFF)

  // Dated BEFORE the cutoff on purpose: these must survive anyway, because a
  // Fresh Start resets training history and nothing else.
  db.prepare(
    `INSERT INTO body_weight_entries (google_sub, local_date, weight_tenths_kg, created_at, updated_at)
     VALUES (?, '2026-08-20', 784, 1, 1)`,
  ).run(googleSub)

  db.prepare(
    `INSERT INTO today_completions (google_sub, occurrence_key, anchor_day, completed_at)
     VALUES (?, 'k1', '2026-08-20', 1)`,
  ).run(googleSub)

  db.prepare(
    `INSERT INTO holiday_overrides
       (id, google_sub, start_date, end_date, name, training_on, created_at, updated_at)
     VALUES (?, ?, '2026-08-15', '2026-08-16', '', 0, 1, 1)`,
  ).run(`h-${googleSub}`, googleSub)

  db.prepare(
    `INSERT INTO exercise_media (google_sub, exercise_id, media_type, media_url, media_alt, updated_at)
     VALUES (?, 'lat-pulldown', 'image', 'https://example.com/a.png', 'alt', 1)`,
  ).run(googleSub)

  // The endpoint hash carries a real CHECK — it must be a 64-character digest,
  // so the fixture supplies one rather than a placeholder the schema refuses.
  const endpointHash = googleSub.padEnd(64, '0').slice(0, 64)
  db.prepare(
    `INSERT INTO push_subscriptions
       (id, google_sub, endpoint, endpoint_hash, p256dh, auth, timezone, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'k', 'a', 'Asia/Kuala_Lumpur', 1, 1)`,
  ).run(`p-${googleSub}`, googleSub, `https://push.example/${googleSub}`, endpointHash)
}

function count(db: DatabaseSync, sql: string, params: (string | number)[] = []): number {
  return (db.prepare(sql).get(...params) as { n: number }).n
}

function runAll(db: DatabaseSync, statements: { sql: string; params: (string | number)[] }[]) {
  return statements.map((statement) => {
    const row = db.prepare(statement.sql).get(...statement.params) as { n: number } | undefined
    return row?.n
  })
}

function execute(db: DatabaseSync, googleSub: string, cutoff: string) {
  const parsed = parseFreshStartTarget(googleSub, cutoff)
  if (!parsed.ok) throw new Error(`invalid target: ${parsed.field}`)
  for (const statement of freshStartStatements(parsed.value)) {
    db.prepare(statement.sql).run(...statement.params)
  }
}

/** An account with history on both sides of the cutover, plus everything else. */
function scenario(): DatabaseSync {
  const db = migrated()
  seedPreserved(db, MINE)
  seedPreserved(db, THEIRS)

  // Mine, before the cutoff — scheduled and Extra alike.
  addOccurrence(db, MINE, '2026-08-24', 'monday')
  addOccurrence(db, MINE, '2026-08-31', 'monday')
  addOccurrence(db, MINE, '2026-08-31', 'extra', 'extra')

  // Mine, on and after the cutoff — must survive.
  addOccurrence(db, MINE, '2026-09-01', 'tuesday')
  addOccurrence(db, MINE, '2026-09-07', 'monday')

  // Somebody else's, before the cutoff — must survive.
  addOccurrence(db, THEIRS, '2026-08-24', 'monday')
  return db
}

/* ------------------------------------------------------------------ */
/* Target validation                                                   */
/* ------------------------------------------------------------------ */

describe('the target must be named explicitly', () => {
  it('refuses a missing or empty account', () => {
    for (const value of [undefined, null, '', '   ', 42]) {
      expect(parseFreshStartTarget(value, CUTOFF), String(value)).toEqual({
        ok: false,
        field: 'google_sub',
      })
    }
  })

  it('refuses a missing or impossible cutoff', () => {
    for (const value of [undefined, '', '2026-9-1', '2026-02-30', 'yesterday']) {
      expect(parseFreshStartTarget(MINE, value), String(value)).toEqual({
        ok: false,
        field: 'cutoff',
      })
    }
  })

  it('accepts an explicit account and a real date', () => {
    expect(parseFreshStartTarget(MINE, CUTOFF)).toEqual({
      ok: true,
      value: { googleSub: MINE, cutoff: CUTOFF },
    })
  })
})

/* ------------------------------------------------------------------ */
/* 16 + 17 + 18 + 19. What is removed, and what is not                 */
/* ------------------------------------------------------------------ */

describe('16/17. it removes only the target account, only before the cutoff', () => {
  it('deletes pre-cutoff occurrences and keeps the cutoff day itself', () => {
    const db = scenario()

    expect(count(db, `SELECT COUNT(*) AS n FROM workout_occurrences WHERE google_sub = ?`, [MINE])).toBe(5)
    execute(db, MINE, CUTOFF)

    const mine = db
      .prepare(`SELECT workout_date, session_id FROM workout_occurrences WHERE google_sub = ? ORDER BY workout_date, session_id`)
      .all(MINE) as { workout_date: string; session_id: string }[]

    // 2026-09-01 is Day 1 of the new Foundation — the boundary is strict `<`.
    expect(mine).toEqual([
      { workout_date: '2026-09-01', session_id: 'tuesday' },
      { workout_date: '2026-09-07', session_id: 'monday' },
    ])
    db.close()
  })

  it('leaves another account untouched, including its pre-cutoff history', () => {
    const db = scenario()
    execute(db, MINE, CUTOFF)

    expect(count(db, `SELECT COUNT(*) AS n FROM workout_occurrences WHERE google_sub = ?`, [THEIRS])).toBe(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM workout_sets WHERE google_sub = ?`, [THEIRS])).toBe(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM workout_calibration WHERE google_sub = ?`, [THEIRS])).toBe(1)
    db.close()
  })

  it('removes Extra occurrences too, not only scheduled ones', () => {
    const db = scenario()
    execute(db, MINE, CUTOFF)

    expect(
      count(db, `SELECT COUNT(*) AS n FROM workout_occurrences WHERE google_sub = ? AND kind = 'extra'`, [MINE]),
    ).toBe(0)
    db.close()
  })
})

describe('18/19. owned rows go with their occurrence, and nothing is orphaned', () => {
  it('removes the sets and calibration of every deleted occurrence', () => {
    const db = scenario()
    execute(db, MINE, CUTOFF)

    expect(count(db, `SELECT COUNT(*) AS n FROM workout_sets WHERE google_sub = ? AND workout_date < ?`, [MINE, CUTOFF])).toBe(0)
    expect(count(db, `SELECT COUNT(*) AS n FROM workout_calibration WHERE google_sub = ? AND workout_date < ?`, [MINE, CUTOFF])).toBe(0)

    // …and keeps the ones belonging to surviving occurrences.
    expect(count(db, `SELECT COUNT(*) AS n FROM workout_sets WHERE google_sub = ? AND workout_date >= ?`, [MINE, CUTOFF])).toBe(2)
    expect(count(db, `SELECT COUNT(*) AS n FROM workout_calibration WHERE google_sub = ? AND workout_date >= ?`, [MINE, CUTOFF])).toBe(2)
    db.close()
  })

  it('leaves no orphaned set or calibration row anywhere', () => {
    const db = scenario()
    execute(db, MINE, CUTOFF)

    const [orphanSets, orphanCalibration] = runAll(db, freshStartOrphanChecks())
    expect(orphanSets).toBe(0)
    expect(orphanCalibration).toBe(0)
    db.close()
  })
})

/* ------------------------------------------------------------------ */
/* 20. Everything else survives                                        */
/* ------------------------------------------------------------------ */

describe('20. non-training data is preserved', () => {
  it('keeps settings, body weight, completions, holidays, media and push rows', () => {
    const db = scenario()
    execute(db, MINE, CUTOFF)

    // All of these are dated BEFORE the cutoff on purpose.
    expect(count(db, `SELECT COUNT(*) AS n FROM account_settings WHERE google_sub = ?`, [MINE])).toBe(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM body_weight_entries WHERE google_sub = ?`, [MINE])).toBe(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM today_completions WHERE google_sub = ?`, [MINE])).toBe(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM holiday_overrides WHERE google_sub = ?`, [MINE])).toBe(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM exercise_media WHERE google_sub = ?`, [MINE])).toBe(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM push_subscriptions WHERE google_sub = ?`, [MINE])).toBe(1)
    expect(count(db, `SELECT COUNT(*) AS n FROM auth_sessions WHERE google_sub = ?`, [MINE])).toBe(1)

    // The chosen Foundation start date survives: a Fresh Start resets history,
    // not the setting that decides how the surviving history is numbered.
    const settings = db
      .prepare(`SELECT foundation_start_date AS d FROM account_settings WHERE google_sub = ?`)
      .get(MINE) as { d: string }
    expect(settings.d).toBe(CUTOFF)
    db.close()
  })

  it('names no preserved table in any statement it generates', () => {
    const sql = [
      ...freshStartStatements({ googleSub: MINE, cutoff: CUTOFF }),
      ...freshStartInventory({ googleSub: MINE, cutoff: CUTOFF }),
    ]
      .map((statement) => statement.sql)
      .join('\n')

    // Structural, not incidental: adding a statement that touches one of these
    // fails here rather than in production.
    for (const table of FRESH_START_PRESERVED_TABLES) {
      expect(sql, table).not.toContain(table)
    }
  })

  it('scopes every generated statement to the account AND the cutoff', () => {
    for (const statement of freshStartStatements({ googleSub: MINE, cutoff: CUTOFF })) {
      expect(statement.sql).toContain('google_sub = ?')
      expect(statement.sql).toContain('workout_date < ?')
      // Never `<=`: the cutoff day is Day 1 of the new Foundation.
      expect(statement.sql).not.toContain('workout_date <= ?')
      expect(statement.params).toEqual([MINE, CUTOFF])
    }
  })

  it('deletes children before parents, so no cascade is relied upon', () => {
    const tables = freshStartStatements({ googleSub: MINE, cutoff: CUTOFF }).map(
      (statement) => /DELETE FROM (\w+)/.exec(statement.sql)![1],
    )
    expect(tables).toEqual(['workout_calibration', 'workout_sets', 'workout_occurrences'])
  })
})

/* ------------------------------------------------------------------ */
/* 21. Removed evidence cannot reach derived truth                     */
/* ------------------------------------------------------------------ */

describe('21. derived truth follows the surviving rows', () => {
  it('leaves no pre-cutoff completed set for PB or performance to read', () => {
    const db = scenario()
    execute(db, MINE, CUTOFF)

    // PB and Exercise Performance read completed SETS; progression and streaks
    // read occurrences. With the rows gone there is nothing left to derive a
    // pre-cutoff number from — and no counter was hand-edited to achieve it.
    expect(
      count(db, `SELECT COUNT(*) AS n FROM workout_sets WHERE google_sub = ? AND status = 'completed' AND workout_date < ?`, [MINE, CUTOFF]),
    ).toBe(0)
    expect(
      count(db, `SELECT COUNT(*) AS n FROM workout_occurrences WHERE google_sub = ? AND workout_date < ?`, [MINE, CUTOFF]),
    ).toBe(0)

    // Surviving evidence is untouched and still complete.
    expect(
      count(db, `SELECT COUNT(*) AS n FROM workout_sets WHERE google_sub = ? AND status = 'completed'`, [MINE]),
    ).toBe(2)
    db.close()
  })

  it('inventories both sides before anything is deleted', () => {
    const db = scenario()
    const before = runAll(db, freshStartInventory({ googleSub: MINE, cutoff: CUTOFF }))

    // occurrences before/kept, sets before/kept, calibration before/kept.
    expect(before).toEqual([3, 2, 3, 2, 3, 2])

    execute(db, MINE, CUTOFF)
    const after = runAll(db, freshStartInventory({ googleSub: MINE, cutoff: CUTOFF }))
    expect(after).toEqual([0, 2, 0, 2, 0, 2])
    db.close()
  })

  it('is idempotent — running it twice removes nothing further', () => {
    const db = scenario()
    execute(db, MINE, CUTOFF)
    const after = runAll(db, freshStartInventory({ googleSub: MINE, cutoff: CUTOFF }))
    execute(db, MINE, CUTOFF)
    expect(runAll(db, freshStartInventory({ googleSub: MINE, cutoff: CUTOFF }))).toEqual(after)
    db.close()
  })
})
