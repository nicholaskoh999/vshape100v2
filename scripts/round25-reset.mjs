#!/usr/bin/env node
/**
 * Round 25 — FULL ACTIVITY FRESH START. Operator script. RELEASE-STAGE ONLY.
 *
 * A thin, deliberate wrapper around shared/round25Reset.ts. Every statement it
 * runs is built and separately tested there; this file only decides WHERE to run
 * them and refuses to run them carelessly.
 *
 * It is NOT part of the Worker. There is no route and no endpoint: a full reset
 * behind a URL is one authentication bug away from erasing somebody's training.
 *
 * Round 18's `fresh-start.mjs` is left exactly as it is. That tool deletes
 * history strictly before a cutoff; this one empties nine tables entirely for
 * one account. Two different operations, two different scripts, so neither can
 * be run believing it is the other.
 *
 * ── SAFETY, IN THE ORDER IT APPLIES ─────────────────────────────────────────
 *
 *   1. INVENTORY IS THE DEFAULT. With no mode flag this reads counts for all
 *      nine reset tables, fingerprints every preserved domain, and writes
 *      nothing. There is no code path from the default mode to a mutation.
 *   2. THE ACCOUNT IS EXPLICIT. Never inferred, never "the only one".
 *   3. THE FOUNDATION START IS EXPLICIT. Never inferred, never "today".
 *   4. EXECUTION NEEDS FOUR THINGS, not one:
 *        --execute
 *        --i-understand-this-deletes-all-activity
 *        --confirm-account <the same account key, again>
 *        --confirm-foundation-start <the same date, again>
 *      A single typo cannot delete anything, and neither confirmation can be
 *      satisfied by repeating the other.
 *   5. REMOTE IS EXPLICIT. Without --remote every command runs against the
 *      LOCAL D1. Reaching production is a thing you have to ask for.
 *   6. THE MUTATION IS ONE COMMAND. Nine deletes and the Foundation write, in
 *      dependency order, as a single atomic boundary.
 *   7. NO SECRET, ACCOUNT ID OR TOKEN IS EMBEDDED ANYWHERE IN THIS FILE.
 *
 * Intended release order, which this script supports but does not perform for
 * you: Time Travel bookmark → verified SQL export → inventory → execute →
 * after-proof → UI smoke.
 *
 * Usage:
 *   node scripts/round25-reset.mjs --account <google_sub> --foundation-start YYYY-MM-DD [--remote]
 *
 *   node scripts/round25-reset.mjs --account <google_sub> --foundation-start YYYY-MM-DD \
 *     --remote --execute --i-understand-this-deletes-all-activity \
 *     --confirm-account <google_sub> --confirm-foundation-start YYYY-MM-DD
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  ROUND25_INVENTORY_LABELS,
  ROUND25_ISOLATION_LABELS,
  ROUND25_OPERATIONAL_LABELS,
  ROUND25_ORPHAN_LABELS,
  ROUND25_STABLE_LABELS,
  parseRound25Target,
  renderStatement,
  round25FoundationCheck,
  round25Inventory,
  round25IsolationChecks,
  round25OperationalCounts,
  round25OrphanChecks,
  round25StableFingerprint,
  round25TargetOrphanChecks,
  round25Transaction,
} from '../shared/round25Reset.ts'

const DATABASE = 'vshape100v2-auth'

/** Wrangler's JS entry point, resolved lazily — see fresh-start.mjs. */
function wranglerBin() {
  return fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
}

/**
 * Run one command — which may contain several statements — through Wrangler.
 *
 * The ONLY place a real database is reached, and injectable, so the operator
 * path is exercised end to end against a disposable database in tests.
 */
