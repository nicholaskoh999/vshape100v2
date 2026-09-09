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

/**
 * What the database said when it was asked, before or after the attempt.
 *
 * The same shape both times, because the two readings are the same questions
 * asked twice — a difference can only be the database changing.
 */
export type Round25State = {
  /** Row counts for the nine reset tables, target account. */
  reset: number[]
  /** Stable preserved content, as `count#digest` marks. An acceptance condition. */
  stable: string[]
  /** Concurrently mutable tables. DIAGNOSTIC ONLY — never acceptance. */
  operational: number[]
  /** Row counts across the nine tables for every OTHER account. */
  others: number[]
  /** `count#value` for the stored Foundation start date. */
  foundation: string
  /** Orphan counts across the whole database. Compared, never required to be 0. */
  globalOrphans: number[]
  /** Orphan counts for the target account. Must be 0 afterwards. */
  targetOrphans: number[]
}

/**
 * What happened to the destructive command.
 *
 *   COMMITTED     — reconciliation proves the intended final state. Stands
 *                   whether or not the transport acknowledged, because it is a
 *                   statement about the state rather than about the send.
 *
 *   NOT_COMMITTED — reachable ONLY when the send was acknowledged and the
 *                   mutation still had no effect. A command that reports
 *                   success and changes nothing is a fault to investigate, not
 *                   permission to send it again.
 *
 *   AMBIGUOUS     — everything else, and in particular EVERY unacknowledged
 *                   send whose final state is not provably the intended one.
 *                   A post-state cannot tell "never deleted" from "deleted and
 *                   repopulated by concurrent writes", so matching counts prove
 *                   nothing there.
 *
 * No outcome is ever an instruction to re-run the destructive command.
 */
export type Round25Outcome = 'COMMITTED' | 'NOT_COMMITTED' | 'AMBIGUOUS'

/** Which acceptance conditions held. Separate from whether it committed. */
export type Round25Checks = {
  /** Every stable preserved domain reads byte-identically to before. */
  stablePreserved: boolean
  /** Every other account's row counts are unchanged. */
  isolated: boolean
  /** The target account owns no orphaned set, calibration or correction. */
  noTargetOrphans: boolean
  /** No orphan was CREATED anywhere; pre-existing ones are not blamed on this. */
  noNewOrphans: boolean
}

/**
 * What the run did.
 *
 * `before` is absent only when the target itself was rejected, because nothing
 * — not even a count — is queried before the account and the date are known
 * good. `attempts` is the number of times the destructive command was SENT: it
 * is 0 for every refusal and for inventory mode, and never exceeds 1.
 */
export type Round25Result = {
  /**
   * True only for a clean run: a refusal is false, and so is any executed run
   * that did not end COMMITTED. NOT_COMMITTED and AMBIGUOUS both need a human.
   */
  ok: boolean
  /** True only when the destructive command was sent. */
  executed: boolean
  /** How many times the destructive command was sent. Never more than 1. */
  attempts: number
  outcome?: Round25Outcome
  /** False when the database could not be read after the attempt. */
  reconciled?: boolean
  /** True only when it COMMITTED and every acceptance condition held. */
  accepted?: boolean
  /** The transport's error message, when it reported one. */
  transportError?: string | null
  /** Why reconciliation could not read the database. */
  readError?: string
  checks?: Round25Checks
  /** Why it was refused, in operator-facing words. */
  reason?: string
  before?: Round25State
  after?: Round25State
}

export function runRound25Reset(options: {
  argv: readonly string[]
  exec: Round25Exec
  log?: (message: string) => void
  now?: number
}): Promise<Round25Result>

/** The real transport: Wrangler against the local or the deployed database. */
export function wranglerExec(remote: boolean): (sql: string) => unknown[][]
