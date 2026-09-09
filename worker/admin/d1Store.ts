/**
 * Read-only D1 access for Admin Lite.
 *
 * EVERY STATEMENT IN THIS FILE IS A SELECT. There is no INSERT, UPDATE, DELETE,
 * DROP or PRAGMA here, and no statement is assembled from anything a caller
 * supplied: the only table names that appear are the compile-time constants
 * below, and the only bound value is the `google_sub` the session resolved. The
 * one safe control this feature offers — the Foundation start date — does not
 * go through this module at all; it reuses the existing account-settings store,
 * so there is exactly one upsert in the codebase that can touch that row.
 *
 * FAIL CLOSED, PER READING. Each read is wrapped on its own and degrades to
 * `null`, never to `0`. A page that showed `0` for a table it could not read
 * would be reporting "your history is empty" at the exact moment it knows
 * least — and this app is days away from a deliberate history reset, which is
 * the one week where that particular lie would be believed.
 */

import type { AdminActivity, AdminProgramme } from '../../shared/admin'
import type { SweepReading } from './health'

/**
 * The slice of D1 this module uses.
 *
 * Declared structurally, following worker/programme/d1Store.ts, so the REAL
 * statements can be executed against real SQLite in the test suite rather than
 * against a fake that pattern-matches them. `D1Database` satisfies it, so
 * `createAdminReader(env.DB)` is unchanged at the call site.
 */
export type AdminD1Statement = {
  bind: (...values: unknown[]) => AdminD1Statement
  first: <T>() => Promise<T | null>
}

export type AdminD1 = {
  prepare: (sql: string) => AdminD1Statement
}

/**
 * The activity tables, and the wire key each one answers to.
 *
 * Every one of these is account-scoped by `google_sub`, which is what makes the
 * single generated statement below safe to share between them. A table without
 * that column could not be counted here at all, and must not be added to this
 * list.
 */
export const ADMIN_ACTIVITY_TABLES: readonly {
  key: keyof AdminActivity
  table: string
}[] = [
  { key: 'workoutOccurrences', table: 'workout_occurrences' },
  { key: 'workoutSets', table: 'workout_sets' },
  { key: 'bodyWeightEntries', table: 'body_weight_entries' },
  { key: 'todayCompletions', table: 'today_completions' },
  { key: 'workoutCorrections', table: 'workout_set_corrections' },
  { key: 'trainingFlex', table: 'training_flex' },
]

/**
 * A count read, or null.
 *
 * `null` is returned for a thrown query AND for a result that is not a
 * non-negative integer. SQLite's COUNT always produces one, so the second case
 * is unreachable in practice — which is not a reason to hand back a number the
 * code never checked.
 */
async function count(db: AdminD1, sql: string, ...params: unknown[]): Promise<number | null> {
  try {
    const row = await db
      .prepare(sql)
      .bind(...params)
      .first<{ n: unknown }>()
    const value = row?.n
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
    return value
  } catch {
    // Swallowed on purpose, and only here: the caller's contract is "a number
    // or Unknown", and one unreadable table must not blank the whole page.
    return null
  }
}

export type AdminReader = {
  /** A trivial round-trip. True when D1 answered. */
  probe: () => Promise<boolean>
  /** The newest applied migration, or null when the ledger is unavailable. */
  migrationLevel: () => Promise<string | null>
  activity: (googleSub: string) => Promise<AdminActivity>
  pushDevices: (googleSub: string) => Promise<number | null>
  activeSessions: (googleSub: string, now: number) => Promise<number | null>
  programme: (googleSub: string) => Promise<AdminProgramme>
  /** The newest delivery claim on this account, as evidence the sweep ran. */
  lastSweep: (googleSub: string) => Promise<SweepReading>
}

export function createAdminReader(db: AdminD1): AdminReader {
  return {
    async probe() {
      try {
        const row = await db.prepare('SELECT 1 AS n').first<{ n: unknown }>()
        return row?.n === 1
      } catch {
        return false
      }
    },

    async migrationLevel() {
      // `d1_migrations` is Cloudflare's own ledger, created by the migration
      // tooling rather than by this repo's chain. It is absent in local SQLite
      // and in any database migrations have never been applied to, so a missing
      // table is an ordinary outcome here and reads as Unknown.
      try {
        const row = await db
          .prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1')
          .first<{ name: unknown }>()
        const name = row?.name
        return typeof name === 'string' && name.length > 0 ? name : null
      } catch {
        return null
      }
    },

    async activity(googleSub) {
      // ONE generated statement, not six hand-written ones, so no table can end
      // up counted with a different scope from its neighbours. The table name is
      // interpolated from the constant list above and can never come from input.
      const entries = await Promise.all(
        ADMIN_ACTIVITY_TABLES.map(async ({ key, table }) => {
          const n = await count(
            db,
            `SELECT COUNT(*) AS n FROM ${table} WHERE google_sub = ?`,
            googleSub,
          )
          return [key, n] as const
        }),
      )
      return Object.fromEntries(entries) as AdminActivity
    },

    pushDevices(googleSub) {
      return count(db, 'SELECT COUNT(*) AS n FROM push_subscriptions WHERE google_sub = ?', googleSub)
    },

    activeSessions(googleSub, now) {
      // "Active" is live, not merely present: a revoked or expired row is a
      // historical record of a session, not a device that can act today.
      return count(
        db,
        `SELECT COUNT(*) AS n
           FROM auth_sessions
          WHERE google_sub = ? AND revoked_at IS NULL AND expires_at > ?`,
        googleSub,
        now,
      )
    },

    async programme(googleSub) {
      try {
        const row = await db
          .prepare('SELECT revision, updated_at FROM programme_revisions WHERE google_sub = ?')
          .bind(googleSub)
          .first<{ revision: unknown; updated_at: unknown }>()

        // No row is a REAL answer: this account has never edited its programme
        // and reads the shared Foundation seed. It is not a gap in knowledge,
        // and reporting it as Unknown would be its own small lie.
        if (!row) return { status: 'seed' }

        const revision = row.revision
        const updatedAt = row.updated_at
        if (
          typeof revision !== 'number' ||
          !Number.isInteger(revision) ||
          revision < 1 ||
          typeof updatedAt !== 'number'
        ) {
          return { status: 'unknown' }
        }
        return { status: 'edited', revision, updatedAt }
      } catch {
        return { status: 'unknown' }
      }
    },

    async lastSweep(googleSub) {
      try {
        const row = await db
          .prepare(
            'SELECT MAX(claimed_at) AS at FROM notification_deliveries WHERE google_sub = ?',
          )
          .bind(googleSub)
          .first<{ at: unknown }>()
        const at = row?.at
        // MAX over no rows is SQL NULL — the ledger read fine and holds nothing.
        // That is `readable: true, at: null`, which classifyCron treats as "no
        // evidence", NOT as a failure.
        if (at === null || at === undefined) return { readable: true, at: null }
        if (typeof at !== 'number' || !Number.isFinite(at)) return { readable: false }
        return { readable: true, at }
      } catch {
        return { readable: false }
      }
    },
  }
}
