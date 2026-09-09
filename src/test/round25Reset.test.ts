/*
 * Round 25 — the FULL ACTIVITY FRESH START, executed against real SQLite.
 *
 * The planner is pure and the schema is the accepted migration chain, so these
 * run the ACTUAL statements the operator would run, against the ACTUAL tables
 * production has. Nothing here touches a network or a real database.
 *
 * `node:sqlite` is a Node built-in Vite refuses to bundle for the client, so
 * this file opts out of the project's jsdom default.
 *
 * @vitest-environment node
 */
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
import migration0014 from '../../migrations/0014_workout_recovery_and_corrections.sql?raw'
import migration0015 from '../../migrations/0015_programme_builder.sql?raw'

import { runRound25Reset } from '../../scripts/round25-reset.mjs'
// The operator's own text, for the structural proof that the destructive
// command has exactly one call site.
import operatorSource from '../../scripts/round25-reset.mjs?raw'
import {
  ROUND25_PRESERVED_TABLES,
  ROUND25_RESET_TABLES,
  ROUND25_SETTINGS_TABLE,
  parseRound25Target,
  renderStatement,
  round25FoundationCheck,
  round25FoundationStatement,
  ROUND25_OPERATIONAL_TABLES,
  round25Inventory,
  round25IsolationChecks,
  round25OperationalCounts,
  round25OrphanChecks,
  round25StableFingerprint,
  round25TargetOrphanChecks,
  round25ResetStatements,
  round25Transaction,
  type Round25Target,
} from '@shared/round25Reset'

/** The whole accepted ledger, 0001–0015. */
const CHAIN = [
  migration0001, migration0002, migration0003, migration0004, migration0005,
  migration0006, migration0007, migration0008, migration0009, migration0010,
  migration0011, migration0012, migration0013, migration0014, migration0015,
]

const MINE = 'sub-mine'
const THEIRS = 'sub-theirs'
const NEW_DAY_1 = '2026-10-05'
const NOW = 1_800_000_000_000

const target: Round25Target = { googleSub: MINE, foundationStart: NEW_DAY_1 }

function migrated(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  for (const file of CHAIN) db.exec(file)
  return db
}

/**
 * Write a row that violates a declared foreign key.
 *
 * `node:sqlite` enforces foreign keys; D1 does not guarantee it for a given
 * statement, which is precisely why an orphan can exist in production and why
 * this reset deletes children explicitly rather than trusting cascade. Turning
 * enforcement off for the fixture is what makes the D1 reality reproducible
 * here.
 */
function writeOrphan(db: DatabaseSync, sub: string): void {
  db.exec('PRAGMA foreign_keys = OFF')
  db.prepare(
    `INSERT INTO workout_sets
       (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
        exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
        result_kind_snapshot, load_mode_snapshot, per_side_snapshot, status,
        actual_result, updated_at)
     VALUES (?, '2025-01-01', 'monday', 'ghost', 0, 0, 'x', 'X', '1 × 1',
             'reps', 'kg', 0, 'completed', 1, 1)`,
  ).run(sub)
  db.exec('PRAGMA foreign_keys = ON')
}

/* ------------------------------------------------------------------ */
/* Seeding — one account with a full life, plus a bystander            */
/* ------------------------------------------------------------------ */

