import { DatabaseSync } from 'node:sqlite'

import { beforeEach, describe, expect, it } from 'vitest'

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

import { runFreshStart } from '../../scripts/fresh-start.mjs'

/**
 * Round 18 Correction 1 — the OPERATOR PATH, executed.
 *
 * WHAT MAKES THIS DIFFERENT FROM freshStart.test.ts.
 *
 * That file proves the generated SQL is right. It cannot prove the SCRIPT is
 * right, and the script was not: it passed `--param` to `wrangler d1 execute`,
 * which has no such flag, so it could never have executed a single statement.
 * A test that only exercised the pure module stayed green through that. So this
 * file drives the real `runFreshStart` — its argument parsing, its confirmation
 * gates, its ordering and its atomic boundary — and substitutes only the
 * transport.
 *
 * THE STAND-IN IS D1-EQUIVALENT, deliberately. Two behaviours were MEASURED
 * against a local D1 and are reproduced here exactly:
 *
 *   - a multi-statement command is ATOMIC: if any statement fails, none of them
 *     took effect
 *   - each statement in the command yields its own result set, in order
 *
 * The destructive phase is one such command, so "the command" and "the
 * transaction" are the same thing — which is what makes a half-reset impossible.
 */

const CHAIN = [
  migration0001, migration0002, migration0003, migration0004, migration0005, migration0006,
  migration0007, migration0008, migration0009, migration0010, migration0011, migration0012,
  migration0013, migration0014,
]

const CUTOFF = '2026-09-01'
const MINE = 'sub-mine'
const THEIRS = 'sub-theirs'

/**
 * The inventory, in the order FRESH_START_INVENTORY_LABELS declares it:
 * occurrences before / kept, sets before / kept, calibration before / kept.
 */
type Inventory = [number, number, number, number, number, number]

let db: DatabaseSync
/** Every command the script sent, in order. */
let commands: string[]

