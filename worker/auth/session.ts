/**
 * App-owned sessions.
 *
 * The browser only ever holds an opaque random token in an HttpOnly cookie.
 * The database only ever holds the SHA-256 hash of that token, so a database
 * read cannot be replayed as a login.
 */

import { randomToken, sha256Hex } from './crypto'

export const SESSION_COOKIE = 'vshape_session'

const DAY_MS = 24 * 60 * 60 * 1000

/** "Trust this device" — 30 days, rolling. */
export const TRUSTED_SESSION_MS = 30 * DAY_MS
/** Default — 24 hours, fixed expiry. */
export const UNTRUSTED_SESSION_MS = 1 * DAY_MS
/**
 * Only extend a trusted session once it is within this window of expiring.
 * Keeps rolling refresh working without a D1 write on every request.
 */
export const TRUSTED_REFRESH_THRESHOLD_MS = 7 * DAY_MS

export type SessionRecord = {
  sessionHash: string
  googleSub: string
  email: string
  name: string | null
  picture: string | null
  trusted: boolean
  createdAt: number
  lastSeenAt: number
  expiresAt: number
  revokedAt: number | null
}

export type NewSessionInput = {
  googleSub: string
  email: string
  name?: string | null
  picture?: string | null
  trusted: boolean
}

/**
 * Storage boundary. Keeping this an interface lets the auth rules be tested
 * directly, and keeps the D1 implementation thin and boring.
 */
export interface SessionStore {
  insert(record: SessionRecord): Promise<void>
  findByHash(sessionHash: string): Promise<SessionRecord | null>
  refresh(sessionHash: string, lastSeenAt: number, expiresAt: number): Promise<void>
  revoke(sessionHash: string, revokedAt: number): Promise<void>
}

export function sessionLifetimeMs(trusted: boolean): number {
  return trusted ? TRUSTED_SESSION_MS : UNTRUSTED_SESSION_MS
}

/**
 * Mint a session. Returns the raw token exactly once — it is never persisted
 * and never returned by any read path.
 */
export async function createSession(
  store: SessionStore,
  input: NewSessionInput,
  now: number = Date.now(),
): Promise<{ token: string; record: SessionRecord }> {
  const token = randomToken(32)
  const sessionHash = await sha256Hex(token)

  const record: SessionRecord = {
    sessionHash,
    googleSub: input.googleSub,
    email: input.email,
    name: input.name ?? null,
    picture: input.picture ?? null,
    trusted: input.trusted,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + sessionLifetimeMs(input.trusted),
    revokedAt: null,
  }

  await store.insert(record)
  return { token, record }
}

export type SessionLookup =
  | { status: 'valid'; session: SessionRecord }
  | { status: 'missing' }
  | { status: 'expired' }
  | { status: 'revoked' }

/**
 * Resolve a cookie token to a live session, applying rolling refresh for
 * trusted devices. This is the single authority the app trusts.
 */
export async function resolveSession(
  store: SessionStore,
  token: string | null | undefined,
  now: number = Date.now(),
): Promise<SessionLookup> {
  if (!token) return { status: 'missing' }

  const sessionHash = await sha256Hex(token)
  const session = await store.findByHash(sessionHash)
  if (!session) return { status: 'missing' }
  if (session.revokedAt !== null) return { status: 'revoked' }
  if (session.expiresAt <= now) return { status: 'expired' }

  if (shouldRefresh(session, now)) {
    const expiresAt = now + TRUSTED_SESSION_MS
    await store.refresh(sessionHash, now, expiresAt)
    return { status: 'valid', session: { ...session, lastSeenAt: now, expiresAt } }
  }

  return { status: 'valid', session }
}

/** Trusted sessions roll forward, but only near expiry to avoid hot writes. */
export function shouldRefresh(session: SessionRecord, now: number): boolean {
  if (!session.trusted) return false
  return session.expiresAt - now < TRUSTED_REFRESH_THRESHOLD_MS
}

export async function revokeSession(
  store: SessionStore,
  token: string | null | undefined,
  now: number = Date.now(),
): Promise<void> {
  if (!token) return
  await store.revoke(await sha256Hex(token), now)
}

/** The safe, minimal user object the frontend is allowed to see. */
export type PublicUser = {
  email: string
  name: string | null
  picture: string | null
}

export function toPublicUser(session: SessionRecord): PublicUser {
  return { email: session.email, name: session.name, picture: session.picture }
}

export function buildSessionCookie(
  token: string,
  maxAgeMs: number,
  secure: boolean,
): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildClearedSessionCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/** Minimal cookie parsing — we only ever need our own single cookie. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim() || null
    }
  }
  return null
}
