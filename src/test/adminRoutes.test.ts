/*
 * ADMIN LITE SPIKE — the admin API, against REAL SQLite.
 *
 * The whole accepted migration chain is executed and the REAL handler, the REAL
 * session algorithm, the REAL settings store and the REAL read-only queries all
 * run against it. That matters more here than almost anywhere else in this
 * codebase, because the claims under test are security claims and refusal
 * claims: a fake that pattern-matched the statements would only be asserting
 * that the fake understood them.
 *
 * `node:sqlite` needs Node, not a DOM.
 *
 * @vitest-environment node
 */
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
import migration0015 from '../../migrations/0015_programme_builder.sql?raw'

import accessSource from '../../worker/admin/access.ts?raw'
import readerSource from '../../worker/admin/d1Store.ts?raw'
import healthSource from '../../worker/admin/health.ts?raw'
import routesSource from '../../worker/admin/routes.ts?raw'

import { handleAdminRequest } from '../../worker/admin/routes'
import { isAdminSub, parseAdminSubs } from '../../worker/admin/access'
import { classifyCron, CRON_FRESH_MS } from '../../worker/admin/health'
import { ADMIN_ACTIVITY_TABLES } from '../../worker/admin/d1Store'
import type { Env } from '../../worker/auth/config'
import { createD1SessionStore } from '../../worker/auth/d1Stores'
import { createSession } from '../../worker/auth/session'
import { ROUND25_RESET_TABLES } from '@shared/round25Reset'
import { parseAdminOverview } from '@shared/admin'

import { createSqliteD1, type D1DatabaseLike, type D1StatementLike, type SqliteD1 } from './sqliteD1'

const CHAIN = [
  migration0001, migration0002, migration0003, migration0004, migration0005,
  migration0006, migration0007, migration0008, migration0009, migration0010,
  migration0011, migration0012, migration0013, migration0014, migration0015,
]

const ORIGIN = 'https://vshapev2.nkmwei.de'
const OWNER = 'sub-owner'
const OTHER = 'sub-other'
const NOW = 1_800_000_000_000

/** A VAPID trio shaped well enough for `readVapidConfig` to accept it. */
const VAPID = {
  VAPID_PUBLIC_KEY: 'A'.repeat(86),
  VAPID_PRIVATE_KEY: 'B'.repeat(43),
  VAPID_SUBJECT: 'mailto:owner@example.invalid',
}

let sqlite: SqliteD1

function env(overrides: Partial<Env> = {}, db: D1DatabaseLike = sqlite.db): Env {
  return {
    DB: db as unknown as D1Database,
    ASSETS: {} as Fetcher,
    APP_ORIGIN: ORIGIN,
    ADMIN_GOOGLE_SUBS: OWNER,
    ...overrides,
  }
}

async function tokenFor(sub: string): Promise<string> {
  const { token } = await createSession(
    createD1SessionStore(sqlite.db as unknown as D1Database),
    { googleSub: sub, email: `${sub}@example.invalid`, trusted: true },
  )
  return token
}