/** Activity + configuration for one account, on both sides of the new Day 1. */
function seedAccount(db: DatabaseSync, sub: string): void {
  // Two workouts: one long before the new Day 1, one after it. A FULL reset
  // takes both — that is the whole difference from Round 18's cutoff tool.
  for (const [date, session, kind] of [
    ['2026-09-07', 'monday', 'scheduled'],
    ['2026-10-20', 'tuesday', 'scheduled'],
    ['2026-09-09', 'extra', 'extra'],
  ] as const) {
    const snapshot = `snap-${sub}-${date}-${session}`
    db.prepare(
      `INSERT INTO workout_occurrences
         (google_sub, workout_date, session_id, snapshot_id, session_day_snapshot,
          session_focus_snapshot, session_intensity_snapshot, started_at, updated_at, kind)
       VALUES (?, ?, ?, ?, 'Monday', 'Back', 'HARD', 1, 2, ?)`,
    ).run(sub, date, session, snapshot, kind)

    db.prepare(
      `INSERT INTO workout_sets
         (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
          exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
          result_kind_snapshot, load_mode_snapshot, per_side_snapshot, status,
          actual_result, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, 'lat-pulldown', 'Lat Pulldown', '4 × 10–15',
               'reps', 'kg', 0, 'completed', 12, 2)`,
    ).run(sub, date, session, snapshot)

    db.prepare(
      `INSERT INTO workout_calibration
         (google_sub, workout_date, session_id, exercise_order, lane_fingerprint,
          feedback, observed_load_value, observed_load_unit, created_at, updated_at)
       VALUES (?, ?, ?, 0, 'lane', 'good', 20, 'kg', 1, 2)`,
    ).run(sub, date, session)

    db.prepare(
      `INSERT INTO workout_set_corrections
         (correction_id, google_sub, workout_date, session_id, exercise_order, set_index,
          corrected_at, before_load_mode, after_input_type, after_load_mode, after_result)
       VALUES (?, ?, ?, ?, 0, 0, 3, 'kg', 'weight_kg', 'kg', 11)`,
    ).run(`corr-${sub}-${date}-${session}`, sub, date, session)
  }

  // The other four activity domains, also on both sides of the new Day 1.
  for (const date of ['2026-09-01', '2026-10-30']) {
    db.prepare(
      `INSERT INTO body_weight_entries (google_sub, local_date, weight_tenths_kg, created_at, updated_at)
       VALUES (?, ?, 804, 1, 2)`,
    ).run(sub, date)
    db.prepare(
      `INSERT INTO today_completions (google_sub, occurrence_key, anchor_day, completed_at)
       VALUES (?, ?, ?, 2)`,
    ).run(sub, `${date}#gym-training`, date)
    db.prepare(
      `INSERT INTO training_flex (google_sub, local_date, kind, created_at, updated_at)
       VALUES (?, ?, 'recovery', 1, 2)`,
    ).run(sub, date)
    db.prepare(
      `INSERT INTO holiday_overrides (id, google_sub, start_date, end_date, created_at, updated_at, name, training_on)
       VALUES (?, ?, ?, ?, 1, 2, 'Trip', 0)`,
    ).run(`hol-${sub}-${date}`, sub, date, date)
    db.prepare(
      `INSERT INTO company_holiday_preferences (google_sub, holiday_date, training_on, updated_at)
       VALUES (?, ?, 1, 2)`,
    ).run(sub, date)
  }

  // Configuration and infrastructure that must survive untouched.
  db.prepare(
    `INSERT INTO account_settings (google_sub, foundation_start_date, created_at, updated_at)
     VALUES (?, '2026-08-31', 111, 222)`,
  ).run(sub)
  db.prepare(
    `INSERT INTO programme_revisions (google_sub, revision, write_token, updated_at)
     VALUES (?, 7, 'tok', 5)`,
  ).run(sub)
  db.prepare(
    `INSERT INTO programme_exercises (google_sub, exercise_id, name, archived, is_custom, created_at, updated_at)
     VALUES (?, 'lat-pulldown', 'Lat Pulldown', 0, 0, 1, 2)`,
  ).run(sub)
  db.prepare(
    `INSERT INTO programme_slots
       (google_sub, session_id, exercise_id, position, set_count, result_kind,
        target_min, target_max, per_side, equipment)
     VALUES (?, 'monday', 'lat-pulldown', 1, 4, 'reps', 10, 15, 0, 'BAND 20kg')`,
  ).run(sub)
  db.prepare(
    `INSERT INTO exercise_media (google_sub, exercise_id, media_type, media_url, media_alt, updated_at)
     VALUES (?, 'lat-pulldown', 'image', 'https://example.invalid/a.png', 'Demo', 2)`,
  ).run(sub)
  db.prepare(
    `INSERT INTO exercise_input_types (google_sub, exercise_id, input_type, created_at, updated_at)
     VALUES (?, 'lat-pulldown', 'resistance_band', 1, 2)`,
  ).run(sub)
  db.prepare(
    `INSERT INTO push_subscriptions
       (id, google_sub, endpoint, endpoint_hash, p256dh, auth, timezone, created_at, updated_at)
     VALUES (?, ?, 'https://push.invalid/x', ?, 'p', 'a', 'Asia/Singapore', 1, 2)`,
  ).run(`push-${sub}`, sub, sub.padEnd(64, '0').slice(0, 64))
  db.prepare(
    `INSERT INTO notification_deliveries
       (subscription_id, google_sub, trigger_minute, claimed_at, attempts, status)
     VALUES (?, ?, 100, 1, 1, 'sent')`,
  ).run(`push-${sub}`, sub)
  db.prepare(
    `INSERT INTO auth_sessions
       (session_hash, google_sub, email, trusted, created_at, last_seen_at, expires_at)
     VALUES (?, ?, 'a@b.c', 1, 1, 2, 9999)`,
  ).run(`sess-${sub}`, sub)
}

/**
 * Global rows, owned by nobody.
 *
 * Migration 0006 already seeds the company holiday calendar, so this only adds
 * an in-flight OAuth state — the row that proves a reset cannot disturb a login
 * that is halfway through.
 */
