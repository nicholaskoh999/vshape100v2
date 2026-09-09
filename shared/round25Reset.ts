// An explicit `.ts` specifier, for the same reason `freshStart.ts` uses one:
// scripts/round25-reset.mjs imports this module under plain Node, which
// resolves relative specifiers exactly and will not guess an extension.
import { isLocalDate } from './localDate.ts'
import { isEmbeddableValue, renderStatement } from './freshStart.ts'

/**
 * Round 25 — FULL ACTIVITY FRESH START, for exactly one named account.
 *
 * ── WHY THIS IS A NEW FILE AND NOT AN EDIT TO `freshStart.ts` ────────────────
 *
 * Round 18's Fresh Start deletes training history **strictly before a cutoff**,
 * across four tables. That is a different operation with a different meaning,
 * it shipped, it is tested, and other people's understanding of "fresh start"
 * in this repository points at it. Widening it in place would silently change
 * what a reviewed, released tool does — and the two would then be
 * indistinguishable in a changelog.
 *
 * So Round 18's tool is left exactly as it is, and this is a separate contract
 * with a separate operator script and separate tests. The one thing they share
 * is `renderStatement` / `isEmbeddableValue`: there must be exactly ONE
 * implementation of "refuse to embed an unsafe value", because a second one is
 * a second chance to get it wrong.
 *
 * ── WHAT THIS DELETES ────────────────────────────────────────────────────────
 *
 * EVERY row belonging to ONE `google_sub` in the nine tables of
 * `ROUND25_RESET_TABLES`. There is no date predicate: this is a full activity
 * reset, not a boundary. Approved by the controller, table by table, after the
 * Stage 1 analysis found that five of them were protected by the Round 18 guard.
 *
 * ── WHAT IT PRESERVES, AND HOW THAT IS ENFORCED ─────────────────────────────
 *
 * Everything else. Not by intention — by construction, and then by test:
 *
 *   - the only tables named in any generated DELETE are the nine
 *   - `ROUND25_PRESERVED_TABLES` may never appear in a DELETE at all
 *   - `company_holidays` is GLOBAL: it has no account column, so an
 *     account-scoped statement structurally cannot reach it
 *   - `oauth_states` likewise has no account column and is never named
 *   - `account_settings` is neither reset nor untouched: exactly one column,
 *     `foundation_start_date`, is written, by exactly the upsert the Worker's
 *     own settings store uses
 *
 * ── WHAT IS NOT WRITTEN ─────────────────────────────────────────────────────
 *
 * Nothing derived. Streaks, Achievements, Personal Bests, Exercise Performance,
 * Recent Workouts and the progression lanes are computed from the surviving
 * rows on every read — there is no table to reset and nothing to correct by
 * hand. A hand-written counter would be a number the data no longer supports.
 *
 * ── PURITY ──────────────────────────────────────────────────────────────────
 *
 * This module builds SQL text and validates inputs. It opens no connection,
 * reads no environment and cannot reach a database. Executing it is a separate,
 * deliberate operator action, which is what makes the destructive half
 * reviewable on its own and testable against real SQLite rather than against
 * production. There is deliberately no HTTP route: a full reset behind a URL is
 * one authentication bug away from erasing somebody's training.
 */

/** One statement, with its values kept separate from its text. */
export type Round25Statement = { sql: string; params: (string | number)[] }

/**
 * The nine tables a Round 25 reset empties, IN DELETION ORDER.
 *
 * The first four are the workout block, children before parent. All three
 * children carry a foreign key onto `workout_occurrences` declared
 * `ON DELETE CASCADE`, but **D1 does not guarantee foreign keys are enforced
 * for a given statement**, so the owned rows are deleted explicitly. In this
 * order no orphan can survive whether cascade fires or not.
 *
 * The remaining five carry no foreign key and are independent of each other and
 * of the block above; they are listed after it for review legibility, not
 * because the order matters.
 */
export const ROUND25_RESET_TABLES = [
  // workout block — children first
  'workout_set_corrections',
  'workout_calibration',
  'workout_sets',
  'workout_occurrences',
  // independent activity/history domains
  'body_weight_entries',
  'today_completions',
  'training_flex',
  'holiday_overrides',
  'company_holiday_preferences',
] as const

export type Round25ResetTable = (typeof ROUND25_RESET_TABLES)[number]

/**
 * Tables a Round 25 reset must never delete from.
 *
 * Asserted by test against the generated SQL, so adding a statement that
 * reaches one of these fails the build rather than production.
 *
 * `company_holidays` and `oauth_states` are in this list twice over: they are
 * named here, AND neither has an account column, so an account-scoped statement
 * could not be written against them even by mistake.
 */
