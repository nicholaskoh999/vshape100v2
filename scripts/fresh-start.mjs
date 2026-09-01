#!/usr/bin/env node
/**
 * Fresh Start operator script — RELEASE-STAGE ONLY.
 *
 * This is the thin, deliberate wrapper around shared/freshStart.ts. All of the
 * logic it runs is pure and separately tested against real SQLite; this file
 * only decides WHERE to run it and refuses to run it carelessly.
 *
 * It is intentionally NOT part of the Worker. There is no route, no endpoint and
 * no way to trigger this from the browser: a destructive reset behind a URL is
 * one authentication bug away from deleting someone's training history.
 *
 * SAFETY, IN THE ORDER IT APPLIES.
 *
 *   1. Inventory is the DEFAULT. Running with no mode flag reads and prints
 *      counts on both sides of the cutoff and writes nothing.
 *   2. The account is EXPLICIT. `--account` is required. There is no "the only
 *      account" and no "the latest session" — inferring whose history to delete
 *      is how the wrong person's gets deleted.
 *   3. The cutoff is EXPLICIT. `--cutoff` is required and must be a real date.
 *   4. Execution needs TWO deliberate flags: `--execute` and
 *      `--i-understand-this-deletes-history`, plus `--confirm-account` repeating
 *      the account key exactly. A single typo cannot delete anything.
 *   5. `--remote` is required to touch the deployed database. Without it every
 *      command runs against the LOCAL D1, so a half-remembered invocation
 *      cannot reach production.
 *   6. No account id, secret or token is embedded anywhere in this file.
 *
 * Intended release order, which this script supports but does not perform for
 * you: back up → inventory → execute → inventory again → orphan check.
 *
 * Usage:
 *   node scripts/fresh-start.mjs --account <google_sub> --cutoff 2026-09-01 [--remote]
 *   node scripts/fresh-start.mjs --account <google_sub> --cutoff 2026-09-01 --remote \
 *     --execute --i-understand-this-deletes-history --confirm-account <google_sub>
 */

import { execFileSync } from 'node:child_process'

import {
  FRESH_START_INVENTORY_LABELS,
  FRESH_START_ORPHAN_LABELS,
  freshStartInventory,
  freshStartOrphanChecks,
  freshStartStatements,
  parseFreshStartTarget,
} from '../shared/freshStart.ts'

const DATABASE = 'vshape100v2-auth'

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

function flag(name) {
  return process.argv.includes(`--${name}`)
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

/**
 * Run one statement through Wrangler.
 *
 * Parameters are passed with `--json` and bound by Wrangler, so no value is ever
 * interpolated into SQL text here.
 */
function run(statement, remote) {
  const args = [
    'wrangler',
    'd1',
    'execute',
    DATABASE,
    remote ? '--remote' : '--local',
    '--json',
    '--command',
    statement.sql,
  ]
  for (const param of statement.params) {
    args.push('--param', String(param))
  }
  const out = execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const start = out.indexOf('[')
  if (start === -1) throw new Error('unreadable wrangler output')
  return JSON.parse(out.slice(start))[0].results
}

function main() {
  const parsed = parseFreshStartTarget(arg('account'), arg('cutoff'))
  if (!parsed.ok) {
    fail(
      parsed.field === 'google_sub'
        ? '--account is required and must be the target account key. It is never inferred.'
        : '--cutoff is required and must be a real YYYY-MM-DD date.',
    )
  }
  const target = parsed.value
  const remote = flag('remote')
  const execute = flag('execute')

  console.log(`\n  Fresh Start — ${remote ? 'REMOTE' : 'local'} ${DATABASE}`)
  console.log(`  account : ${target.googleSub}`)
  console.log(`  cutoff  : ${target.cutoff}  (occurrences strictly BEFORE this are removed)\n`)

  // Always inventory first, whichever mode this is. An execution that was never
  // preceded by a count is an execution nobody approved.
  const counts = freshStartInventory(target).map((statement) => run(statement, remote)[0].n)
  FRESH_START_INVENTORY_LABELS.forEach((label, index) => {
    console.log(`  ${label.padEnd(28)} ${counts[index]}`)
  })

  if (!execute) {
    console.log('\n  Inventory only. Nothing was written. Re-run with --execute to delete.\n')
    return
  }

  // Two separate deliberate flags, plus the account typed a second time.
  if (!flag('i-understand-this-deletes-history')) {
    fail('--execute also requires --i-understand-this-deletes-history')
  }
  if (arg('confirm-account') !== target.googleSub) {
    fail('--confirm-account must repeat the same account key exactly')
  }

  console.log('\n  Deleting…')
  for (const statement of freshStartStatements(target)) {
    run(statement, remote)
  }

  console.log('  Done. After-proof:\n')
  const after = freshStartInventory(target).map((statement) => run(statement, remote)[0].n)
  FRESH_START_INVENTORY_LABELS.forEach((label, index) => {
    console.log(`  ${label.padEnd(28)} ${after[index]}`)
  })

  const orphans = freshStartOrphanChecks().map((statement) => run(statement, remote)[0].n)
  FRESH_START_ORPHAN_LABELS.forEach((label, index) => {
    console.log(`  ${label.padEnd(28)} ${orphans[index]}`)
  })
  console.log('')
}

main()