function seedGlobal(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO oauth_states (state_hash, nonce, code_verifier, created_at, expires_at)
     VALUES ('state-1', 'n', 'v', 1, 2)`,
  ).run()
}

/** However many company holidays the accepted migration chain seeds. */
function seededCompanyHolidays(db: DatabaseSync): number {
  return count(db, `SELECT COUNT(*) AS n FROM company_holidays`)
}

function seeded(): DatabaseSync {
  const db = migrated()
  seedGlobal(db)
  seedAccount(db, MINE)
  seedAccount(db, THEIRS)
  return db
}

const count = (db: DatabaseSync, sql: string, ...params: unknown[]) =>
  Number((db.prepare(sql).get(...(params as never[])) as { n: number }).n)

const rowsFor = (db: DatabaseSync, table: string, sub: string) =>
  count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE google_sub = ?`, sub)

/** Run the whole mutation the way the operator would: one command. */
function applyReset(db: DatabaseSync, t: Round25Target = target): void {
  db.exec(round25Transaction(t, NOW))
}

/* ------------------------------------------------------------------ */
/* 1. The contract itself                                              */
/* ------------------------------------------------------------------ */

describe('1. the reset contract', () => {
  it('names exactly the nine approved tables, children before parent', () => {
    expect([...ROUND25_RESET_TABLES]).toEqual([
      'workout_set_corrections',
      'workout_calibration',
      'workout_sets',
      'workout_occurrences',
      'body_weight_entries',
      'today_completions',
      'training_flex',
      'holiday_overrides',
      'company_holiday_preferences',
    ])
    // The three children carry a foreign key onto the occurrence. D1 does not
    // guarantee cascade fires, so each is deleted before its parent.
    const order = ROUND25_RESET_TABLES.indexOf.bind(ROUND25_RESET_TABLES)
    for (const child of ['workout_sets', 'workout_calibration', 'workout_set_corrections'] as const) {
      expect(order(child), child).toBeLessThan(order('workout_occurrences'))
    }
  })

  it('scopes EVERY delete to the account, with no other predicate', () => {
    const statements = round25ResetStatements(target)
    expect(statements).toHaveLength(ROUND25_RESET_TABLES.length)
    for (const statement of statements) {
      expect(statement.sql).toContain('google_sub = ?')
      expect(statement.params).toEqual([MINE])
      // A FULL reset: no date boundary. This is what makes it different from
      // Round 18's cutoff tool, and it is asserted rather than assumed.
      expect(statement.sql).not.toMatch(/workout_date|local_date|anchor_day|holiday_date|end_date/)
    }
  })

  it('never deletes from a preserved table', () => {
    const sql = round25Transaction(target, NOW)
    for (const table of ROUND25_PRESERVED_TABLES) {
      expect(sql, table).not.toMatch(new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, 'i'))
    }
    // account_settings is written, but never emptied.
    expect(sql).not.toMatch(/DELETE\s+FROM\s+account_settings\b/i)
  })

  it('touches account_settings only through the settings upsert, and only two columns', () => {
    const sql = round25Transaction(target, NOW)
    const settingsStatements = sql
      .split(';')
      .filter((s) => s.includes(ROUND25_SETTINGS_TABLE))
    expect(settingsStatements).toHaveLength(1)

    const [statement] = settingsStatements
    // Exactly the columns the Worker's own settings store writes.
    expect(statement).toMatch(/DO UPDATE SET foundation_start_date = excluded\.foundation_start_date/)
    expect(statement).toMatch(/updated_at\s*=\s*excluded\.updated_at/)
    // created_at is never rewritten: a reset must not move when the account
    // first chose a start date.
    expect(statement).not.toMatch(/SET[\s\S]*created_at\s*=/i)
  })

  it('refuses a missing account, an unsafe account key, or a missing date', () => {
    expect(parseRound25Target(undefined, NEW_DAY_1)).toEqual({ ok: false, field: 'google_sub' })
    expect(parseRound25Target('  ', NEW_DAY_1)).toEqual({ ok: false, field: 'google_sub' })
    expect(parseRound25Target("sub'; DROP TABLE workout_sets; --", NEW_DAY_1)).toEqual({
      ok: false,
      field: 'google_sub',
    })
    expect(parseRound25Target(MINE, undefined)).toEqual({ ok: false, field: 'foundation_start' })
    expect(parseRound25Target(MINE, '2026-02-30')).toEqual({ ok: false, field: 'foundation_start' })
    expect(parseRound25Target(MINE, NEW_DAY_1)).toEqual({ ok: true, value: target })
  })

  it('refuses to render a value it cannot embed safely', () => {
    expect(() =>
      renderStatement({ sql: 'DELETE FROM workout_sets WHERE google_sub = ?', params: ["a'b"] }),
    ).toThrow(/unsafe value/)
  })
})

/* ------------------------------------------------------------------ */
/* 2. What it empties                                                  */
/* ------------------------------------------------------------------ */

