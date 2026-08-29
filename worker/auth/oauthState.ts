/**
 * Short-lived OIDC transaction state.
 *
 * The `state` value handed to Google is random and opaque; only its hash is
 * stored. Records are single-use and expire quickly, which is what makes
 * CSRF and replay against the callback ineffective.
 */

import { randomToken, sha256Hex } from './crypto'
import { safeNextPath } from '../../shared/redirect'

/** Google round-trips typically take seconds; ten minutes is generous. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export type OAuthStateRecord = {
  stateHash: string
  nonce: string
  codeVerifier: string
  returnTo: string
  trusted: boolean
  createdAt: number
  expiresAt: number
}

export interface OAuthStateStore {
  insert(record: OAuthStateRecord): Promise<void>
  /**
   * Atomically fetch and delete. Single-use is enforced here so a replayed
   * callback finds nothing.
   */
  consume(stateHash: string): Promise<OAuthStateRecord | null>
  deleteExpired(now: number): Promise<void>
}

export async function createOAuthState(
  store: OAuthStateStore,
  input: { returnTo: string; trusted: boolean },
  now: number = Date.now(),
): Promise<{ state: string; nonce: string; codeVerifier: string }> {
  const state = randomToken(32)
  const nonce = randomToken(32)
  const codeVerifier = randomToken(32)

  await store.insert({
    stateHash: await sha256Hex(state),
    nonce,
    codeVerifier,
    returnTo: safeNextPath(input.returnTo),
    trusted: input.trusted,
    createdAt: now,
    expiresAt: now + OAUTH_STATE_TTL_MS,
  })

  return { state, nonce, codeVerifier }
}

export type OAuthStateResult =
  | { status: 'ok'; record: OAuthStateRecord }
  | { status: 'invalid' }
  | { status: 'expired' }

/**
 * Validate the `state` returned by Google. A missing, unknown, replayed or
 * expired state is rejected before any token exchange happens.
 */
export async function consumeOAuthState(
  store: OAuthStateStore,
  state: string | null | undefined,
  now: number = Date.now(),
): Promise<OAuthStateResult> {
  if (!state) return { status: 'invalid' }

  const record = await store.consume(await sha256Hex(state))
  if (!record) return { status: 'invalid' }
  if (record.expiresAt <= now) return { status: 'expired' }

  return { status: 'ok', record }
}
