#!/usr/bin/env node
/**
 * Fresh Start operator script — RELEASE-STAGE ONLY.
 *
 * This is the thin, deliberate wrapper around shared/freshStart.ts. All of the
 * SQL it runs is built there and separately tested; this file only decides WHERE
 * to run it and refuses to run it carelessly.
 *
 * It is intentionally NOT part of the Worker. There is no route, no endpoint and
 * no way to trigger this from the browser: a destructive reset behind a URL is
 * one authentication bug away from deleting someone's training history.
 *
 * ── THE ATOMIC BOUNDARY (Round 18 Correction 1) ──────────────────────────────
 *
 * The three deletes used to run as three separate Wrangler invocations. A
 * failure between them left an account HALF RESET: sets and calibration deleted,
 * the occurrences that owned them still present. There was no boundary at all.
 *
 * Two facts, both MEASURED against a local D1 rather than assumed:
 *
 *   1. D1 refuses explicit transaction control. `BEGIN IMMEDIATE` comes back
 *      with "To execute a transaction, please use the state.storage.transaction()
 *      ... APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements."
 *      So the transaction cannot be written by hand, and there is no Workers
 *      binding here to call that API through.
 *
 *   2. A MULTI-STATEMENT command is atomic. Three inserts whose last statement
 *      fails leave zero rows; a failure in the middle leaves the pre-existing
 *      rows untouched and adds none.
 *
 * The destructive phase is therefore exactly ONE `--command` containing all
 * three deletes in dependency order. The command is the boundary: it either
 * removes the whole pre-cutoff history or removes nothing.
 *
 * ── NO PARAMETER BINDING ─────────────────────────────────────────────────────
 *
 * `wrangler d1 execute` accepts only `--command` and `--file`. It has no
 * `--param`, so the previous version of this script could not have executed a
 * single statement. Values are rendered into the SQL by `renderStatement`, which
 * refuses anything outside a narrow allowlist — checked once when the target is
 * parsed and again when it is rendered.
 *
 * ── SAFETY, IN THE ORDER IT APPLIES ──────────────────────────────────────────
 *
 *   1. Inventory is the DEFAULT. No mode flag reads and prints counts on both
 *      sides of the cutoff and writes nothing.
 *   2. The account is EXPLICIT. There is no "the only account" and no "the
 *      latest session": inferring whose history to delete is how the wrong
 *      person's gets deleted.
 *   3. The cutoff is EXPLICIT and must be a real date.
 *   4. Execution needs `--execute` AND `--i-understand-this-deletes-history`,
 *      plus `--confirm-account` repeating the account key exactly.
 *   5. `--remote` is required to touch the deployed database. Without it every
 *      command runs against the LOCAL D1.
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
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  FRESH_START_INVENTORY_LABELS,
  FRESH_START_ORPHAN_LABELS,
  freshStartInventory,
  freshStartOrphanChecks,
  freshStartTransaction,
  parseFreshStartTarget,
  renderStatement,
} from '../shared/freshStart.ts'

const DATABASE = 'vshape100v2-auth'

/**
 * Wrangler's JS entry point, as a file path.
 *
 * Resolved by location rather than by `require.resolve`, because the package
 * does not export `bin/wrangler.js` as a public subpath — and resolved LAZILY,
 * because `import.meta.url` is not a file: URL under a bundler. The operator
 * path test imports this module, and only the real transport needs this path,
 * so computing it at load time would break the test for no benefit.
 */
function wranglerBin() {
  return fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
}

/**
 * Run one command — which may contain several statements — through Wrangler.
 *
 * Returns one result set per statement, in order. This is the ONLY place the
 * real database is reached, and it is injectable so the operator path above can
 * be exercised end to end against a disposable database in tests.
 */