describe('2. every one of the nine tables is emptied for the target account', () => {
  it('leaves zero rows in all nine, on both sides of the new Day 1', () => {
    const db = seeded()
    for (const table of ROUND25_RESET_TABLES) {
      expect(rowsFor(db, table, MINE), `${table} before`).toBeGreaterThan(0)
    }

    applyReset(db)

    for (const table of ROUND25_RESET_TABLES) {
      expect(rowsFor(db, table, MINE), `${table} after`).toBe(0)
    }
  })

  it('removes history AFTER the new Day 1 too — this is not a cutoff reset', () => {
    const db = seeded()
    expect(
      count(db, `SELECT COUNT(*) AS n FROM workout_occurrences WHERE google_sub = ? AND workout_date >= ?`, MINE, NEW_DAY_1),
    ).toBeGreaterThan(0)

    applyReset(db)

    expect(rowsFor(db, 'workout_occurrences', MINE)).toBe(0)
  })

  it('removes Extra workouts as well as scheduled ones', () => {
    const db = seeded()
    expect(
      count(db, `SELECT COUNT(*) AS n FROM workout_occurrences WHERE google_sub = ? AND kind = 'extra'`, MINE),
    ).toBe(1)
    applyReset(db)
    expect(rowsFor(db, 'workout_occurrences', MINE)).toBe(0)
  })

  it('leaves no orphaned set, calibration or correction anywhere', () => {
    const db = seeded()
    applyReset(db)
    for (const statement of round25OrphanChecks()) {
      expect(count(db, statement.sql)).toBe(0)
    }
  })

  it('is idempotent — running it twice removes nothing further and re-states the same date', () => {
    const db = seeded()
    applyReset(db)
    const settled = ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, MINE))
    applyReset(db)
    expect(ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, MINE))).toEqual(settled)
    expect(
      (db.prepare(`SELECT foundation_start_date AS d FROM account_settings WHERE google_sub = ?`)
        .get(MINE) as { d: string }).d,
    ).toBe(NEW_DAY_1)
  })
})

/* ------------------------------------------------------------------ */
/* 3. What it must not touch                                           */
/* ------------------------------------------------------------------ */

describe('3. preserved domains are provably unchanged', () => {
  it('keeps programme, media, input types, push, auth and global holidays byte-identical', () => {
    const db = seeded()
    const read = () =>
      round25StableFingerprint(target).map((s) =>
        JSON.stringify(db.prepare(renderStatement(s)).get()),
      )

    const before = read()
    applyReset(db)
    expect(read()).toEqual(before)
  })

  it('keeps oauth_states, which has no account column to scope by', () => {
    const db = seeded()
    const before = count(db, `SELECT COUNT(*) AS n FROM oauth_states`)
    expect(before).toBe(1)
    applyReset(db)
    expect(count(db, `SELECT COUNT(*) AS n FROM oauth_states`)).toBe(before)
    // Structurally unreachable: the table is never named at all.
    expect(round25Transaction(target, NOW)).not.toMatch(/oauth_states/)
  })

  it('keeps the global company_holidays table, which belongs to no account', () => {
    const db = seeded()
    const before = seededCompanyHolidays(db)
    expect(before).toBeGreaterThan(0)
    applyReset(db)
    expect(seededCompanyHolidays(db)).toBe(before)
    // Structurally unreachable: an account-scoped statement cannot name a table
    // with no account column, and this one is never named at all.
    expect(round25Transaction(target, NOW)).not.toMatch(/company_holidays\b(?!_preferences)/)
  })

  it('leaves the signed-in session alone, so the reset does not sign the user out', () => {
    const db = seeded()
    applyReset(db)
    expect(rowsFor(db, 'auth_sessions', MINE)).toBe(1)
  })

  it('changes only foundation_start_date in account_settings — not created_at', () => {
    const db = seeded()
    const before = db
      .prepare(`SELECT * FROM account_settings WHERE google_sub = ?`)
      .get(MINE) as Record<string, unknown>

    applyReset(db)

    const after = db
      .prepare(`SELECT * FROM account_settings WHERE google_sub = ?`)
      .get(MINE) as Record<string, unknown>

    expect(after.foundation_start_date).toBe(NEW_DAY_1)
    expect(after.created_at).toBe(before.created_at)
    expect(after.google_sub).toBe(before.google_sub)
    // Every column except the two the contract allows is untouched.
    for (const key of Object.keys(before)) {
      if (key === 'foundation_start_date' || key === 'updated_at') continue
      expect(after[key], key).toEqual(before[key])
    }
  })

  it('creates the settings row when the account never saved one', () => {
    const db = migrated()
    seedGlobal(db)
    // No account_settings row at all — the state where the app falls back to
    // DEFAULT_FOUNDATION_START and would silently keep counting from it.
    db.exec(round25Transaction(target, NOW))
    const row = db
      .prepare(`SELECT foundation_start_date AS d, created_at AS c FROM account_settings WHERE google_sub = ?`)
      .get(MINE) as { d: string; c: number }
    expect(row.d).toBe(NEW_DAY_1)
    expect(row.c).toBe(NOW)
  })
})