export const ROUND25_PRESERVED_TABLES = [
  'auth_sessions',
  'oauth_states',
  'push_subscriptions',
  'notification_deliveries',
  'exercise_media',
  'exercise_input_types',
  'programme_revisions',
  'programme_exercises',
  'programme_slots',
  'company_holidays',
] as const

/**
 * The one table Round 25 writes without emptying, and the only columns it may
 * touch there.
 *
 * `created_at` is deliberately absent: a reset must not rewrite when the account
 * first chose a start date. `google_sub` is absent because it is the key.
 */
export const ROUND25_SETTINGS_TABLE = 'account_settings'
export const ROUND25_SETTINGS_WRITABLE_COLUMNS = [
  'foundation_start_date',
  'updated_at',
] as const

/* ------------------------------------------------------------------ */
/* The target                                                          */
/* ------------------------------------------------------------------ */

export type Round25Target = {
  /** The `google_sub` of the ONE account to reset. */
  googleSub: string
  /** The user-approved new Foundation Day 1, `YYYY-MM-DD`. */
  foundationStart: string
}

export type Round25Field = 'google_sub' | 'foundation_start'

export type ParsedRound25Target =
  | { ok: true; value: Round25Target }
  | { ok: false; field: Round25Field }

/**
 * Validate a target. Both values are REQUIRED and neither is ever inferred.
 *
 * There is deliberately no "the only account", no "the most recent session" and
 * no "today" default for the start date. Inferring whose data to erase is how
 * the wrong person's gets erased, and inferring the restart date is how a reset
 * silently keeps counting from the old one.
 */
export function parseRound25Target(
  googleSub: unknown,
  foundationStart: unknown,
): ParsedRound25Target {
  if (typeof googleSub !== 'string' || googleSub.trim() === '') {
    return { ok: false, field: 'google_sub' }
  }
  // Checked at the boundary, before any statement exists — see `renderStatement`.
  if (!isEmbeddableValue(googleSub.trim())) return { ok: false, field: 'google_sub' }
  if (!isLocalDate(foundationStart)) return { ok: false, field: 'foundation_start' }
  return { ok: true, value: { googleSub: googleSub.trim(), foundationStart } }
}

/* ------------------------------------------------------------------ */
/* The destructive statements                                          */
/* ------------------------------------------------------------------ */

/**
 * The nine deletes, in dependency order.
 *
 * Every statement carries `google_sub = ?`. That is not the caller's
 * discipline — it is a property of each statement, generated from one loop, so
 * an unscoped delete cannot be introduced by editing a single line.
 */
export function round25ResetStatements(target: Round25Target): Round25Statement[] {
  return ROUND25_RESET_TABLES.map((table) => ({
    sql: `DELETE FROM ${table} WHERE google_sub = ?`,
    params: [target.googleSub],
  }))
}

/**
 * The new Foundation Day 1.
 *
 * Byte-for-byte the upsert `worker/settings/d1Store.ts` uses, so the reset
 * writes this value exactly the way the application does — including preserving
 * `created_at` on an existing row, and creating one for an account that never
 * saved a start date. That last case matters: with no row at all the app falls
 * back to the source constant `DEFAULT_FOUNDATION_START`, so a reset that only
 * deleted would leave the app counting from the old epoch as though nothing had
 * been erased.
 */
export function round25FoundationStatement(
  target: Round25Target,
  now: number,
): Round25Statement {
  return {
    sql: `INSERT INTO ${ROUND25_SETTINGS_TABLE}
             (google_sub, foundation_start_date, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (google_sub)
           DO UPDATE SET foundation_start_date = excluded.foundation_start_date,
                         updated_at            = excluded.updated_at`,
    params: [target.googleSub, target.foundationStart, now, now],
  }
}

/**
 * The whole mutation as ONE command — the atomic boundary.
 *
 * D1 rejects explicit `BEGIN` / `SAVEPOINT` ("please use the
 * state.storage.transaction() API instead"), so the transaction cannot be
 * written by hand. What D1 does provide is that a MULTI-STATEMENT command runs
 * as a single transaction — measured against a local D1 in Round 18, not
 * assumed. The command is therefore the boundary.
 *
 * The Foundation write is LAST and inside it. A reset that emptied nine tables
 * and then failed to set Day 1 would leave the app counting from the old start
 * date over no data at all; all-or-nothing is the only honest shape.
 */
export function round25Transaction(target: Round25Target, now: number): string {
  return [...round25ResetStatements(target), round25FoundationStatement(target, now)]
    .map((statement) => `${renderStatement(statement)};`)
    .join('\n')
}

/* ------------------------------------------------------------------ */
/* Read-only: inventory, fingerprint, proofs                           */
/* ------------------------------------------------------------------ */