export function wranglerExec(remote) {
  return (sql) => {
    const out = execFileSync(
      // Wrangler's JS entry point is run directly through THIS Node, rather than
      // through `npx`. Two reasons, both load-bearing:
      //
      //   - on Windows `npx` is a .cmd, and Node refuses to spawn .cmd/.bat
      //     without a shell (EINVAL)
      //   - a shell would re-parse this command line, and the SQL argument
      //     carries quotes and semicolons that must reach Wrangler untouched
      //
      // execFile with an argv array passes every argument through verbatim, so
      // there is no quoting layer to get wrong.
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

/**
 * The operator flow.
 *
 * Pure with respect to its inputs: everything that touches a database goes
 * through `exec`, and everything the operator sees goes through `log`. Returns a
 * summary so a caller — including a test — can assert on what happened rather
 * than scrape stdout.
 */
export async function runFreshStart({ argv, exec, log = console.log }) {
  const arg = (name) => {
    const index = argv.indexOf(`--${name}`)
    return index === -1 ? undefined : argv[index + 1]
  }
  const flag = (name) => argv.includes(`--${name}`)

  const parsed = parseFreshStartTarget(arg('account'), arg('cutoff'))
  if (!parsed.ok) {
    return {
      ok: false,
      executed: false,
      reason:
        parsed.field === 'google_sub'
          ? '--account is required and must be the target account key. It is never inferred.'
          : '--cutoff is required and must be a real YYYY-MM-DD date.',
    }
  }

  const target = parsed.value
  const remote = flag('remote')
  const execute = flag('execute')

  log('')
  log(`  Fresh Start — ${remote ? 'REMOTE' : 'local'} ${DATABASE}`)
  log(`  account : ${target.googleSub}`)
  log(`  cutoff  : ${target.cutoff}  (occurrences strictly BEFORE this are removed)`)
  log('')

  // Always inventory first, whichever mode this is. An execution that was never
  // preceded by a count is an execution nobody approved.
  const inventorySql = freshStartInventory(target).map(renderStatement).join(';\n')
  const before = counts(await exec(inventorySql))
  FRESH_START_INVENTORY_LABELS.forEach((label, index) => {
    log(`  ${label.padEnd(28)} ${before[index]}`)
  })

  if (!execute) {
    log('')
    log('  Inventory only. Nothing was written. Re-run with --execute to delete.')
    log('')
    return { ok: true, executed: false, before }
  }

  // Two separate deliberate flags, plus the account typed a second time. A
  // single typo cannot delete anything.
  if (!flag('i-understand-this-deletes-history')) {
    return {
      ok: false,
      executed: false,
      before,
      reason: '--execute also requires --i-understand-this-deletes-history',
    }
  }
  if (arg('confirm-account') !== target.googleSub) {
    return {
      ok: false,
      executed: false,
      before,
      reason: '--confirm-account must repeat the same account key exactly',
    }
  }

  log('')
  log('  Deleting, as ONE atomic command…')

  // THE atomic boundary: one command, three deletes, all or nothing.
  await exec(freshStartTransaction(target))

  log('  Done. After-proof:')
  log('')
  const after = counts(await exec(inventorySql))
  FRESH_START_INVENTORY_LABELS.forEach((label, index) => {
    log(`  ${label.padEnd(28)} ${after[index]}`)
  })

  const orphanSql = freshStartOrphanChecks().map(renderStatement).join(';\n')
  const orphans = counts(await exec(orphanSql))
  FRESH_START_ORPHAN_LABELS.forEach((label, index) => {
    log(`  ${label.padEnd(28)} ${orphans[index]}`)
  })
  log('')

  return { ok: true, executed: true, before, after, orphans }
}

async function main() {
  const result = await runFreshStart({
    argv: process.argv,
    exec: wranglerExec(process.argv.includes('--remote')),
  })
  if (!result.ok) {
    console.error(`\n  ✗ ${result.reason}\n`)
    process.exit(1)
  }
}

// Only run when invoked directly, so importing this module for a test cannot
// execute anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
