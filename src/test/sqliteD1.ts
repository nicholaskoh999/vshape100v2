import { DatabaseSync } from 'node:sqlite'

/**
 * A D1-shaped adapter over real SQLite.
 *
 * WHY THIS EXISTS RATHER THAN ANOTHER HAND-WRITTEN FAKE.
 *
 * Round 22's programme store makes its atomicity and concurrency guarantees IN
 * SQL: a compare-and-swap in the first statement of a batch, and a
 * `WHERE EXISTS (... write_token = ?)` guard on every statement after it. A
 * hand-written fake that pattern-matched those statements would be asserting
 * that the fake understood the guard, not that the guard works.
 *
 * So these tests run the REAL migration chain and the REAL store statements
 * against real SQLite. The CHECK constraints, the PRIMARY KEY, the UNIQUE on
 * (session, position), `ON CONFLICT DO NOTHING` and the guard subqueries all
 * behave as they will in production.
 *
 * WHAT IT DELIBERATELY MODELS
 *
 * `batch` runs its statements inside one transaction and rolls the whole thing
 * back if any statement throws, which is D1's contract. It also serialises:
 * D1 has a single writer, and two batches never interleave.
 *
 * WHAT IT IS NOT
 *
 * Not a D1 emulator. It implements exactly the surface the stores under test
 * use — prepare/bind/first/all/run/batch — and nothing else.
 */

export type SqliteD1 = {
  db: D1DatabaseLike
  raw: DatabaseSync
  close: () => void
}

/** The slice of the D1 surface the stores actually call. */
export type D1DatabaseLike = {
  prepare: (sql: string) => D1StatementLike
  batch: (statements: D1StatementLike[]) => Promise<D1ResultLike[]>
}

export type D1StatementLike = {
  bind: (...values: unknown[]) => D1StatementLike
  first: <T>() => Promise<T | null>
  all: <T>() => Promise<{ results: T[] }>
  run: () => Promise<D1ResultLike>
  /** Internal: used by batch to execute without its own transaction. */
  __exec: () => D1ResultLike
}

export type D1ResultLike = {
  results?: unknown[]
  success: boolean
  meta: { changes: number; last_row_id: number }
}

/** SQLite refuses a bound `undefined`; D1 treats a missing value as NULL. */
function normalise(values: unknown[]): unknown[] {
  return values.map((value) => {
    if (value === undefined) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    return value
  })
}

export function createSqliteD1(migrations: string[]): SqliteD1 {
  const raw = new DatabaseSync(':memory:')
  // The programme's cross-table guarantees assume the same enforcement
  // production has. Production reports PRAGMA foreign_keys = 1.
  raw.exec('PRAGMA foreign_keys = ON')

  for (const migration of migrations) {
    // Comment lines are stripped the way the accepted migration tests strip
    // them, so a `--` line containing a semicolon cannot split a statement.
    const sql = migration
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    raw.exec(sql)
  }

  function makeStatement(sql: string, bound: unknown[] = []): D1StatementLike {
    const statement: D1StatementLike = {
      bind(...values) {
        return makeStatement(sql, normalise(values))
      },
      async first<T>() {
        const row = raw.prepare(sql).get(...(bound as never[])) as T | undefined
        return row === undefined ? null : row
      },
      async all<T>() {
        const rows = raw.prepare(sql).all(...(bound as never[])) as T[]
        return { results: rows }
      },
      async run() {
        return statement.__exec()
      },
      __exec() {
        const prepared = raw.prepare(sql)
        // A statement that returns rows must be read with .all(); SQLite's
        // .run() would not surface them. Detected by trying and falling back,
        // rather than by parsing SQL.
        try {
          const info = prepared.run(...(bound as never[]))
          return {
            success: true,
            meta: {
              changes: Number(info.changes ?? 0),
              last_row_id: Number(info.lastInsertRowid ?? 0),
            },
          }
        } catch (error) {
          if (
            error instanceof Error &&
            /statement.*(return|does not return)|use.*all/i.test(error.message)
          ) {
            const rows = prepared.all(...(bound as never[]))
            return { success: true, results: rows, meta: { changes: 0, last_row_id: 0 } }
          }
          throw error
        }
      },
    }
    return statement
  }

  // D1 has a single writer: batches commit one at a time, never interleaved.
  // Modelled as a promise chain so a test can await two batches concurrently
  // and still get a deterministic winner.
  let queue: Promise<unknown> = Promise.resolve()

  const db: D1DatabaseLike = {
    prepare: (sql) => makeStatement(sql),
    batch(statements) {
      const run = queue.then(() => {
        raw.exec('BEGIN')
        try {
          const results = statements.map((statement) => statement.__exec())
          raw.exec('COMMIT')
          return results
        } catch (error) {
          raw.exec('ROLLBACK')
          throw error
        }
      })
      // Keep the chain alive even when this batch rejects, so one failed batch
      // does not wedge every later one.
      queue = run.catch(() => undefined)
      return run
    },
  }

  return { db, raw, close: () => raw.close() }
}
