/**
 * Types for the Round 25 full-activity reset operator script.
 *
 * The script itself stays plain `.mjs` so plain Node can run it with no build
 * step and no loader — a release-stage tool that needed compiling before it
 * could be used would be a tool nobody runs. This declaration exists so the
 * operator-path test can drive it under the same type checking as everything
 * else.
 */

/**
 * Executes ONE command, which may contain several statements, and returns one
 * result set per statement in order.
 *
 * Implementations must be atomic across the whole command — that is the
 * property the destructive phase depends on.
 */
export type Round25Exec = (sql: string) => Promise<unknown[][]> | unknown[][]

/** Which acceptance conditions held after an execution. */
export type Round25Checks = {
  /** All nine reset tables are empty for the target account. */
  emptied: boolean
  /** No set, calibration or correction row survives without its occurrence. */
  noOrphans: boolean
  /** Every preserved domain reads byte-identically to before. */
  preserved: boolean
  /** Every other account's row counts are unchanged. */
  isolated: boolean
  /** `foundation_start_date` is exactly the approved date. */
  foundationSet: boolean
}

/**
 * What the run did.
 *
 * `before*` is absent only when the target itself was rejected, because nothing
 * — not even a count — is queried before the account and the date are known
 * good. `after*`, `orphans` and `accepted` appear only when a reset actually ran.
 */
export type Round25Result = {
  /** False when the run was refused. A refusal never writes. */
  ok: boolean
  /** True only when the destructive command was sent. */
  executed: boolean
  /** True only when every acceptance condition held. */
  accepted?: boolean
  checks?: Round25Checks
  /** Why it was refused, in operator-facing words. */
  reason?: string
  before?: number[]
  after?: number[]
  orphans?: number[]
  beforeMarks?: string[]
  afterMarks?: string[]
  beforeOthers?: number[]
  afterOthers?: number[]
  beforeFoundation?: string
  afterFoundation?: string
}

export function runRound25Reset(options: {
  argv: readonly string[]
  exec: Round25Exec
  log?: (message: string) => void
  now?: number
}): Promise<Round25Result>

/** The real transport: Wrangler against the local or the deployed database. */
export function wranglerExec(remote: boolean): (sql: string) => unknown[][]