type CallOptions = {
  token?: string
  method?: string
  origin?: string
  body?: unknown
  env?: Env
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.token) headers.Cookie = `vshape_session=${options.token}`
  if (options.origin) headers.Origin = options.origin
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
  if (payload !== undefined) headers['Content-Type'] = 'application/json'

  const response = await handleAdminRequest(
    new Request(`${ORIGIN}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: payload,
    }),
    options.env ?? env(),
  )
  if (!response) throw new Error('handler did not claim the request')
  return response
}

async function overview(token: string, e?: Env) {
  const response = await call('/api/admin/overview', { token, env: e })
  return { status: response.status, body: await response.json() as Record<string, never> }
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

const raw = () => sqlite.raw

/**
 * One workout, its sets, its calibration and its correction, plus the four
 * other activity domains — for whichever account is named.
 *
 * Both accounts get the SAME shape, which is what makes the account-scope test
 * meaningful: if a query lost its `WHERE google_sub = ?` the counts would
 * double rather than merely change.
 */
function seedActivity(sub: string, dates: string[]): void {
  for (const date of dates) {
    const snapshot = `snap-${sub}-${date}`
    raw()
      .prepare(
        `INSERT INTO workout_occurrences
           (google_sub, workout_date, session_id, snapshot_id, session_day_snapshot,
            session_focus_snapshot, session_intensity_snapshot, started_at, updated_at, kind)
         VALUES (?, ?, 'monday', ?, 'Monday', 'Back', 'HARD', 1, 2, 'scheduled')`,
      )
      .run(sub, date, snapshot)
    raw()
      .prepare(
        `INSERT INTO workout_sets
           (google_sub, workout_date, session_id, snapshot_id, exercise_order, set_index,
            exercise_id_snapshot, exercise_name_snapshot, prescription_snapshot,
            result_kind_snapshot, load_mode_snapshot, per_side_snapshot, status,
            actual_result, updated_at)
         VALUES (?, ?, 'monday', ?, 0, 0, 'lat-pulldown', 'Lat Pulldown', '4 × 10–15',
                 'reps', 'kg', 0, 'completed', 12, 2)`,
      )
      .run(sub, date, snapshot)
    raw()
      .prepare(
        `INSERT INTO workout_set_corrections
           (correction_id, google_sub, workout_date, session_id, exercise_order, set_index,
            corrected_at, before_load_mode, after_input_type, after_load_mode, after_result)
         VALUES (?, ?, ?, 'monday', 0, 0, 3, 'kg', 'weight_kg', 'kg', 11)`,
      )
      .run(`corr-${sub}-${date}`, sub, date)
    raw()
      .prepare(
        `INSERT INTO body_weight_entries (google_sub, local_date, weight_tenths_kg, created_at, updated_at)
         VALUES (?, ?, 804, 1, 2)`,
      )
      .run(sub, date)
    raw()
      .prepare(
        `INSERT INTO today_completions (google_sub, occurrence_key, anchor_day, completed_at)
         VALUES (?, ?, ?, 2)`,
      )
      .run(sub, `${date}#gym-training`, date)
    raw()
      .prepare(
        `INSERT INTO training_flex (google_sub, local_date, kind, created_at, updated_at)
         VALUES (?, ?, 'recovery', 1, 2)`,
      )
      .run(sub, date)
  }
}

