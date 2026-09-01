/**
 * Account settings rules.
 *
 * Thin by design: the vocabulary and validation live in shared/settings.ts,
 * which the React form uses too, and the storage boundary is an interface so
 * these rules can be tested without D1 — the same split auth, Today, media and
 * workouts use.
 *
 * There is no identity here. Every function takes the account key the caller
 * already resolved from the authenticated session.
 */

import {
  EMPTY_ACCOUNT_SETTINGS,
  readFoundationStart,
  type AccountSettings,
} from '../../shared/settings'

export * from '../../shared/settings'

/**
 * A row exactly as the database holds it.
 *
 * `foundationStartDate` is deliberately `unknown`. The store's job is to fetch,
 * not to judge: the column's GLOB constraint proves only the shape, so the value
 * has to be classified by the rules below rather than cast on the way out. A
 * store that returned a validated type would have had to decide what an
 * impossible date means, and that decision belongs in one place.
 */
export type StoredSettingsRow = { foundationStartDate: unknown }

export interface SettingsStore {
  /** This account's row as stored, or null when it has never saved any. */
  find(googleSub: string): Promise<StoredSettingsRow | null>
  /** Create or replace this account's settings. */
  save(googleSub: string, settings: AccountSettings, now: number): Promise<void>
}

/**
 * The outcome of a read.
 *
 * `unreadable` is a first-class answer, not an exception, because it is a
 * legitimate state of the data rather than a failure of the process.
 */
export type SettingsRead =
  | { status: 'ok'; settings: AccountSettings }
  | { status: 'unreadable' }

/**
 * Read an account's settings, refusing rather than guessing.
 *
 * Three outcomes, kept apart (Round 18 Correction 1):
 *
 *   no row / stored NULL → the empty settings. "No preference" is a real answer
 *                          and the client resolves it to the legacy default.
 *   a valid date         → that date.
 *   anything else        → `unreadable`. The caller must NOT substitute the
 *                          default: an impossible stored date presented as
 *                          2026-08-31 is a wrong day number wearing the
 *                          appearance of a right one.
 */
export async function readSettings(
  store: SettingsStore,
  googleSub: string,
): Promise<SettingsRead> {
  const row = await store.find(googleSub)
  if (!row) return { status: 'ok', settings: EMPTY_ACCOUNT_SETTINGS }

  const value = readFoundationStart(row.foundationStartDate)
  if (value.kind === 'unreadable') return { status: 'unreadable' }
  return {
    status: 'ok',
    settings: { foundationStartDate: value.kind === 'date' ? value.date : null },
  }
}

/**
 * Write an account's settings and return what was stored.
 *
 * The stored row is re-read rather than echoing what was sent, so the client
 * adopts persisted truth. A caller that believes its own payload would show a
 * value the database may not hold — including, after this correction, a value
 * the database turns out not to be able to express.
 */
export async function writeSettings(
  store: SettingsStore,
  googleSub: string,
  settings: AccountSettings,
  now: number = Date.now(),
): Promise<SettingsRead> {
  await store.save(googleSub, settings, now)
  return readSettings(store, googleSub)
}