export function wranglerExec(remote) {
  return (sql) => {
    const out = execFileSync(
      // Wrangler's entry point through THIS Node, not `npx`: on Windows `npx`
      // is a .cmd Node refuses to spawn without a shell, and a shell would
      // re-parse SQL that carries quotes and semicolons.
      process.execPath,
      [
        wranglerBin(),
        'd1',
        'execute',
        DATABASE,
        remote ? '--remote' : '--local',
        '--json',
        '--command',
        sql,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const start = out.indexOf('[')
    if (start === -1) throw new Error('unreadable wrangler output')
    return JSON.parse(out.slice(start)).map((entry) => entry.results)
  }
}

/** Read the single `n` out of each result set, in order. */
function counts(resultSets) {
  return resultSets.map((rows) => Number(rows?.[0]?.n ?? 0))
}

/** Read `n` and `v` — a count and its digest — out of each result set. */
function marks(resultSets) {
  return resultSets.map((rows) => `${Number(rows?.[0]?.n ?? 0)}#${String(rows?.[0]?.v ?? '')}`)
}

const join = (statements) => statements.map(renderStatement).join(';\n')

/**
 * The operator flow.
 *
 * Pure with respect to its inputs: everything touching a database goes through
 * `exec`, everything the operator sees goes through `log`. Returns a summary so
 * a caller — including a test — can assert on what happened rather than scrape
 * stdout.
 */
export async function runRound25Reset({ argv, exec, log = console.log, now = Date.now() }) {
  const arg = (name) => {
    const index = argv.indexOf(`--${name}`)
    return index === -1 ? undefined : argv[index + 1]
  }
  const flag = (name) => argv.includes(`--${name}`)

  const parsed = parseRound25Target(arg('account'), arg('foundation-start'))
  if (!parsed.ok) {
    return {
      ok: false,
      executed: false,
      attempts: 0,
      reason:
        parsed.field === 'google_sub'
          ? '--account is required and must be the target account key. It is never inferred.'
          : '--foundation-start is required and must be a real YYYY-MM-DD date. It is never inferred.',
    }
  }

  const target = parsed.value
  const remote = flag('remote')
  const execute = flag('execute')

  const inventorySql = join(round25Inventory(target))
  const stableSql = join(round25StableFingerprint(target))
  const operationalSql = join(round25OperationalCounts(target))
  const isolationSql = join(round25IsolationChecks(target))
  const foundationSql = renderStatement(round25FoundationCheck(target))
  const globalOrphanSql = join(round25OrphanChecks())
  const targetOrphanSql = join(round25TargetOrphanChecks(target))

  /**
   * Every read the reconciliation needs, in one place.
   *
   * Used for the BEFORE reading and again for the AFTER reading, so the two are
   * the same questions asked twice — a difference can only be the database
   * changing, never the query changing.
   */
  const readState = async () => ({
    reset: counts(await exec(inventorySql)),
    stable: marks(await exec(stableSql)),
    operational: counts(await exec(operationalSql)),
    others: counts(await exec(isolationSql)),
    foundation: marks(await exec(foundationSql))[0],
    globalOrphans: counts(await exec(globalOrphanSql)),
    targetOrphans: counts(await exec(targetOrphanSql)),
  })

  log('')
  log(`  Round 25 — FULL ACTIVITY FRESH START — ${remote ? 'REMOTE' : 'local'} ${DATABASE}`)
  log(`  account          : ${target.googleSub}`)
  log(`  foundation start : ${target.foundationStart}  (the new Day 1)`)
  log('')

  // ALWAYS read first, whichever mode this is.
  const before = await readState()

  log('  WOULD BE EMPTIED (target account)')
  ROUND25_INVENTORY_LABELS.forEach((label, i) => log(`    ${label.padEnd(30)} ${before.reset[i]}`))
  log('')
  log('  MUST NOT CHANGE — stable preserved content (an acceptance condition)')
  ROUND25_STABLE_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${before.stable[i].slice(0, 72)}`),
  )
  log('')
  log('  DIAGNOSTIC ONLY — concurrently mutable, never an acceptance condition')
  ROUND25_OPERATIONAL_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${before.operational[i]}`),
  )
  log('')
  log('  MUST NOT CHANGE (every other account)')
  ROUND25_ISOLATION_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${before.others[i]}`),
  )
  log('')
  log('  ORPHANS (pre-existing, so a reset is never blamed for them)')
  ROUND25_ORPHAN_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} global ${before.globalOrphans[i]}   target ${before.targetOrphans[i]}`),
  )
  log('')
  log(`  foundation_start_date (before)   ${before.foundation}`)
  log('')

  if (!execute) {
    log('  Inventory only. NOTHING was written. Re-run with the execution flags to reset.')
    log('')
    return { ok: true, executed: false, attempts: 0, before }
  }

  const refuse = (reason) => ({ ok: false, executed: false, attempts: 0, before, reason })

  // Four deliberate confirmations. Each one is independently necessary.
  if (!flag('i-understand-this-deletes-all-activity')) {
    return refuse('--execute also requires --i-understand-this-deletes-all-activity')
  }
  if (arg('confirm-account') !== target.googleSub) {
    return refuse('--confirm-account must repeat the same account key exactly')
  }
  if (arg('confirm-foundation-start') !== target.foundationStart) {
    return refuse('--confirm-foundation-start must repeat the same date exactly')
  }

  log('  Resetting, as ONE atomic command…')

  /*
   * ── THE DESTRUCTIVE COMMAND IS SENT EXACTLY ONCE ────────────────────────────
   *
   * Round 25 correction (Blocker A). Previously a transport error propagated out
   * of this function, so an operator who saw a failure could not tell whether
   * the reset had happened — and the obvious next move, running it again, is
   * catastrophic if it did.
   *
   * D1 can durably commit and STILL fail to acknowledge: a dropped connection, a
   * killed Wrangler process, a gateway timeout. An error here means "the outcome
   * is unknown", never "nothing happened".
   *
   * So: one attempt, counted. Whatever it does, the error is caught and the
   * database is ASKED what state it is in. There is no loop, no retry and no
   * second call site — `round25Transaction` is invoked on exactly this line and
   * nowhere else in this file.
   */
  let attempts = 0
  let transportError = null
  try {
    attempts += 1
    await exec(round25Transaction(target, now))
  } catch (error) {
    transportError = error instanceof Error ? error.message : String(error)
    log('')
    log(`  ✗ The mutation did not acknowledge: ${transportError}`)
    log('    This does NOT mean it did not happen. Reconciling by reading…')
  }

  /*
   * ── RECONCILIATION IS READ-ONLY, AND MAY ITSELF FAIL ───────────────────────
   *
   * If the database cannot even be read, nothing can be concluded and saying so
   * is the only honest answer. AMBIGUOUS is a real outcome, not a failure to
   * decide one.
   */
  let after = null
  let readError = null
  try {
    after = await readState()
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error)
  }

  if (after === null) {
    log('')
    log(`  ✗ Reconciliation could not read the database: ${readError}`)
    log('    OUTCOME: AMBIGUOUS. The reset may or may not have been applied.')
    log('    DO NOT re-run this command. Restore from the Time Travel bookmark,')
    log('    or read the nine tables by hand before deciding anything.')
    log('')
    return {
      ok: false,
      executed: true,
      attempts,
      outcome: 'AMBIGUOUS',
      reconciled: false,
      accepted: false,
      transportError,
      readError,
      before,
      reason: 'reconciliation could not read the database; the outcome is unknown',
    }
  }

  /*
   * ── CLASSIFYING WHAT THE DATABASE SAYS ─────────────────────────────────────
   *
   * Two positive proofs, and an honest gap between them.
   *
   *   COMMITTED     — the intended final state is there: nine tables empty for
   *                   the account, and the Foundation date is the approved one.
   *   NOT_COMMITTED — the state before the attempt is still there, unchanged.
   *   AMBIGUOUS     — neither, which includes every partial state.
   *
   * When an account was already empty and already carried the new date, both
   * proofs hold at once. COMMITTED wins, because the final state IS the
   * intended one and that is what the operator needs to know.
   */
  const resetApplied =
    after.reset.every((n) => n === 0) && after.foundation === `1#${target.foundationStart}`
  const resetUntouched =
    after.reset.every((n, i) => n === before.reset[i]) && after.foundation === before.foundation

  const outcome = resetApplied ? 'COMMITTED' : resetUntouched ? 'NOT_COMMITTED' : 'AMBIGUOUS'

  // Acceptance is a stricter question than "did it commit".
  const stablePreserved = before.stable.every((mark, i) => mark === after.stable[i])
  const isolated = before.others.every((n, i) => n === after.others[i])
  const noTargetOrphans = after.targetOrphans.every((n) => n === 0)
  // No NEW orphan. Pre-existing ones belong to whatever wrote them, and must
  // not fail a reset that did not create them.
  const noNewOrphans = after.globalOrphans.every((n, i) => n <= before.globalOrphans[i])
  const accepted =
    outcome === 'COMMITTED' && stablePreserved && isolated && noTargetOrphans && noNewOrphans

  log('')
  log(`  OUTCOME: ${outcome}${transportError ? '  (the transport reported an error)' : ''}`)
  log('')
  log('  EMPTIED')
  ROUND25_INVENTORY_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${after.reset[i]}${after.reset[i] === 0 ? '' : '   ✗ EXPECTED 0'}`),
  )
  log('')
  log('  ORPHANS')
  ROUND25_ORPHAN_LABELS.forEach((label, i) =>
    log(
      `    ${label.padEnd(30)} target ${after.targetOrphans[i]}` +
        `${after.targetOrphans[i] === 0 ? '' : ' ✗ EXPECTED 0'}` +
        `   global ${before.globalOrphans[i]} → ${after.globalOrphans[i]}` +
        `${after.globalOrphans[i] <= before.globalOrphans[i] ? '' : ' ✗ NEW ORPHAN'}`,
    ),
  )
  log('')
  log('  STABLE PRESERVED — before vs after (an acceptance condition)')
  ROUND25_STABLE_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${before.stable[i] === after.stable[i] ? 'unchanged' : '✗ CHANGED'}`),
  )
  log('')
  log('  OPERATIONAL — diagnostic only; these move on their own')
  ROUND25_OPERATIONAL_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${before.operational[i]} → ${after.operational[i]}`),
  )
  log('')
  log('  OTHER ACCOUNTS — before vs after')
  ROUND25_ISOLATION_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${before.others[i] === after.others[i] ? 'unchanged' : '✗ CHANGED'}`),
  )
  log('')
  log(`  foundation_start_date            ${before.foundation} → ${after.foundation}`)
  log('')

  if (outcome === 'AMBIGUOUS') {
    log('  ✗ AMBIGUOUS. The database is in neither the old state nor the intended one.')
    log('    DO NOT re-run this command. Restore from the Time Travel bookmark.')
  } else if (outcome === 'NOT_COMMITTED') {
    log('  ✓ NOT COMMITTED. Nothing was changed; the account is exactly as it was.')
    log('    Safe to investigate and try again once the transport is healthy.')
  } else {
    log(accepted ? '  ✓ COMMITTED — ALL ACCEPTANCE CONDITIONS MET' : '  ✗ COMMITTED, BUT ACCEPTANCE FAILED — see above')
  }
  log('')

  return {
    ok: outcome !== 'AMBIGUOUS',
    executed: true,
    attempts,
    outcome,
    reconciled: true,
    accepted,
    transportError,
    checks: { stablePreserved, isolated, noTargetOrphans, noNewOrphans },
    before,
    after,
  }
}

async function main() {
  const result = await runRound25Reset({
    argv: process.argv,
    exec: wranglerExec(process.argv.includes('--remote')),
  })
  if (!result.ok) {
    if (result.reason) console.error(`\n  ✗ ${result.reason}\n`)
    // 3 is reserved for "the outcome is unknown" — a different problem from a
    // refusal, and the one that must never be answered by running this again.
    process.exit(result.outcome === 'AMBIGUOUS' ? 3 : 1)
  }
  if (result.executed && !result.accepted) process.exit(2)
}

// Only run when invoked directly, so importing this module for a test cannot
// execute anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