/**
 * What the reset WOULD empty — all nine tables, scoped to the target account.
 *
 * The default mode of the operator script. An execution that was never preceded
 * by a count is an execution nobody approved.
 */
export function round25Inventory(target: Round25Target): Round25Statement[] {
  return ROUND25_RESET_TABLES.map((table) => ({
    sql: `SELECT COUNT(*) AS n FROM ${table} WHERE google_sub = ?`,
    params: [target.googleSub],
  }))
}

export const ROUND25_INVENTORY_LABELS = ROUND25_RESET_TABLES

/**
 * PRESERVED DOMAINS, SPLIT BY WHETHER THEY CAN LEGITIMATELY MOVE.
 *
 * Round 25 correction (Blocker B). The first version of this fingerprint asked
 * for before == after across every preserved table, including
 * `notification_deliveries`, `auth_sessions` and `oauth_states`. That is wrong
 * as an ACCEPTANCE condition, and would have failed a perfectly good reset:
 *
 *   - a cron fires every minute and the notification store legitimately
 *     inserts delivery claims, updates their status and prunes old rows
 *   - `auth_sessions.last_seen_at` moves on any request the user makes, and a
 *     sign-in during the operator window creates a row
 *   - `oauth_states` rows are created and consumed by any login in flight
 *
 * None of that has anything to do with the reset, and none of it is evidence
 * the reset misbehaved. Requiring temporal equality there would have taught the
 * operator to ignore a failing check, which is worse than not checking.
 *
 * So preservation is proven two different ways, matched to what is actually
 * true of each table:
 *
 *   STABLE      — content that nothing but a deliberate user edit can change.
 *                 before == after IS an acceptance condition.
 *   OPERATIONAL — concurrently mutable by the system or by an unrelated login.
 *                 Counted for DIAGNOSIS only, never for acceptance. These are
 *                 protected STRUCTURALLY instead: `round25Transaction` never
 *                 names them, which is asserted against the generated SQL and
 *                 is a stronger guarantee than any before/after comparison —
 *                 it holds even while they are changing.
 */
export function round25StableFingerprint(target: Round25Target): Round25Statement[] {
  const sub = target.googleSub
  return [
    {
      sql: `SELECT COUNT(*) AS n, COALESCE(MAX(revision), 0) AS v
              FROM programme_revisions WHERE google_sub = ?`,
      params: [sub],
    },
    {
      sql: `SELECT COUNT(*) AS n, COALESCE(group_concat(sig, '|'), '') AS v FROM (
              SELECT exercise_id || ':' || name || ':' || archived || ':' || is_custom AS sig
                FROM programme_exercises WHERE google_sub = ? ORDER BY exercise_id)`,
      params: [sub],
    },
    {
      sql: `SELECT COUNT(*) AS n, COALESCE(group_concat(sig, '|'), '') AS v FROM (
              SELECT session_id || ':' || position || ':' || exercise_id || ':' || set_count
                     || ':' || result_kind || ':' || target_min || '-' || target_max
                     || ':' || per_side || ':' || COALESCE(equipment, '') AS sig
                FROM programme_slots WHERE google_sub = ?
               ORDER BY session_id, position)`,
      params: [sub],
    },
    {
      sql: `SELECT COUNT(*) AS n, COALESCE(group_concat(sig, '|'), '') AS v FROM (
              SELECT exercise_id || ':' || media_type || ':' || media_url || ':' || media_alt AS sig
                FROM exercise_media WHERE google_sub = ? ORDER BY exercise_id)`,
      params: [sub],
    },
    {
      sql: `SELECT COUNT(*) AS n, COALESCE(group_concat(sig, '|'), '') AS v FROM (
              SELECT exercise_id || ':' || input_type AS sig
                FROM exercise_input_types WHERE google_sub = ? ORDER BY exercise_id)`,
      params: [sub],
    },
    {
      sql: `SELECT COUNT(*) AS n, COALESCE(group_concat(sig, '|'), '') AS v FROM (
              SELECT id || ':' || endpoint_hash || ':' || timezone AS sig
                FROM push_subscriptions WHERE google_sub = ? ORDER BY id)`,
      params: [sub],
    },
    {
      sql: `SELECT COUNT(*) AS n, COALESCE(group_concat(sig, '|'), '') AS v FROM (
              SELECT holiday_date || ':' || name AS sig
                FROM company_holidays ORDER BY holiday_date)`,
      params: [],
    },
    // account_settings: everything EXCEPT the one column this reset may write.
    // Equal before and after proves no other setting moved.
    {
      sql: `SELECT COUNT(*) AS n,
                   COALESCE(group_concat(google_sub || ':' || created_at, '|'), '') AS v
              FROM (SELECT google_sub, created_at FROM account_settings
                     WHERE google_sub = ? ORDER BY google_sub)`,
      params: [sub],
    },
  ]
}