function addOccurrence(
  target: DatabaseSync,
  googleSub: string,
  date: string,
  sessionId: string,
  kind: 'scheduled' | 'extra' = 'scheduled',
) {
  const token = `${googleSub}-${date}-${sessionId}`
  target.prepare(
    `INSERT INTO workout_occurrences
       (google_sub, workout_date, session_id, snapshot_id, kind, source_session_id,
        session_day_snapshot, session_focus_snapshot, session_intensity_snapshot,
        started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    googleSub, date, sessionId, token, kind, kind === 'extra' ? 'monday' : null,
    'Monday', 'Back Width + Biceps', 'HARD', 1, 1,
  )

  target.prepare(
    `INSERT INTO workout_sets
       (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
        exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
        equipment_snapshot, result_kind_snapshot, load_mode_snapshot, per_side_snapshot,
        status, actual_load_value, actual_load_unit, actual_result, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 'reps', 'kg', 0, 'completed', 60, 'kg', 15, 1)`,
  ).run(
    googleSub, date, sessionId, token,
    'lat-pulldown', 'Lat Pulldown', '4 x 10-15', 'BAND 20kg',
  )

  target.prepare(
    `INSERT INTO workout_calibration
       (google_sub, workout_date, session_id, exercise_order, lane_fingerprint, feedback,
        observed_load_value, observed_load_unit, chosen_load_value, chosen_load_unit,
        created_at, updated_at)
     VALUES (?, ?, ?, 0, 'fp', 'good', 60, 'kg', NULL, NULL, 1, 1)`,
  ).run(googleSub, date, sessionId)
}

/** Row count for one account, optionally narrowed by a date comparison. */
function rows(table: string, googleSub: string, dateClause = ''): number {
  const sql = `SELECT COUNT(*) AS n FROM ${table} WHERE google_sub = ?${dateClause}`
  return Number((db.prepare(sql).get(googleSub) as { n: number }).n)
}

const BEFORE_CUTOFF = ` AND workout_date < '2026-09-01'`
const ON_CUTOFF = ` AND workout_date = '2026-09-01'`

/**
 * A D1-equivalent executor: one command in, one result set per statement out,
 * all-or-nothing.
 *
 * `failOn` injects a failure at a chosen statement, which is how the half-reset
 * scenario is reproduced — the failure lands BETWEEN deletes that used to be
 * separate invocations.
 */
function d1LikeExec(failOn?: RegExp) {
  return async (sql: string) => {
    commands.push(sql)
    const statements = sql
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)

    const results: unknown[][] = []
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const statement of statements) {
        if (failOn?.test(statement)) throw new Error('injected failure')
        if (/^SELECT/i.test(statement)) {
          results.push(db.prepare(statement).all() as unknown[])
        } else {
          db.prepare(statement).run()
          results.push([])
        }
      }
      db.exec('COMMIT')
    } catch (error) {
      // Exactly what D1 does: the whole command took no effect.
      db.exec('ROLLBACK')
      throw error
    }
    return results
  }
}

const silent = () => {}

function argv(...extra: string[]) {
  return ['node', 'fresh-start.mjs', '--account', MINE, '--cutoff', CUTOFF, ...extra]
}

const CONFIRMED = [
  '--execute',
  '--i-understand-this-deletes-history',
  '--confirm-account',
  MINE,
]

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  for (const file of CHAIN) db.exec(file)
  commands = []

  // My history: three occurrences before the cutoff — including one Extra — and
  // one ON the cutoff, which is Day 1 of the new Foundation and must survive.
  addOccurrence(db, MINE, '2026-08-20', 'thursday')
  addOccurrence(db, MINE, '2026-08-21', 'friday')
  addOccurrence(db, MINE, '2026-08-21', 'extra', 'extra')
  addOccurrence(db, MINE, CUTOFF, 'tuesday')

  // Somebody else's history, entirely before the cutoff.
  addOccurrence(db, THEIRS, '2026-08-20', 'thursday')
})

/* ------------------------------------------------------------------ */
/* Inventory is the default                                            */
/* ------------------------------------------------------------------ */

describe('inventory', () => {
  it('is what a bare invocation does, and it writes nothing', async () => {
    const result = await runFreshStart({ argv: argv(), exec: d1LikeExec(), log: silent })

    expect(result.ok).toBe(true)
    expect(result.executed).toBe(false)
    // Three occurrences before the cutoff and one on it, each with its own set
    // and calibration row.
    expect(result.before as Inventory).toEqual([3, 1, 3, 1, 3, 1])

    expect(rows('workout_occurrences', MINE)).toBe(4)
    expect(commands.every((sql) => !/DELETE/i.test(sql))).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* A successful reset                                                  */
/* ------------------------------------------------------------------ */

describe('a confirmed execution', () => {
  it('removes the whole pre-cutoff history, scheduled and Extra alike', async () => {
    const result = await runFreshStart({
      argv: argv(...CONFIRMED),
      exec: d1LikeExec(),
      log: silent,
    })

    expect(result.ok).toBe(true)
    expect(result.executed).toBe(true)

    // Nothing of mine before the cutoff, in any of the three tables.
    expect(rows('workout_occurrences', MINE, BEFORE_CUTOFF)).toBe(0)
    expect(rows('workout_sets', MINE, BEFORE_CUTOFF)).toBe(0)
    expect(rows('workout_calibration', MINE, BEFORE_CUTOFF)).toBe(0)

    // The cutoff day itself survives — the boundary is strict, never <=.
    expect(rows('workout_occurrences', MINE, ON_CUTOFF)).toBe(1)
    expect(rows('workout_sets', MINE, ON_CUTOFF)).toBe(1)

    // Another account is untouched.
    expect(rows('workout_occurrences', THEIRS)).toBe(1)
    expect(rows('workout_sets', THEIRS)).toBe(1)
    expect(rows('workout_calibration', THEIRS)).toBe(1)

    // The after-proof the script itself reports: nothing before the cutoff
    // anywhere, everything on it intact, and no orphans.
    expect(result.after as Inventory).toEqual([0, 1, 0, 1, 0, 1])
    // Three checks now: sets, calibration, and Round 21's correction audit.
    expect(result.orphans).toEqual([0, 0, 0])
  })

  it('sends the destructive phase as exactly ONE command', async () => {
    await runFreshStart({ argv: argv(...CONFIRMED), exec: d1LikeExec(), log: silent })

    const destructive = commands.filter((sql) => /DELETE/i.test(sql))
    // One command, not three invocations — the command IS the boundary.
    expect(destructive).toHaveLength(1)

    // Children before parents, in dependency order, inside that one command.
    const [sql] = destructive
    expect(sql.indexOf('workout_calibration')).toBeLessThan(sql.indexOf('workout_sets'))
    expect(sql.indexOf('workout_sets')).toBeLessThan(sql.indexOf('workout_occurrences'))

    // Values are rendered as literals, because the CLI has no parameter binding.
    expect(sql).not.toContain('?')
    expect(sql).toContain(MINE)
    expect(sql).toContain(CUTOFF)
  })
})

/* ------------------------------------------------------------------ */
/* The half-reset that used to be possible                             */
/* ------------------------------------------------------------------ */

describe('an injected failure', () => {
  it('cannot leave the account half reset', async () => {
    // The failure lands on the LAST delete — precisely where the old script,
    // running three separate invocations, would already have destroyed the sets
    // and the calibration and then stopped.
    await expect(
      runFreshStart({
        argv: argv(...CONFIRMED),
        exec: d1LikeExec(/DELETE FROM workout_occurrences/i),
        log: silent,
      }),
    ).rejects.toThrow(/injected failure/)

    // ALL of it is still there. Not some of it.
    expect(rows('workout_occurrences', MINE)).toBe(4)
    expect(rows('workout_sets', MINE)).toBe(4)
    expect(rows('workout_calibration', MINE)).toBe(4)

    // And no orphan was created, because nothing was removed at all.
    const orphanSets = db
      .prepare(
        `SELECT COUNT(*) AS n FROM workout_sets s
          WHERE NOT EXISTS (
            SELECT 1 FROM workout_occurrences o
             WHERE o.google_sub = s.google_sub
               AND o.workout_date = s.workout_date
               AND o.session_id = s.session_id)`,
      )
      .get() as { n: number }
    expect(Number(orphanSets.n)).toBe(0)
  })

  it('is equally all-or-nothing when the failure lands on the first delete', async () => {
    await expect(
      runFreshStart({
        argv: argv(...CONFIRMED),
        exec: d1LikeExec(/DELETE FROM workout_calibration/i),
        log: silent,
      }),
    ).rejects.toThrow(/injected failure/)

    expect(rows('workout_occurrences', MINE)).toBe(4)
    expect(rows('workout_sets', MINE)).toBe(4)
    expect(rows('workout_calibration', MINE)).toBe(4)
  })
})

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

describe('refusals write nothing', () => {
  async function refused(args: string[]) {
    const result = await runFreshStart({ argv: args, exec: d1LikeExec(), log: silent })
    expect(result.ok).toBe(false)
    expect(result.executed).toBe(false)
    // Whatever the reason, the data is intact and no DELETE was ever sent.
    expect(rows('workout_occurrences', MINE)).toBe(4)
    expect(rows('workout_sets', MINE)).toBe(4)
    expect(rows('workout_calibration', MINE)).toBe(4)
    expect(commands.every((sql) => !/DELETE/i.test(sql))).toBe(true)
    return result
  }

  it('refuses --execute without the acknowledgement flag', async () => {
    const result = await refused(argv('--execute', '--confirm-account', MINE))
    expect(result.reason).toMatch(/i-understand-this-deletes-history/)
  })

  it('refuses a missing --confirm-account', async () => {
    const result = await refused(argv('--execute', '--i-understand-this-deletes-history'))
    expect(result.reason).toMatch(/confirm-account/)
  })

  it('refuses a --confirm-account naming a DIFFERENT account', async () => {
    const result = await refused(
      argv('--execute', '--i-understand-this-deletes-history', '--confirm-account', THEIRS),
    )
    expect(result.reason).toMatch(/confirm-account/)
  })

  it('refuses a missing account entirely, rather than inferring one', async () => {
    const result = await refused([
      'node', 'fresh-start.mjs', '--cutoff', CUTOFF,
      '--execute', '--i-understand-this-deletes-history',
    ])
    expect(result.reason).toMatch(/--account is required/)
  })

  it('refuses a cutoff that is not a real date', async () => {
    const result = await refused([
      'node', 'fresh-start.mjs', '--account', MINE, '--cutoff', '2026-02-30',
    ])
    expect(result.reason).toMatch(/--cutoff is required/)
  })

  it('refuses an account key that could not be embedded safely', async () => {
    // No parameter binding is available, so a key carrying SQL syntax is
    // rejected at the boundary instead of escaped and hoped for.
    const injection = [String.fromCharCode(39), '; DROP TABLE workout_sets;--'].join('')
    const result = await refused([
      'node', 'fresh-start.mjs', '--cutoff', CUTOFF, '--account', `sub${injection}`,
    ])
    expect(result.reason).toMatch(/--account is required/)
    // The table it named is still there.
    expect(rows('workout_sets', MINE)).toBe(4)
  })
})

/* ------------------------------------------------------------------ */
/* Aiming at a different account                                       */
/* ------------------------------------------------------------------ */

describe('the target account is the only one affected', () => {
  it('resets THEIRS without touching MINE', async () => {
    const result = await runFreshStart({
      argv: [
        'node', 'fresh-start.mjs', '--account', THEIRS, '--cutoff', CUTOFF,
        '--execute', '--i-understand-this-deletes-history', '--confirm-account', THEIRS,
      ],
      exec: d1LikeExec(),
      log: silent,
    })

    expect(result.executed).toBe(true)
    expect(rows('workout_occurrences', THEIRS)).toBe(0)
    // Mine is entirely untouched, including the rows before the same cutoff.
    expect(rows('workout_occurrences', MINE)).toBe(4)
    expect(rows('workout_sets', MINE)).toBe(4)
    expect(rows('workout_calibration', MINE)).toBe(4)
  })
})
