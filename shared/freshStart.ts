// An explicit `.ts` specifier, unlike everywhere else in this codebase.
//
// scripts/fresh-start.mjs imports this module under plain Node, which resolves
// relative specifiers exactly and will not guess an extension. The bundler and
// the type checker are both happy either way (`allowImportingTsExtensions` is
// already on), so this costs nothing and is the difference between the operator
// script running and failing with ERR_MODULE_NOT_FOUND.
import { isLocalDate } from './localDate.ts'

/**
 * Fresh Start — the one-off, release-stage reset of pre-cutoff training history.
 *
 * WHAT THIS FILE IS, AND IS NOT.
 *
 * It is PURE. It builds SQL and validates inputs; it opens no connection, reads
 * no environment, and cannot reach production by itself. Executing it is a
 * separate, deliberate operator action (scripts/fresh-start.mjs), which is what
 * makes the destructive half reviewable in isolation and testable against a real
 * SQLite database rather than against production.
 *
 * It is deliberately NOT an HTTP endpoint. A destructive reset behind a URL is
 * one authentication bug away from deleting someone's training history, and it
 * would sit in the Worker forever to serve an action that happens once. There is
 * no route, so there is no attack surface.
 *
 * WHAT IT DELETES.
 *
 * For ONE named account only, every workout occurrence — scheduled and Extra
 * alike — whose local workout date is strictly BEFORE the cutoff, together with
 * the rows those occurrences own: their sets, and their progression calibration.
 *
 * `< cutoff` is strict. A workout dated exactly on the cutoff is the first day of
 * the new Foundation and must survive, so the boundary is never `<=`.
 *
 * WHAT IT PRESERVES.
 *
 * Everything else, by construction: it names only three tables. Auth sessions,
 * account settings, body weight, company holidays, holiday overrides,
 * notification subscriptions and delivery history, Today completions and the
 * exercise media library are not referenced by any statement here, so they
 * cannot be touched by it.
 *
 * WHAT IS NOT HAND-EDITED.
 *
 * Nothing derived. Recent Workouts, Personal Bests, Exercise Performance,
 * streaks, Achievements and Round 16 progression are all computed from the
 * surviving rows on every read, so they correct themselves the moment the
 * evidence changes. Writing a counter or a PB by hand would be inventing a
 * number the data no longer supports.
 */

/** The account and boundary a Fresh Start acts on. */
export type FreshStartTarget = {
  /** The `google_sub` of the ONE account to reset. */
  googleSub: string
  /** Local date. Occurrences strictly before this are removed. */
  cutoff: string
}

export type FreshStartField = 'google_sub' | 'cutoff'

export type ParsedFreshStartTarget =
  | { ok: true; value: FreshStartTarget }
  | { ok: false; field: FreshStartField }

/**
 * Validate a target.
 *
 * The account key must be given EXPLICITLY and non-empty. There is deliberately
 * no "the only account" or "the most recent session" convenience: inferring
 * whose history to delete is exactly the mistake that deletes the wrong
 * person's, and a reset that is hard to aim is a reset that should not run.
 */
export function parseFreshStartTarget(
  googleSub: unknown,
  cutoff: unknown,
): ParsedFreshStartTarget {
  if (typeof googleSub !== 'string' || googleSub.trim() === '') {
    return { ok: false, field: 'google_sub' }
  }
  // The account key has to survive being written as a SQL literal (see
  // `renderStatement`), so it is restricted to an allowlist here — at the
  // boundary, before any statement exists. A key that cannot be embedded safely
  // is rejected outright rather than escaped and hoped for.
  if (!EMBEDDABLE.test(googleSub.trim())) return { ok: false, field: 'google_sub' }
  if (!isLocalDate(cutoff)) return { ok: false, field: 'cutoff' }
  return { ok: true, value: { googleSub: googleSub.trim(), cutoff } }
}

/* ------------------------------------------------------------------ */
/* Rendering to SQL text                                               */
/* ------------------------------------------------------------------ */

/**
 * Characters a value may contain to be embeddable as a SQL literal.
 *
 * Deliberately narrow: alphanumerics and a few separators that appear in real
 * Google subject identifiers and in ISO dates. No quote, backslash, semicolon,
 * whitespace or comment marker can pass, so a rendered literal cannot terminate
 * its string, end the statement, or start a comment.
 */
const EMBEDDABLE = /^[A-Za-z0-9_.:@-]+$/

/** True when `value` may be embedded as a SQL literal. */
export function isEmbeddableValue(value: string): boolean {
  return EMBEDDABLE.test(value)
}

/**
 * Render one prepared statement as literal SQL.
 *
 * WHY THIS EXISTS AT ALL. Wrangler's `d1 execute` has no parameter binding — it
 * accepts `--command` or `--file` and nothing else. The previous operator script
 * passed `--param`, which that CLI does not implement, so it could never have run
 * a single statement successfully.
 *
 * Binding is therefore replaced by something with an equivalent guarantee rather
 * than by trust: every value is checked against `EMBEDDABLE` at parse time AND
 * again here, and anything else throws instead of being escaped. Two independent
 * refusals, and neither depends on the caller remembering to validate.
 */
export function renderStatement(statement: FreshStartStatement): string {
  let index = 0
  const rendered = statement.sql.replace(/\?/g, () => {
    const value = statement.params[index++]
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('fresh start: non-finite parameter')
      return String(value)
    }
    if (typeof value !== 'string' || !EMBEDDABLE.test(value)) {
      throw new Error('fresh start: refusing to embed an unsafe value')
    }
    return `'${value}'`
  })
  if (index !== statement.params.length) {
    throw new Error('fresh start: parameter count did not match the statement')
  }
  return rendered
}

