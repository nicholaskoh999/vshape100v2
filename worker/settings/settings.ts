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
  type AccountSettings,
} from '../../shared/settings'

export * from '../../shared/settings'

export interface SettingsStore {
  /** This account's settings, or null when it has never saved any. */
  find(googleSub: string): Promise<AccountSettings | null>
  /** Create or replace this account's settings. */
  save(googleSub: string, settings: AccountSettings, now: number): Promise<void>
}

/**
 * Read an account's settings.
 *
 * An account that has never saved reads as the empty settings rather than as an
 * error: "no preference" is a real answer, and the caller resolves it to the
 * legacy default through `effectiveFoundationStart`.
 */
export async function readSettings(
  store: SettingsStore,
  googleSub: string,
): Promise<AccountSettings> {
  return (await store.find(googleSub)) ?? EMPTY_ACCOUNT_SETTINGS
}

/**
 * Write an account's settings and return what was stored.
 *
 * The stored row is re-read rather than echoing what was sent, so the client
 * adopts persisted truth. A caller that believes its own payload would show a
 * value the database may not hold.
 */
export async function writeSettings(
  store: SettingsStore,
  googleSub: string,
  settings: AccountSettings,
  now: number = Date.now(),
): Promise<AccountSettings> {
  await store.save(googleSub, settings, now)
  return readSettings(store, googleSub)
}
