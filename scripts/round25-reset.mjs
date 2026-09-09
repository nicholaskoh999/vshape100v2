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
  ROUND25_FINGERPRINT_LABELS,
  ROUND25_INVENTORY_LABELS,
  ROUND25_ISOLATION_LABELS,
  ROUND25_ORPHAN_LABELS,
  parseRound25Target,
  renderStatement,
  round25FoundationCheck,
  round25Inventory,
  round25IsolationChecks,
  round25OrphanChecks,
  round25PreservedFingerprint,
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
  const fingerprintSql = join(round25PreservedFingerprint(target))
  const isolationSql = join(round25IsolationChecks(target))
  const foundationSql = renderStatement(round25FoundationCheck(target))

  log('')
  log(`  Round 25 — FULL ACTIVITY FRESH START — ${remote ? 'REMOTE' : 'local'} ${DATABASE}`)
  log(`  account          : ${target.googleSub}`)
  log(`  foundation start : ${target.foundationStart}  (the new Day 1)`)
  log('')

  // ALWAYS read first, whichever mode this is.
  const before = counts(await exec(inventorySql))
  const beforeMarks = marks(await exec(fingerprintSql))
  const beforeOthers = counts(await exec(isolationSql))
  const beforeFoundation = marks(await exec(foundationSql))[0]

  log('  WOULD BE EMPTIED (target account)')
  ROUND25_INVENTORY_LABELS.forEach((label, i) => log(`    ${label.padEnd(30)} ${before[i]}`))
  log('')
  log('  MUST NOT CHANGE (preserved domains)')
  ROUND25_FINGERPRINT_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${beforeMarks[i].slice(0, 72)}`),
  )
  log('')
  log('  MUST NOT CHANGE (every other account)')
  ROUND25_ISOLATION_LABELS.forEach((label, i) => log(`    ${label.padEnd(30)} ${beforeOthers[i]}`))
  log('')
  log(`  foundation_start_date (before)   ${beforeFoundation}`)
  log('')

  if (!execute) {
    log('  Inventory only. NOTHING was written. Re-run with the execution flags to reset.')
    log('')
    return { ok: true, executed: false, before, beforeMarks, beforeOthers, beforeFoundation }
  }

  const refuse = (reason) => ({
    ok: false,
    executed: false,
    before,
    beforeMarks,
    beforeOthers,
    beforeFoundation,
    reason,
  })

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

  // THE atomic boundary: nine deletes plus the Foundation write, all or nothing.
  await exec(round25Transaction(target, now))

  const after = counts(await exec(inventorySql))
  const afterMarks = marks(await exec(fingerprintSql))
  const afterOthers = counts(await exec(isolationSql))
  const afterFoundation = marks(await exec(foundationSql))[0]
  const orphans = counts(await exec(join(round25OrphanChecks())))

  log('  Done. After-proof:')
  log('')
  log('  EMPTIED')
  ROUND25_INVENTORY_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${after[i]}${after[i] === 0 ? '' : '   ✗ EXPECTED 0'}`),
  )
  log('')
  log('  ORPHANS')
  ROUND25_ORPHAN_LABELS.forEach((label, i) =>
    log(`    ${label.padEnd(30)} ${orphans[i]}${orphans[i] === 0 ? '' : '   ✗ EXPECTED 0'}`),
  )
  log('')
  log('  PRESERVED — before vs after')
  ROUND25_FINGERPRINT_LABELS.forEach((label, i) => {
    const same = beforeMarks[i] === afterMarks[i]
    log(`    ${label.padEnd(30)} ${same ? 'unchanged' : '✗ CHANGED'}`)
  })
  log('')
  log('  OTHER ACCOUNTS — before vs after')
  ROUND25_ISOLATION_LABELS.forEach((label, i) => {
    const same = beforeOthers[i] === afterOthers[i]
    log(`    ${label.padEnd(30)} ${same ? 'unchanged' : '✗ CHANGED'}`)
  })
  log('')
  log(`  foundation_start_date (after)    ${afterFoundation}`)
  log('')

  // The acceptance conditions, decided here rather than left to the reader.
  const emptied = after.every((n) => n === 0)
  const noOrphans = orphans.every((n) => n === 0)
  const preserved = beforeMarks.every((mark, i) => mark === afterMarks[i])
  const isolated = beforeOthers.every((n, i) => n === afterOthers[i])
  const foundationSet = afterFoundation === `1#${target.foundationStart}`
  const accepted = emptied && noOrphans && preserved && isolated && foundationSet

  log(accepted ? '  ✓ ALL ACCEPTANCE CONDITIONS MET' : '  ✗ ACCEPTANCE FAILED — see above')
  log('')

  return {
    ok: true,
    executed: true,
    accepted,
    checks: { emptied, noOrphans, preserved, isolated, foundationSet },
    before,
    after,
    orphans,
    beforeMarks,
    afterMarks,
    beforeOthers,
    afterOthers,
    beforeFoundation,
    afterFoundation,
  }
}

async function main() {
  const result = await runRound25Reset({
    argv: process.argv,
    exec: wranglerExec(process.argv.includes('--remote')),
  })
  if (!result.ok) {
    console.error(`\n  ✗ ${result.reason}\n`)
    process.exit(1)
  }
  if (result.executed && !result.accepted) process.exit(2)
}

// Only run when invoked directly, so importing this module for a test cannot
// execute anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