export const ROUND25_STABLE_LABELS = [
  'programme_revision',
  'programme_exercises',
  'programme_slots',
  'exercise_media',
  'exercise_input_types',
  'push_subscriptions',
  'company_holidays_all',
  'account_settings_other_columns',
] as const

/**
 * Tables that are preserved but may legitimately move during the operator
 * window. DIAGNOSTIC ONLY — never an acceptance condition.
 *
 * `ROUND25_OPERATIONAL_TABLES` is also what the structural proof asserts
 * against: none of these names may appear anywhere in the generated mutation.
 */
export const ROUND25_OPERATIONAL_TABLES = [
  'notification_deliveries',
  'oauth_states',
  'auth_sessions',
] as const

export function round25OperationalCounts(target: Round25Target): Round25Statement[] {
  return [
    {
      sql: `SELECT COUNT(*) AS n FROM notification_deliveries WHERE google_sub = ?`,
      params: [target.googleSub],
    },
    { sql: `SELECT COUNT(*) AS n FROM oauth_states`, params: [] },
    {
      sql: `SELECT COUNT(*) AS n FROM auth_sessions WHERE google_sub = ?`,
      params: [target.googleSub],
    },
  ]
}

export const ROUND25_OPERATIONAL_LABELS = ROUND25_OPERATIONAL_TABLES

/**
 * The Foundation start date as stored, for the after-proof.
 *
 * Read separately from the fingerprint above precisely because this one is
 * EXPECTED to change; everything in the fingerprint is expected not to.
 */
export function round25FoundationCheck(target: Round25Target): Round25Statement {
  return {
    sql: `SELECT COUNT(*) AS n, COALESCE(foundation_start_date, '') AS v
            FROM account_settings WHERE google_sub = ?`,
    params: [target.googleSub],
  }
}

/**
 * Rows belonging to every OTHER account, across the nine reset tables.
 *
 * Identical before and after is the proof that one account's reset cannot reach
 * another's data. Asserted rather than argued.
 */
export function round25IsolationChecks(target: Round25Target): Round25Statement[] {
  return ROUND25_RESET_TABLES.map((table) => ({
    sql: `SELECT COUNT(*) AS n FROM ${table} WHERE google_sub <> ?`,
    params: [target.googleSub],
  }))
}

export const ROUND25_ISOLATION_LABELS = ROUND25_RESET_TABLES

/**
 * ORPHAN PROOF, IN TWO PARTS.
 *
 * Round 25 correction (Blocker B). A single global "orphans must be zero" check
 * lets state that has nothing to do with this reset fail it. If the database
 * already carried one orphaned row — written by an older bug, or belonging to
 * another account entirely — a perfectly correct reset would report failure
 * AFTER the destruction had happened, which is the worst possible moment to
 * hand somebody a number they cannot act on.
 *
 * So the proof is split:
 *
 *   TARGET  — the account being reset must own no orphan at all. Absolute, and
 *             the one that actually says this reset was clean.
 *   GLOBAL  — read before and after. The condition is "no NEW orphan", not
 *             "no orphan": pre-existing ones are reported, not blamed on this
 *             operation.
 */
function orphanOf(table: string, alias: string, where: string, params: (string | number)[]) {
  return {
    sql: `SELECT COUNT(*) AS n FROM ${table} ${alias}
           WHERE ${where}NOT EXISTS (
             SELECT 1 FROM workout_occurrences o
              WHERE o.google_sub   = ${alias}.google_sub
                AND o.workout_date = ${alias}.workout_date
                AND o.session_id   = ${alias}.session_id
           )`,
    params,
  }
}

/** Orphans anywhere in the database. Compared before against after. */
export function round25OrphanChecks(): Round25Statement[] {
  return [
    orphanOf('workout_sets', 's', '', []),
    orphanOf('workout_calibration', 'c', '', []),
    orphanOf('workout_set_corrections', 'x', '', []),
  ]
}

/** Orphans belonging to the target account. Must be zero afterwards. */
export function round25TargetOrphanChecks(target: Round25Target): Round25Statement[] {
  const sub = [target.googleSub]
  return [
    orphanOf('workout_sets', 's', 's.google_sub = ? AND ', sub),
    orphanOf('workout_calibration', 'c', 'c.google_sub = ? AND ', sub),
    orphanOf('workout_set_corrections', 'x', 'x.google_sub = ? AND ', sub),
  ]
}

export const ROUND25_ORPHAN_LABELS = [
  'orphan_sets',
  'orphan_calibration',
  'orphan_corrections',
] as const

export { renderStatement }