function seedSettings(sub: string, date: string | null, createdAt: number): void {
  raw()
    .prepare(
      `INSERT INTO account_settings (google_sub, foundation_start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(sub, date, createdAt, createdAt)
}

function seedPush(sub: string): void {
  raw()
    .prepare(
      `INSERT INTO push_subscriptions
         (id, google_sub, endpoint, endpoint_hash, p256dh, auth, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'p', 'a', 'Asia/Singapore', 1, 2)`,
    )
    .run(`push-${sub}`, sub, `https://push.invalid/${sub}`, sub.padEnd(64, '0').slice(0, 64))
}

function seedDelivery(sub: string, claimedAt: number): void {
  raw()
    .prepare(
      `INSERT INTO notification_deliveries
         (subscription_id, google_sub, trigger_minute, claimed_at, attempts, status)
       VALUES (?, ?, ?, ?, 1, 'sent')`,
    )
    .run(`push-${sub}`, sub, Math.floor(claimedAt / 60_000), claimedAt)
}

const count = (sql: string, ...params: unknown[]) =>
  Number((raw().prepare(sql).get(...(params as never[])) as { n: number }).n)

const rowsFor = (table: string, sub: string) =>
  count(`SELECT COUNT(*) AS n FROM ${table} WHERE google_sub = ?`, sub)

/** Every activity count, for one account, straight from the database. */
function activitySnapshot(sub: string): number[] {
  return ADMIN_ACTIVITY_TABLES.map(({ table }) => rowsFor(table, sub))
}

/**
 * A database whose matching statements throw.
 *
 * Used to prove the per-reading fail-closed rule: one unreadable table must
 * cost that one metric its answer, and nothing else.
 */
function breakSql(db: D1DatabaseLike, matcher: RegExp): D1DatabaseLike {
  const broken: D1StatementLike = {
    bind: () => broken,
    first: async () => {
      throw new Error('no such table')
    },
    all: async () => {
      throw new Error('no such table')
    },
    run: async () => {
      throw new Error('no such table')
    },
    __exec: () => {
      throw new Error('no such table')
    },
  }
  return {
    prepare: (sql) => (matcher.test(sql) ? broken : db.prepare(sql)),
    batch: (statements) => db.batch(statements),
  }
}

/** Source with comments removed, so a prose mention cannot pass for code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

beforeEach(() => {
  sqlite = createSqliteD1(CHAIN)
})

/* ================================================================== */
/* 1. Authorisation                                                    */
/* ================================================================== */

describe('1. admin authorisation is server-side, and closed by default', () => {
  it('A. refuses an unauthenticated caller with 401', async () => {
    const response = await call('/api/admin/overview')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'unauthenticated' })
  })

  it('B. refuses an authenticated NON-ADMIN with 403 and reveals nothing', async () => {
    const token = await tokenFor(OTHER)
    const { status, body } = await overview(token)

    expect(status).toBe(403)
    expect(body).toEqual({ error: 'forbidden' })
    // Anti-vacuity: not merely "the status is 403", but "no fact leaked".
    const text = JSON.stringify(body)
    expect(text).not.toContain('system')
    expect(text).not.toContain('activity')
    expect(text).not.toContain(OWNER)
  })

  it('C. admits an account on the allowlist', async () => {
    const token = await tokenFor(OWNER)
    const { status, body } = await overview(token)
    expect(status).toBe(200)
    expect(parseAdminOverview(body).ok).toBe(true)
  })

  it('D. an UNCONFIGURED allowlist admits nobody, including the owner', async () => {
    const token = await tokenFor(OWNER)
    for (const value of [undefined, '', '   ', ',', ' , , ']) {
      const { status } = await overview(token, env({ ADMIN_GOOGLE_SUBS: value }))
      expect(status).toBe(403)
    }
  })

  it('E. refuses near-miss subjects — no prefix, suffix or case slippage', async () => {
    for (const wrong of ['sub-owne', 'sub-owner2', 'SUB-OWNER', ' sub-owner', 'sub owner']) {
      const token = await tokenFor(wrong)
      const { status } = await overview(token)
      expect(status).toBe(403)
    }
  })

  it('F. does not reuse the sign-in allowlist — an ordinary user is not an admin', async () => {
    const token = await tokenFor(OTHER)
    const { status } = await overview(
      token,
      // Every signed-in account is on ALLOWED_GOOGLE_EMAILS by definition.
      env({ ALLOWED_GOOGLE_EMAILS: `${OTHER}@example.invalid,${OWNER}@example.invalid` }),
    )
    expect(status).toBe(403)
  })

  it('G. answers an unknown /api/admin path to a non-admin with 403, not 404', async () => {
    const token = await tokenFor(OTHER)
    // Probing must not be able to map the surface: every path answers the same.
    for (const path of ['/api/admin/reset', '/api/admin/', '/api/admin/anything']) {
      const response = await call(path, { token })
      expect(response.status).toBe(403)
    }
  })

  it('H. a non-admin write changes nothing', async () => {
    seedSettings(OWNER, '2026-08-31', 111)
    const token = await tokenFor(OTHER)

    const response = await call('/api/admin/foundation-start', {
      token,
      method: 'PUT',
      origin: ORIGIN,
      body: { foundationStartDate: '2026-09-14', confirm: true },
    })

    expect(response.status).toBe(403)
    expect(rowsFor('account_settings', OTHER)).toBe(0)
    expect(
      raw().prepare('SELECT foundation_start_date AS d FROM account_settings WHERE google_sub = ?')
        .get(OWNER),
    ).toEqual({ d: '2026-08-31' })
  })

  it('I. the allowlist parser drops blanks and never matches an empty subject', () => {
    expect(parseAdminSubs(undefined)).toEqual([])
    expect(parseAdminSubs('  ')).toEqual([])
    expect(parseAdminSubs(' a , ,b ')).toEqual(['a', 'b'])
    expect(isAdminSub('', parseAdminSubs(''))).toBe(false)
    expect(isAdminSub('', parseAdminSubs('a'))).toBe(false)
    expect(isAdminSub('a', parseAdminSubs('a,b'))).toBe(true)
  })

  it('J. the decision reads the session subject and NOTHING a client can set', () => {
    const code = stripComments(routesSource)
    // The account key comes from `requireAccount` and is passed straight to the
    // allowlist check. No body, query, or header is consulted.
    expect(code).toMatch(/isAdminAccount\(account\.googleSub, env\)/)
    expect(code).not.toMatch(/searchParams\.get/)
    expect(code).not.toMatch(/headers\.get\(\s*['"](?!Cookie)/i)
    expect(stripComments(accessSource)).not.toMatch(/localStorage|sessionStorage/)
  })
})

/* ================================================================== */
/* 2. Health truth, and Unknown when it cannot be proven               */
/* ================================================================== */

describe('2. health is proven or reported Unknown', () => {
  it('A. the scheduler is a WARNING when push keys are absent — a provable fault', () => {
    expect(
      classifyCron({ vapidConfigured: false, sweep: { readable: true, at: NOW }, now: NOW }),
    ).toMatchObject({ status: 'warning', reason: 'vapid_unconfigured' })
  })

  it('B. an empty delivery ledger is UNKNOWN, never healthy and never an error', () => {
    expect(
      classifyCron({ vapidConfigured: true, sweep: { readable: true, at: null }, now: NOW }),
    ).toMatchObject({ status: 'unknown', reason: 'no_observed_sweep', lastSweepAt: null })
  })

  it('C. a RECENT claim is evidence the sweep ran', () => {
    expect(
      classifyCron({
        vapidConfigured: true,
        sweep: { readable: true, at: NOW - 60_000 },
        now: NOW,
      }),
    ).toMatchObject({ status: 'healthy', reason: 'observed_sweep' })
  })

  it('D. an OLD claim proves nothing, so it is Unknown rather than healthy', () => {
    expect(
      classifyCron({
        vapidConfigured: true,
        sweep: { readable: true, at: NOW - CRON_FRESH_MS - 1 },
        now: NOW,
      }),
    ).toMatchObject({ status: 'unknown', reason: 'stale_observation' })
  })

  it('E. a claim dated in the FUTURE is a clock disagreement, not a healthy sweep', () => {
    expect(
      classifyCron({
        vapidConfigured: true,
        sweep: { readable: true, at: NOW + 60_000 },
        now: NOW,
      }),
    ).toMatchObject({ status: 'unknown', reason: 'stale_observation' })
  })

  it('F. an unreadable ledger is Unknown, and reports no timestamp', () => {
    expect(
      classifyCron({ vapidConfigured: true, sweep: { readable: false }, now: NOW }),
    ).toMatchObject({ status: 'unknown', reason: 'unreadable', lastSweepAt: null })
  })

  it('G. end to end: a fresh claim reads healthy, and no claim reads Unknown', async () => {
    seedPush(OWNER)
    const token = await tokenFor(OWNER)

    const quiet = await overview(token, env(VAPID))
    expect(quiet.body).toMatchObject({
      system: { cron: 'unknown', cronReason: 'no_observed_sweep', cronLastSweepAt: null },
    })

    seedDelivery(OWNER, Date.now() - 30_000)
    const live = await overview(token, env(VAPID))
    expect(live.body).toMatchObject({ system: { cron: 'healthy', cronReason: 'observed_sweep' } })
  })

  it('H. ANOTHER account’s delivery is not evidence about mine', async () => {
    seedPush(OTHER)
    seedDelivery(OTHER, Date.now() - 30_000)
    const token = await tokenFor(OWNER)

    const { body } = await overview(token, env(VAPID))
    expect(body).toMatchObject({ system: { cron: 'unknown', cronReason: 'no_observed_sweep' } })
  })

  it('I. D1 reads as an ERROR when a trivial read fails, and healthy when it works', async () => {
    const token = await tokenFor(OWNER)

    const ok = await overview(token)
    expect(ok.body).toMatchObject({ system: { d1: 'healthy' } })

    const broken = await overview(token, env({}, breakSql(sqlite.db, /SELECT 1 AS n/)))
    expect(broken.body).toMatchObject({ system: { d1: 'error' } })
  })

  it('J. the build SHA is Unknown unless the deployment supplies one', async () => {
    const token = await tokenFor(OWNER)

    expect((await overview(token)).body).toMatchObject({ system: { buildSha: null } })
    expect((await overview(token, env({ BUILD_SHA: '  ' }))).body).toMatchObject({
      system: { buildSha: null },
    })
    expect((await overview(token, env({ BUILD_SHA: 'ff66184' }))).body).toMatchObject({
      system: { buildSha: 'ff66184' },
    })
  })

  it('K. the migration level is Unknown without a ledger, and read when there is one', async () => {
    const token = await tokenFor(OWNER)

    // Cloudflare's own ledger is not part of this repo's chain, so it is absent
    // here exactly as it is in any database migrations never ran against.
    expect((await overview(token)).body).toMatchObject({ system: { migrationLevel: null } })

    raw().exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)')
    raw().exec(
      "INSERT INTO d1_migrations (id, name) VALUES (14, '0014_workout_recovery_and_corrections.sql'), (15, '0015_programme_builder.sql')",
    )
    expect((await overview(token)).body).toMatchObject({
      system: { migrationLevel: '0015_programme_builder.sql' },
    })
  })

  it('L. the API never claims more than it can: it says only that it answered', () => {
    const code = stripComments(routesSource)
    // `api` is the one literal, and it is honest: the response IS the evidence
    // that the API answered, so there is nothing to probe.
    expect(code).toMatch(/api: 'healthy'/)
    // Every OTHER signal is derived. `d1` from a real round-trip, `cron` from
    // the classifier — neither is ever written down as healthy in this file.
    expect(code).toMatch(/d1: d1Ok \? 'healthy' : 'error'/)
    expect(code).toMatch(/cron: cron\.status/)
    expect(code).not.toMatch(/cron: 'healthy'/)
    // Exactly two occurrences: the literal, and the true half of the probe.
    expect(code.match(/'healthy'/g)).toHaveLength(2)
  })
})

/* ================================================================== */
/* 3. Activity counts — scoped, and Unknown is not zero                */
/* ================================================================== */

describe('3. activity counts are this account’s, and never guessed', () => {
  it('A. counts only the calling account’s rows', async () => {
    seedActivity(OWNER, ['2026-09-07', '2026-09-08'])
    seedActivity(OTHER, ['2026-09-07', '2026-09-08', '2026-09-09'])
    const token = await tokenFor(OWNER)

    const { body } = await overview(token)
    expect(body).toMatchObject({
      activity: {
        workoutOccurrences: 2,
        workoutSets: 2,
        bodyWeightEntries: 2,
        todayCompletions: 2,
        workoutCorrections: 2,
        trainingFlex: 2,
      },
    })
    // The bystander still has everything it had. Reading is not touching.
    expect(activitySnapshot(OTHER)).toEqual([3, 3, 3, 3, 3, 3])
  })

  it('B. a real zero is 0 — not Unknown', async () => {
    const token = await tokenFor(OWNER)
    const { body } = await overview(token)
    expect(body).toMatchObject({
      activity: { workoutOccurrences: 0, workoutSets: 0, trainingFlex: 0 },
    })
  })

  it('C. an unreadable table is Unknown — and costs only itself', async () => {
    seedActivity(OWNER, ['2026-09-07'])
    const token = await tokenFor(OWNER)

    const { body } = await overview(
      token,
      env({}, breakSql(sqlite.db, /FROM workout_sets WHERE/)),
    )
    expect(body).toMatchObject({
      activity: {
        // The one that could not be read. NOT zero: this app is days from a
        // deliberate history reset, and a false "0 sets" would be believed.
        workoutSets: null,
        // Its neighbours are unaffected.
        workoutOccurrences: 1,
        bodyWeightEntries: 1,
        todayCompletions: 1,
        workoutCorrections: 1,
        trainingFlex: 1,
      },
    })
  })

  it('D. push devices and active sessions are account-scoped and liveness-aware', async () => {
    seedPush(OWNER)
    seedPush(OTHER)
    const token = await tokenFor(OWNER)

    // A revoked session and an expired one are records, not live devices.
    raw()
      .prepare(
        `INSERT INTO auth_sessions
           (session_hash, google_sub, email, trusted, created_at, last_seen_at, expires_at, revoked_at)
         VALUES ('revoked', ?, 'a@b.c', 1, 1, 2, ?, 5)`,
      )
      .run(OWNER, Date.now() + 1_000_000)
    raw()
      .prepare(
        `INSERT INTO auth_sessions
           (session_hash, google_sub, email, trusted, created_at, last_seen_at, expires_at)
         VALUES ('expired', ?, 'a@b.c', 1, 1, 2, 5)`,
      )
      .run(OWNER)

    const { body } = await overview(token)
    // One push row, and exactly one live session — the one this call is using.
    expect(body).toMatchObject({ account: { pushDevices: 1, activeSessions: 1 } })
  })

  it('E. every counted table is scoped by google_sub, from ONE generated statement', () => {
    const code = stripComments(readerSource)
    // One place builds the count, so no table can drift out of scope.
    expect(code).toMatch(/SELECT COUNT\(\*\) AS n FROM \$\{table\} WHERE google_sub = \?/)
    // And every hand-written read of an account table carries the same
    // predicate. Checked by looking at what follows each `FROM <table>` rather
    // than by trusting one regex to find whole statements.
    const accountTables = [
      'push_subscriptions',
      'auth_sessions',
      'programme_revisions',
      'notification_deliveries',
    ]
    for (const table of accountTables) {
      const at = code.indexOf(`FROM ${table}`)
      expect(at, `${table} is not read here`).toBeGreaterThan(-1)
      expect(code.slice(at, at + 220), `${table} is read unscoped`).toMatch(/google_sub = \?/)
    }
    // The only unscoped read in the file is Cloudflare's migration ledger,
    // which holds schema history and no account data at all.
    const unscoped = code.match(/FROM (\w+)/g) ?? []
    for (const match of unscoped) {
      const table = match.replace('FROM ', '')
      if (table === 'd1_migrations' || table === '${table}') continue
      expect(accountTables).toContain(table)
    }
  })

  it('F. the counted tables are a subset of what the Round 25 reset clears', () => {
    // Not a coupling — a consistency check. Anything this page calls "activity"
    // must be something the accepted reset contract also calls activity, so the
    // two can never describe different worlds to the same owner.
    for (const { table } of ADMIN_ACTIVITY_TABLES) {
      expect(ROUND25_RESET_TABLES as readonly string[]).toContain(table)
    }
  })

  it('G. the programme is reported as seed, edited or unknown — never invented', async () => {
    const token = await tokenFor(OWNER)

    expect((await overview(token)).body).toMatchObject({
      account: { programme: { status: 'seed' } },
    })

    raw()
      .prepare(
        `INSERT INTO programme_revisions (google_sub, revision, write_token, updated_at)
         VALUES (?, 7, 'tok', 5)`,
      )
      .run(OWNER)
    expect((await overview(token)).body).toMatchObject({
      account: { programme: { status: 'edited', revision: 7, updatedAt: 5 } },
    })

    const broken = await overview(
      token,
      env({}, breakSql(sqlite.db, /FROM programme_revisions/)),
    )
    expect(broken.body).toMatchObject({ account: { programme: { status: 'unknown' } } })
  })
})

/* ================================================================== */
/* 4. The one safe control — Foundation Day 1                          */
/* ================================================================== */

describe('4. Foundation Day 1 — validated, confirmed, and non-destructive', () => {
  const save = (token: string, body: unknown, origin = ORIGIN) =>
    call('/api/admin/foundation-start', { token, method: 'PUT', origin, body })

  it('A. an admin can set a real date, and gets back what was STORED', async () => {
    seedSettings(OWNER, '2026-08-31', 111)
    const token = await tokenFor(OWNER)

    const response = await save(token, { foundationStartDate: '2026-09-14', confirm: true })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      foundation: { status: 'set', date: '2026-09-14' },
    })

    expect(
      raw().prepare('SELECT foundation_start_date AS d FROM account_settings WHERE google_sub = ?')
        .get(OWNER),
    ).toEqual({ d: '2026-09-14' })
  })

  it('B. created_at is PRESERVED; only updated_at moves', async () => {
    seedSettings(OWNER, '2026-08-31', 111)
    const token = await tokenFor(OWNER)

    await save(token, { foundationStartDate: '2026-09-14', confirm: true })

    const row = raw()
      .prepare('SELECT created_at AS c, updated_at AS u FROM account_settings WHERE google_sub = ?')
      .get(OWNER) as { c: number; u: number }
    expect(row.c).toBe(111)
    expect(row.u).toBeGreaterThan(111)
  })

  it('C. an account with no row gets one, without inventing a creation time', async () => {
    const token = await tokenFor(OWNER)
    expect(rowsFor('account_settings', OWNER)).toBe(0)

    await save(token, { foundationStartDate: '2026-09-14', confirm: true })

    const row = raw()
      .prepare('SELECT created_at AS c, updated_at AS u FROM account_settings WHERE google_sub = ?')
      .get(OWNER) as { c: number; u: number }
    expect(row.c).toBe(row.u)
  })

  it('D. WITHOUT an explicit confirmation nothing is written', async () => {
    seedSettings(OWNER, '2026-08-31', 111)
    const token = await tokenFor(OWNER)

    for (const body of [
      { foundationStartDate: '2026-09-14' },
      { foundationStartDate: '2026-09-14', confirm: false },
      { foundationStartDate: '2026-09-14', confirm: 'yes' },
      { foundationStartDate: '2026-09-14', confirm: 1 },
    ]) {
      const response = await save(token, body)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'confirmation_required' })
    }

    expect(
      raw().prepare('SELECT foundation_start_date AS d FROM account_settings WHERE google_sub = ?')
        .get(OWNER),
    ).toEqual({ d: '2026-08-31' })
  })

  it('E. an impossible calendar date is refused before it reaches the database', async () => {
    seedSettings(OWNER, '2026-08-31', 111)
    const token = await tokenFor(OWNER)

    for (const value of ['2026-02-30', '2026-13-01', '14-09-2026', '', 'today', 5, null]) {
      const response = await save(token, { foundationStartDate: value, confirm: true })
      expect(response.status).toBe(400)
    }

    expect(
      raw().prepare('SELECT foundation_start_date AS d FROM account_settings WHERE google_sub = ?')
        .get(OWNER),
    ).toEqual({ d: '2026-08-31' })
  })

  it('F. a cross-origin write is refused, and writes nothing', async () => {
    seedSettings(OWNER, '2026-08-31', 111)
    const token = await tokenFor(OWNER)

    const response = await save(
      token,
      { foundationStartDate: '2026-09-14', confirm: true },
      'https://evil.invalid',
    )
    expect(response.status).toBe(403)
    expect(
      raw().prepare('SELECT foundation_start_date AS d FROM account_settings WHERE google_sub = ?')
        .get(OWNER),
    ).toEqual({ d: '2026-08-31' })
  })

  it('G. only PUT is accepted; GET and POST are refused', async () => {
    const token = await tokenFor(OWNER)
    for (const method of ['GET', 'POST', 'DELETE', 'PATCH']) {
      const response = await call('/api/admin/foundation-start', { token, method })
      expect(response.status).toBe(405)
    }
  })

  it('H. the write touches ONE row and no activity at all', async () => {
    seedActivity(OWNER, ['2026-09-07', '2026-09-08'])
    seedActivity(OTHER, ['2026-09-07'])
    seedSettings(OWNER, '2026-08-31', 111)
    const before = { mine: activitySnapshot(OWNER), theirs: activitySnapshot(OTHER) }
    const token = await tokenFor(OWNER)

    await save(token, { foundationStartDate: '2026-09-14', confirm: true })

    // Changing Day 1 renumbers days. It is NOT the Fresh Reset, and this is the
    // assertion that says so in rows rather than in prose.
    expect(activitySnapshot(OWNER)).toEqual(before.mine)
    expect(activitySnapshot(OTHER)).toEqual(before.theirs)
  })

  it('I. it writes through the shared settings store — no second upsert exists', () => {
    const code = stripComments(routesSource)
    expect(code).toMatch(/writeSettings\(createD1SettingsStore\(env\.DB\)/)
    // No raw SQL of any kind in the route file.
    expect(code).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE)\b/i)
  })

  it('J. an unreadable stored value is reported as such, never as a default', async () => {
    const token = await tokenFor(OWNER)
    // The column's GLOB proves only the shape, so an impossible date can be
    // stored. It must not come back as 2026-08-31 wearing a Day number.
    raw().exec("PRAGMA writable_schema = OFF")
    raw()
      .prepare(
        `INSERT INTO account_settings (google_sub, foundation_start_date, created_at, updated_at)
         VALUES (?, '2026-02-30', 1, 2)`,
      )
      .run(OWNER)

    const { body } = await overview(token)
    expect(body).toMatchObject({ account: { foundation: { status: 'unreadable' } } })
  })
})

