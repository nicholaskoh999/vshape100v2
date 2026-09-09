/**
 * The two Worker bindings the admin route test's import graph mentions.
 *
 * WHY THIS FILE EXISTS. `src/test/adminRoutes.test.ts` drives the REAL admin
 * handler, which reaches `worker/auth/config.ts` and the settings store, and
 * those name `D1Database` and `Fetcher` — globals that come from
 * `@cloudflare/workers-types` and belong to the WORKER project, not this one.
 *
 * Declared locally, and only the members those files call, for exactly the
 * reason src/test/nodeSqlite.d.ts gives: a test should not be the reason to
 * widen what a whole project can see. Adding the package to
 * tsconfig.app.json's `types` would put every Workers global — its own
 * `Request`, `Response`, `Headers` and `fetch` among them — into the React
 * app's program alongside the DOM's, which is a large change to make for one
 * test file.
 *
 * These shapes are NOT the contract. The worker project still typechecks the
 * same files against the real `@cloudflare/workers-types`, so this stub can
 * only ever be too narrow — and a stub that is too narrow fails the build
 * loudly rather than letting something wrong through.
 */

declare type D1Result<T = unknown> = {
  results: T[]
  success: boolean
  meta: Record<string, unknown>
}

declare type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
  run<T = unknown>(): Promise<D1Result<T>>
}

declare type D1Database = {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<{ count: number; duration: number }>
}

declare type Fetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}