/**
 * The whole destructive phase as ONE command.
 *
 * THE ATOMIC BOUNDARY.
 *
 * Round 18 Correction 1: the deletes used to run as three separate Wrangler
 * invocations, so a failure between them left an account half-reset — sets and
 * calibration gone, the occurrences that owned them still present.
 *
 * D1 rejects explicit `BEGIN`/`SAVEPOINT` outright ("please use the
 * state.storage.transaction() API instead"), so the transaction cannot be
 * written by hand. What D1 does provide is that a MULTI-STATEMENT command is
 * executed as a single transaction. Measured against a local D1, not assumed:
 * three inserts where the last statement fails leave zero rows behind, and a
 * failure in the middle leaves the rows from before the command untouched.
 *
 * So the three deletes become one command, in dependency order, and the
 * all-or-nothing boundary is the command itself.
 */
export function freshStartTransaction(target: FreshStartTarget): string {
  return freshStartStatements(target)
    .map((statement) => `${renderStatement(statement)};`)
    .join('\n')
}

/** One statement, with its bound values kept separate from its text. */
export type FreshStartStatement = { sql: string; params: (string | number)[] }

/**
 * The read-only inventory: what a Fresh Start WOULD remove and what it would
 * keep, on both sides of the boundary.
 *
 * Every count is scoped to the target account, so an inventory can never
 * describe somebody else's data, and the "keep" side is reported as well as the
 * "remove" side — a reset should be approved against both numbers, not just the
 * one being deleted.
 */
export function freshStartInventory(target: FreshStartTarget): FreshStartStatement[] {
  const { googleSub, cutoff } = target
  return [
    {
      sql: `SELECT COUNT(*) AS n FROM workout_occurrences
             WHERE google_sub = ? AND workout_date < ?`,
      params: [googleSub, cutoff],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM workout_occurrences
             WHERE google_sub = ? AND workout_date >= ?`,
      params: [googleSub, cutoff],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM workout_sets
             WHERE google_sub = ? AND workout_date < ?`,
      params: [googleSub, cutoff],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM workout_sets
             WHERE google_sub = ? AND workout_date >= ?`,
      params: [googleSub, cutoff],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM workout_calibration
             WHERE google_sub = ? AND workout_date < ?`,
      params: [googleSub, cutoff],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM workout_calibration
             WHERE google_sub = ? AND workout_date >= ?`,
      params: [googleSub, cutoff],
    },
  ]
}

/** The labels the inventory counts come back in, in order. */
export const FRESH_START_INVENTORY_LABELS = [
  'occurrences_before_cutoff',
  'occurrences_kept',
  'sets_before_cutoff',
  'sets_kept',
  'calibration_before_cutoff',
  'calibration_kept',
] as const

/**
 * The destructive statements, in dependency order.
 *
 * Children before parents. `workout_sets` and `workout_calibration` both carry a
 * foreign key onto the occurrence, and while both are declared ON DELETE CASCADE,
 * D1 does not guarantee foreign keys are enforced for a given statement — so the
 * owned rows are deleted EXPLICITLY rather than trusted to disappear. Doing it in
 * this order means no orphan can survive whether cascade fires or not.
 *
 * Every statement carries BOTH `google_sub = ?` and `workout_date < ?`. Neither
 * is optional and neither is interpolated: the account scope and the boundary are
 * properties of each statement, not of the caller's discipline.
 */
export function freshStartStatements(target: FreshStartTarget): FreshStartStatement[] {
  const { googleSub, cutoff } = target
  return [
    {
      sql: `DELETE FROM workout_calibration
             WHERE google_sub = ? AND workout_date < ?`,
      params: [googleSub, cutoff],
    },
    {
      sql: `DELETE FROM workout_sets
             WHERE google_sub = ? AND workout_date < ?`,
      params: [googleSub, cutoff],
    },
    {
      sql: `DELETE FROM workout_occurrences
             WHERE google_sub = ? AND workout_date < ?`,
      params: [googleSub, cutoff],
    },
  ]
}

/**
 * Statements proving no orphan survived, for the after-proof.
 *
 * A set or calibration row whose occurrence is gone would be invisible in the
 * app and would still be counted by anything reading the child tables directly.
 * Both must be zero after a Fresh Start.
 */
export function freshStartOrphanChecks(): FreshStartStatement[] {
  return [
    {
      sql: `SELECT COUNT(*) AS n FROM workout_sets s
             WHERE NOT EXISTS (
               SELECT 1 FROM workout_occurrences o
                WHERE o.google_sub   = s.google_sub
                  AND o.workout_date = s.workout_date
                  AND o.session_id   = s.session_id
             )`,
      params: [],
    },
    {
      sql: `SELECT COUNT(*) AS n FROM workout_calibration c
             WHERE NOT EXISTS (
               SELECT 1 FROM workout_occurrences o
                WHERE o.google_sub   = c.google_sub
                  AND o.workout_date = c.workout_date
                  AND o.session_id   = c.session_id
             )`,
      params: [],
    },
  ]
}

/** The labels the orphan checks come back in, in order. */
export const FRESH_START_ORPHAN_LABELS = ['orphan_sets', 'orphan_calibration'] as const

/**
 * Tables a Fresh Start must never write to.
 *
 * Asserted by test against the generated SQL, so adding a statement that touches
 * one of these fails the build rather than production.
 */
export const FRESH_START_PRESERVED_TABLES = [
  'auth_sessions',
  'oauth_states',
  'account_settings',
  // Round 19.2. A flex choice is a decision about a day, not training
  // evidence, so a history reset has no business deleting it.
  'training_flex',
  'body_weight_entries',
  'company_holidays',
  'holiday_overrides',
  'push_subscriptions',
  'notification_deliveries',
  'today_completions',
  'exercise_media',
] as const