/* ================================================================== */
/* 5. The danger zone is a sentence, not a switch                      */
/* ================================================================== */

describe('5. the Fresh Activity Reset is described and NOT wired', () => {
  it('A. the overview reports it unavailable and says who owns it', async () => {
    const token = await tokenFor(OWNER)
    const { body } = await overview(token)
    expect(body).toMatchObject({
      dangerZone: {
        freshActivityReset: { available: false, managedBy: 'round25-operator' },
      },
    })
  })

  it('B. no admin route mutates activity — probed, then counted', async () => {
    seedActivity(OWNER, ['2026-09-07', '2026-09-08'])
    const before = activitySnapshot(OWNER)
    const token = await tokenFor(OWNER)

    const paths = [
      '/api/admin/reset',
      '/api/admin/fresh-start',
      '/api/admin/fresh-activity-reset',
      '/api/admin/round25-reset',
      '/api/admin/danger/reset',
      '/api/admin/overview/reset',
      '/api/admin/activity',
      '/api/admin/sql',
    ]
    for (const path of paths) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const response = await call(path, {
          token,
          method,
          origin: ORIGIN,
          body: method === 'GET' ? undefined : { confirm: true, execute: true },
        })
        // Every one of them is refused, and none of them is a 2xx.
        expect(response.status).toBeGreaterThanOrEqual(400)
      }
    }

    expect(activitySnapshot(OWNER)).toEqual(before)
  })

  it('C. the admin source contains no destructive SQL, anywhere', () => {
    for (const source of [routesSource, readerSource, accessSource, healthSource]) {
      const code = stripComments(source)
      expect(code).not.toMatch(/\bDELETE\s+FROM\b/i)
      expect(code).not.toMatch(/\bDROP\s+(TABLE|INDEX)\b/i)
      expect(code).not.toMatch(/\bTRUNCATE\b/i)
      expect(code).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i)
      expect(code).not.toMatch(/\bINSERT\s+INTO\b/i)
      expect(code).not.toMatch(/\bPRAGMA\b/i)
    }
  })

  it('D. the admin API does not import the reset planner or the Round 18 tool', () => {
    for (const source of [routesSource, readerSource, accessSource, healthSource]) {
      expect(source).not.toMatch(/from '.*round25Reset'/)
      expect(source).not.toMatch(/from '.*freshStart'/)
      expect(source).not.toMatch(/round25Transaction|round25ResetStatements|freshStartStatements/)
    }
  })

  it('E. `available` is a constant false in the source, not a value some request can set', () => {
    const code = stripComments(routesSource)
    expect(code).toMatch(/available: false/)
    expect(code).not.toMatch(/available: true/)
    // The descriptor is frozen at module scope, so no handler can rebuild it.
    expect(code).toMatch(/const DANGER_ZONE = \{[\s\S]*?\} as const/)
  })
})