/* ------------------------------------------------------------------ */
/* 4. One account cannot reach another                                 */
/* ------------------------------------------------------------------ */

describe('4. account isolation', () => {
  it('leaves every row of the other account exactly as it was', () => {
    const db = seeded()
    const before = ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, THEIRS))
    applyReset(db)
    expect(ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, THEIRS))).toEqual(before)
    expect(before.every((n) => n > 0)).toBe(true)
  })

  it('leaves the other account’s Foundation start date alone', () => {
    const db = seeded()
    applyReset(db)
    expect(
      (db.prepare(`SELECT foundation_start_date AS d FROM account_settings WHERE google_sub = ?`)
        .get(THEIRS) as { d: string }).d,
    ).toBe('2026-08-31')
  })

  it('reports the other account’s rows as unchanged through the isolation checks', () => {
    const db = seeded()
    const read = () =>
      round25IsolationChecks(target).map((s) => Number((db.prepare(renderStatement(s)).get() as { n: number }).n))
    const before = read()
    applyReset(db)
    expect(read()).toEqual(before)
  })
})

/* ------------------------------------------------------------------ */
/* 5. The operator path                                                */
/* ------------------------------------------------------------------ */

describe('5. the operator refuses unless every confirmation is present', () => {
  /** Drive the real operator against a real disposable database. */
  function operator(db: DatabaseSync) {
    return (sql: string) =>
      sql
        .split(';\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((statement) => {
          if (/^SELECT/i.test(statement)) return db.prepare(statement).all()
          db.exec(statement)
          return []
        })
  }

  const argv = (...extra: string[]) => [
    'node', 'round25-reset.mjs',
    '--account', MINE,
    '--foundation-start', NEW_DAY_1,
    ...extra,
  ]
  const EXECUTE = [
    '--execute',
    '--i-understand-this-deletes-all-activity',
    '--confirm-account', MINE,
    '--confirm-foundation-start', NEW_DAY_1,
  ]
  const silent = () => {}

  it('INVENTORY IS THE DEFAULT — no mode flag writes nothing at all', async () => {
    const db = seeded()
    const before = ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, MINE))

    const result = await runRound25Reset({ argv: argv(), exec: operator(db), log: silent, now: NOW })

    expect(result.ok).toBe(true)
    expect(result.executed).toBe(false)
    expect(result.attempts).toBe(0)
    expect(ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, MINE))).toEqual(before)
    // It still reported what it WOULD do.
    expect(result.before?.reset.every((n: number) => n > 0)).toBe(true)
  })

  it('refuses --execute without the understanding flag', async () => {
    const db = seeded()
    const result = await runRound25Reset({
      argv: argv('--execute', '--confirm-account', MINE, '--confirm-foundation-start', NEW_DAY_1),
      exec: operator(db), log: silent, now: NOW,
    })
    expect(result.ok).toBe(false)
    expect(result.executed).toBe(false)
    expect(result.reason).toMatch(/i-understand-this-deletes-all-activity/)
    expect(rowsFor(db, 'workout_occurrences', MINE)).toBeGreaterThan(0)
  })

  it('refuses a --confirm-account that does not match exactly', async () => {
    const db = seeded()
    const result = await runRound25Reset({
      argv: argv('--execute', '--i-understand-this-deletes-all-activity',
                 '--confirm-account', THEIRS, '--confirm-foundation-start', NEW_DAY_1),
      exec: operator(db), log: silent, now: NOW,
    })
    expect(result.ok).toBe(false)
    expect(result.executed).toBe(false)
    expect(rowsFor(db, 'workout_occurrences', MINE)).toBeGreaterThan(0)
    expect(rowsFor(db, 'workout_occurrences', THEIRS)).toBeGreaterThan(0)
  })

  it('refuses a --confirm-foundation-start that does not match exactly', async () => {
    const db = seeded()
    const result = await runRound25Reset({
      argv: argv('--execute', '--i-understand-this-deletes-all-activity',
                 '--confirm-account', MINE, '--confirm-foundation-start', '2026-10-06'),
      exec: operator(db), log: silent, now: NOW,
    })
    expect(result.ok).toBe(false)
    expect(result.executed).toBe(false)
    expect(rowsFor(db, 'workout_occurrences', MINE)).toBeGreaterThan(0)
  })

  it('refuses a missing account or a missing date before reading anything', async () => {
    const db = seeded()
    const noAccount = await runRound25Reset({
      argv: ['node', 'round25-reset.mjs', '--foundation-start', NEW_DAY_1],
      exec: operator(db), log: silent, now: NOW,
    })
    expect(noAccount.ok).toBe(false)
    expect(noAccount.before).toBeUndefined()
    expect(noAccount.attempts).toBe(0)

    const noDate = await runRound25Reset({
      argv: ['node', 'round25-reset.mjs', '--account', MINE],
      exec: operator(db), log: silent, now: NOW,
    })
    expect(noDate.ok).toBe(false)
    expect(noDate.reason).toMatch(/foundation-start/)
  })

  it('executes, and reports every acceptance condition as met', async () => {
    const db = seeded()
    const result = await runRound25Reset({
      argv: argv(...EXECUTE), exec: operator(db), log: silent, now: NOW,
    })

    expect(result.ok).toBe(true)
    expect(result.executed).toBe(true)
    expect(result.attempts).toBe(1)
    expect(result.outcome).toBe('COMMITTED')
    expect(result.accepted).toBe(true)
    expect(result.checks).toEqual({
      stablePreserved: true, isolated: true, noTargetOrphans: true, noNewOrphans: true,
    })
    expect(result.after?.reset).toEqual(ROUND25_RESET_TABLES.map(() => 0))
    expect(result.after?.foundation).toBe(`1#${NEW_DAY_1}`)
    expect(result.before?.stable).toEqual(result.after?.stable)
    expect(result.before?.others).toEqual(result.after?.others)
  })
})

