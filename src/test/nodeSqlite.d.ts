/**
 * The slice of `node:sqlite` the migration tests use.
 *
 * Declared locally rather than by adding `@types/node` to the app project's
 * ambient `types`, for exactly the reason src/test/sqlRaw.d.ts gives: a test
 * should not be the reason to widen what the whole app can see. Only the four
 * members the migration test actually calls are described.
 */
declare module 'node:sqlite' {
  export type SQLValue = string | number | bigint | null | Uint8Array

  export class StatementSync {
    run(...params: SQLValue[]): { changes: number; lastInsertRowid: number | bigint }
    get(...params: SQLValue[]): unknown
    all(...params: SQLValue[]): unknown[]
  }

  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