/* ================================================================== */
/* 6. Maintenance mode is reported as deferred, not faked              */
/* ================================================================== */

describe('6. maintenance mode', () => {
  it('A. is OFF, and says out loud that it is neither enforced nor controllable', async () => {
    const token = await tokenFor(OWNER)
    const { body } = await overview(token)
    expect(body).toMatchObject({
      maintenance: {
        state: 'off',
        enforced: false,
        controllable: false,
        reason: 'no_persistent_store',
      },
    })
  })

  it('B. has no toggle route — every method on every plausible path is refused', async () => {
    const token = await tokenFor(OWNER)
    for (const path of ['/api/admin/maintenance', '/api/admin/maintenance-mode']) {
      for (const method of ['GET', 'PUT', 'POST', 'DELETE']) {
        const response = await call(path, {
          token,
          method,
          origin: ORIGIN,
          body: method === 'GET' ? undefined : { state: 'on', confirm: true },
        })
        expect(response.status).toBeGreaterThanOrEqual(400)
      }
    }
  })
})

/* ================================================================== */
/* 7. The wire contract fails closed                                   */
/* ================================================================== */

describe('7. the overview envelope refuses what it cannot read', () => {
  const good = () => ({
    system: {
      api: 'healthy',
      d1: 'healthy',
      cron: 'unknown',
      cronReason: 'no_observed_sweep',
      cronLastSweepAt: null,
      buildSha: null,
      migrationLevel: null,
    },
    account: {
      foundation: { status: 'unset' },
      programme: { status: 'seed' },
      pushDevices: 0,
      activeSessions: 1,
    },
    activity: {
      workoutOccurrences: 0,
      workoutSets: 0,
      bodyWeightEntries: 0,
      todayCompletions: 0,
      workoutCorrections: 0,
      trainingFlex: 0,
    },
    maintenance: { state: 'off', enforced: false, controllable: false, reason: 'x' },
    dangerZone: { freshActivityReset: { available: false, managedBy: 'round25-operator' } },
  })

  it('A. accepts the shape the server actually sends', () => {
    expect(parseAdminOverview(good()).ok).toBe(true)
  })

  it('B. refuses a body that is not the shape at all', () => {
    for (const body of [null, undefined, 'ok', 42, [], {}, { error: 'forbidden' }]) {
      expect(parseAdminOverview(body)).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('C. an unrecognised health word resolves DOWN to unknown, never to healthy', () => {
    const body = good()
    body.system.d1 = 'ok' as 'healthy'
    const parsed = parseAdminOverview(body)
    expect(parsed.ok && parsed.overview.system.d1).toBe('unknown')
  })

  it('D. a count that is not a real count becomes Unknown, not zero', () => {
    for (const value of ['3', -1, 1.5, NaN, null, undefined, {}]) {
      const body = good()
      ;(body.activity as Record<string, unknown>).workoutSets = value
      const parsed = parseAdminOverview(body)
      expect(parsed.ok && parsed.overview.activity.workoutSets).toBe(null)
    }
  })

  it('E. the danger zone is available only when the server says exactly true', () => {
    for (const value of ['true', 1, undefined, null, {}]) {
      const body = good()
      ;(body.dangerZone.freshActivityReset as Record<string, unknown>).available = value
      const parsed = parseAdminOverview(body)
      expect(parsed.ok && parsed.overview.dangerZone.freshActivityReset.available).toBe(false)
    }
  })
})