/* ------------------------------------------------------------------ */
/* 5b. An unacknowledged mutation is never answered by sending it again */
/* ------------------------------------------------------------------ */

describe('5b. the ambiguous-outcome state machine', () => {
  /**
   * A transport that applies what it is given and then decides whether to
   * acknowledge it.
   *
   * `failAfterApplying` is the case that matters: D1 durably commits and the
   * acknowledgement is lost — a dropped connection, a killed Wrangler process,
   * a gateway timeout. The operator sees an error and MUST NOT conclude that
   * nothing happened.
   */
  function transport(
    db: DatabaseSync,
    options: {
      failMutation?: 'before-applying' | 'after-applying'
      failReads?: boolean
    } = {},
  ) {
    const state = { mutations: 0 }
    const exec = (sql: string) => {
      const isMutation = /^\s*DELETE|^\s*INSERT/i.test(sql)
      if (isMutation) {
        state.mutations += 1
        if (options.failMutation === 'before-applying') {
          throw new Error('transport died before the command was sent')
        }
      } else if (options.failReads) {
        throw new Error('transport cannot read')
      }
      const results = sql
        .split(';\n')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .map((statement) => {
          if (/^SELECT/i.test(statement)) return db.prepare(statement).all()
          db.exec(statement)
          return []
        })
      if (isMutation && options.failMutation === 'after-applying') {
        // Applied, and then the acknowledgement is lost.
        throw new Error('connection reset while awaiting acknowledgement')
      }
      return results
    }
    return { exec, state }
  }

  const argv = [
    'node', 'round25-reset.mjs',
    '--account', MINE,
    '--foundation-start', NEW_DAY_1,
    '--execute',
    '--i-understand-this-deletes-all-activity',
    '--confirm-account', MINE,
    '--confirm-foundation-start', NEW_DAY_1,
  ]
  const silent = () => {}

  it('A. applied but unacknowledged → COMMITTED, and the command was sent exactly once', async () => {
    const db = seeded()
    const { exec, state } = transport(db, { failMutation: 'after-applying' })

    const result = await runRound25Reset({ argv, exec, log: silent, now: NOW })

    // THE POINT. The transport failed, and the operator still worked out the truth.
    expect(result.transportError).toMatch(/connection reset/)
    expect(result.outcome).toBe('COMMITTED')
    expect(result.reconciled).toBe(true)
    expect(result.accepted).toBe(true)
    // THE OTHER POINT. Exactly one destructive send, counted by the operator
    // AND by the transport itself.
    expect(result.attempts).toBe(1)
    expect(state.mutations).toBe(1)
    // And the database really is reset.
    expect(ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, MINE))).toEqual(
      ROUND25_RESET_TABLES.map(() => 0),
    )
  })

  it('B. failed before applying anything → NOT COMMITTED, proven by reading', async () => {
    const db = seeded()
    const before = ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, MINE))
    const { exec, state } = transport(db, { failMutation: 'before-applying' })

    const result = await runRound25Reset({ argv, exec, log: silent, now: NOW })

    expect(result.outcome).toBe('NOT_COMMITTED')
    expect(result.reconciled).toBe(true)
    expect(result.accepted).toBe(false)
    expect(result.attempts).toBe(1)
    expect(state.mutations).toBe(1)
    // Nothing was touched, and that is a positive proof rather than a guess.
    expect(ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, MINE))).toEqual(before)
    // `ok` is true: the operator can safely investigate and try again.
    expect(result.ok).toBe(true)
  })

  it('C. mutation error AND reconciliation cannot read → AMBIGUOUS, and it stops', async () => {
    const db = seeded()
    // The mutation is applied and then unacknowledged, AND every read after it
    // fails. Nothing can be concluded — which is the outcome under test.
    const { exec, state } = transport(db, { failMutation: 'after-applying' })
    let mutated = false
    const flaky = (sql: string) => {
      if (/^\s*DELETE|^\s*INSERT/i.test(sql)) {
        try {
          return exec(sql)
        } finally {
          mutated = true
        }
      }
      if (mutated) throw new Error('transport cannot read')
      return exec(sql)
    }

    const result = await runRound25Reset({ argv, exec: flaky, log: silent, now: NOW })

    expect(result.outcome).toBe('AMBIGUOUS')
    expect(result.reconciled).toBe(false)
    expect(result.accepted).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.readError).toMatch(/cannot read/)
    // STILL exactly one destructive send. An unknown outcome is never answered
    // by sending it again.
    expect(result.attempts).toBe(1)
    expect(state.mutations).toBe(1)
  })

  it('D. no code path sends the destructive command twice, under any outcome', async () => {
    for (const failMutation of [undefined, 'before-applying', 'after-applying'] as const) {
      const db = seeded()
      const { exec, state } = transport(db, failMutation ? { failMutation } : {})
      const result = await runRound25Reset({ argv, exec, log: silent, now: NOW })
      expect(state.mutations, String(failMutation)).toBe(1)
      expect(result.attempts, String(failMutation)).toBe(1)
    }
    // Structural, not just behavioural: the transaction builder is CALLED on
    // exactly one line of the operator script.
    const callSites = operatorSource.match(/round25Transaction\(/g) ?? []
    expect(callSites).toHaveLength(1)
    // And there is no retry machinery anywhere near it.
    expect(operatorSource).not.toMatch(/for\s*\(.*attempt|while\s*\(.*retr|retry\(/i)
  })

  it('a partial state is AMBIGUOUS — neither the old state nor the intended one', async () => {
    const db = seeded()
    // A transport that applies only the first delete and then dies.
    const half = (sql: string) => {
      if (/^\s*DELETE/i.test(sql)) {
        const [first] = sql.split(';\n')
        db.exec(first)
        throw new Error('died midway')
      }
      return sql
        .split(';\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((statement) => db.prepare(statement).all())
    }

    const result = await runRound25Reset({ argv, exec: half, log: silent, now: NOW })

    expect(result.outcome).toBe('AMBIGUOUS')
    expect(result.reconciled).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* 5c. Stable vs operational, and orphans that are not ours            */
/* ------------------------------------------------------------------ */

describe('5c. proof semantics match what each table can actually do', () => {
  const argv = [
    'node', 'round25-reset.mjs',
    '--account', MINE,
    '--foundation-start', NEW_DAY_1,
    '--execute',
    '--i-understand-this-deletes-all-activity',
    '--confirm-account', MINE,
    '--confirm-foundation-start', NEW_DAY_1,
  ]
  const silent = () => {}

  /** A transport that lets the cron and a login run DURING the reset. */
  function busyTransport(db: DatabaseSync) {
    let sawMutation = false
    return (sql: string) => {
      const isMutation = /^\s*DELETE|^\s*INSERT/i.test(sql)
      const results = sql
        .split(';\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((statement) => {
          if (/^SELECT/i.test(statement)) return db.prepare(statement).all()
          db.exec(statement)
          return []
        })
      if (isMutation && !sawMutation) {
        sawMutation = true
        // The minute cron claims a delivery, a session's last_seen_at moves,
        // and somebody starts a login. All legitimate, all unrelated.
        db.prepare(
          `INSERT INTO notification_deliveries
             (subscription_id, google_sub, trigger_minute, claimed_at, attempts, status)
           VALUES (?, ?, 200, 9, 1, 'claimed')`,
        ).run(`push-${MINE}`, MINE)
        db.prepare(`UPDATE auth_sessions SET last_seen_at = 999 WHERE google_sub = ?`).run(MINE)
        db.prepare(
          `INSERT INTO oauth_states (state_hash, nonce, code_verifier, created_at, expires_at)
           VALUES ('state-live', 'n', 'v', 9, 10)`,
        ).run()
      }
      return results
    }
  }

  it('accepts the reset even though deliveries, sessions and oauth states moved during it', async () => {
    const db = seeded()
    const result = await runRound25Reset({
      argv, exec: busyTransport(db), log: silent, now: NOW,
    })

    // These DID change — that is the whole point of the fixture.
    expect(result.before?.operational).not.toEqual(result.after?.operational)
    // ...and the reset is still accepted, because none of them is evidence
    // about the reset.
    expect(result.outcome).toBe('COMMITTED')
    expect(result.accepted).toBe(true)
    expect(result.checks?.stablePreserved).toBe(true)
  })

  it('protects the operational tables STRUCTURALLY — the SQL never names them', () => {
    const sql = round25Transaction(target, NOW)
    for (const table of ROUND25_OPERATIONAL_TABLES) {
      expect(sql, table).not.toMatch(new RegExp(`\\b${table}\\b`))
    }
    // Stronger than before == after: it holds even while they are changing.
    expect(round25OperationalCounts(target)).toHaveLength(ROUND25_OPERATIONAL_TABLES.length)
  })

  it('still fails acceptance when STABLE content changes', async () => {
    const db = seeded()
    let sawMutation = false
    const meddling = (sql: string) => {
      const isMutation = /^\s*DELETE|^\s*INSERT/i.test(sql)
      const results = sql
        .split(';\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((statement) => {
          if (/^SELECT/i.test(statement)) return db.prepare(statement).all()
          db.exec(statement)
          return []
        })
      if (isMutation && !sawMutation) {
        sawMutation = true
        // Something rewrote the programme — a legal value, so this is a silent
        // corruption rather than a constraint error. That is NOT allowed to pass.
        db.prepare(`UPDATE programme_slots SET set_count = 5 WHERE google_sub = ?`).run(MINE)
      }
      return results
    }

    const result = await runRound25Reset({ argv, exec: meddling, log: silent, now: NOW })
    expect(result.outcome).toBe('COMMITTED')
    expect(result.checks?.stablePreserved).toBe(false)
    expect(result.accepted).toBe(false)
  })

  it('a pre-existing orphan belonging to ANOTHER account does not fail this reset', async () => {
    const db = seeded()
    // An orphan written long ago by something else, for the other account.
    writeOrphan(db, THEIRS)

    const globalBefore = round25OrphanChecks().map((s) => count(db, renderStatement(s)))
    expect(globalBefore[0]).toBeGreaterThan(0)

    const result = await runRound25Reset({
      argv,
      exec: (sql: string) =>
        sql.split(';\n').map((s) => s.trim()).filter(Boolean).map((statement) => {
          if (/^SELECT/i.test(statement)) return db.prepare(statement).all()
          db.exec(statement)
          return []
        }),
      log: silent,
      now: NOW,
    })

    // The orphan is still there, and it is still not ours.
    expect(result.checks?.noNewOrphans).toBe(true)
    expect(result.checks?.noTargetOrphans).toBe(true)
    expect(result.accepted).toBe(true)
    expect(
      round25TargetOrphanChecks(target).map((s) => count(db, renderStatement(s))),
    ).toEqual([0, 0, 0])
  })

  it('an orphan belonging to the TARGET account does fail acceptance', () => {
    const db = seeded()
    applyReset(db)
    // Something wrote a set with no occurrence, for the account just reset.
    writeOrphan(db, MINE)

    expect(
      round25TargetOrphanChecks(target).map((s) => count(db, renderStatement(s))),
    ).toEqual([1, 0, 0])
  })
})

/* ------------------------------------------------------------------ */
/* 6. Derived truth follows the surviving rows                         */
/* ------------------------------------------------------------------ */

describe('6. nothing derived is written, and nothing derived survives', () => {
  it('leaves no completed set for a personal best or performance read to find', () => {
    const db = seeded()
    applyReset(db)
    expect(
      count(db, `SELECT COUNT(*) AS n FROM workout_sets WHERE google_sub = ? AND status = 'completed'`, MINE),
    ).toBe(0)
  })

  it('leaves no calibration evidence for progression to derive a lane from', () => {
    const db = seeded()
    applyReset(db)
    expect(rowsFor(db, 'workout_calibration', MINE)).toBe(0)
  })

  it('inventories all nine tables before anything is deleted', () => {
    const db = seeded()
    const inventory = round25Inventory(target)
    expect(inventory).toHaveLength(9)
    const before = inventory.map((s) => count(db, renderStatement(s)))
    expect(before.every((n) => n > 0)).toBe(true)
    // Reading is not writing.
    expect(ROUND25_RESET_TABLES.map((t) => rowsFor(db, t, MINE)).every((n) => n > 0)).toBe(true)
  })

  it('reads the stored Foundation date back for the after-proof', () => {
    const db = seeded()
    applyReset(db)
    const row = db.prepare(renderStatement(round25FoundationCheck(target))).get() as {
      n: number
      v: string
    }
    expect(row).toEqual({ n: 1, v: NEW_DAY_1 })
  })

  it('builds the Foundation statement with the approved date and nothing else', () => {
    const statement = round25FoundationStatement(target, NOW)
    expect(statement.params).toEqual([MINE, NEW_DAY_1, NOW, NOW])
  })
})
