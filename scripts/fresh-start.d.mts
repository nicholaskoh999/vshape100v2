/**
 * Types for the Fresh Start operator script.
 *
 * The script itself stays plain `.mjs` so that plain Node can run it with no
 * build step and no loader — a release-stage tool that needed compiling before
 * it could be used would be a tool nobody runs. This declaration exists so the
 * operator-path test can drive it under the same type checking as everything
 * else.
 */

/**
 * Executes ONE command, which may contain several statements, and returns one
 * result set per statement in order.
 *
 * Implementations must be atomic across the whole command — that is the
 * property the destructive phase depends on. See the note on the atomic
 * boundary in fresh-start.mjs.
 */
export type FreshStartExec = (sql: string) => Promise<unknown[][]> | unknown[][]

/**
 * What the run did.
 *
 * `before` is absent only when the target itself was rejected, because nothing
 * — not even a count — is queried before the account and cutoff are known good.
 * `after` and `orphans` appear only when a deletion actually ran.
 */
export type FreshStartResult = {
  /** False when the run was refused. A refusal never writes. */
  ok: boolean
  /** True only when the destructive command was sent. */
  executed: boolean
  /** Why it was refused, in operator-facing words. */
  reason?: string
  before?: number[]
  after?: number[]
  orphans?: number[]
}

export function runFreshStart(options: {
  argv: readonly string[]
  exec: FreshStartExec
  log?: (message: string) => void
}): Promise<FreshStartResult>

/** The real transport: Wrangler against the local or the deployed database. */
export function wranglerExec(remote: boolean): (sql: string) => unknown[][]
