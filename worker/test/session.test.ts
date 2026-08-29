import { describe, expect, it } from 'vitest'

import { sha256Hex } from '../auth/crypto'
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSession,
  readCookie,
  resolveSession,
  revokeSession,
  shouldRefresh,
  TRUSTED_SESSION_MS,
  UNTRUSTED_SESSION_MS,
} from '../auth/session'
import { createMemorySessionStore } from './memoryStores'

const identity = { googleSub: 'google-sub-1', email: 'person@example.com', trusted: false }
const DAY = 24 * 60 * 60 * 1000

describe('session storage', () => {
  it('stores only the hash of the session token', async () => {
    const { store, rows } = createMemorySessionStore()
    const { token } = await createSession(store, identity)

    const stored = [...rows.values()]
    expect(stored).toHaveLength(1)
    // The raw token must appear nowhere in the persisted record.
    expect(JSON.stringify(stored[0])).not.toContain(token)
    expect(stored[0].sessionHash).toBe(await sha256Hex(token))
  })

  it('gives a non-trusted session a 24 hour lifetime', async () => {
    const now = Date.UTC(2026, 8, 1)
    const { store } = createMemorySessionStore()
    const { record } = await createSession(store, { ...identity, trusted: false }, now)

    expect(record.expiresAt - now).toBe(UNTRUSTED_SESSION_MS)
    expect(record.expiresAt - now).toBe(DAY)
  })

  it('gives a trusted session a 30 day lifetime', async () => {
    const now = Date.UTC(2026, 8, 1)
    const { store } = createMemorySessionStore()
    const { record } = await createSession(store, { ...identity, trusted: true }, now)

    expect(record.expiresAt - now).toBe(TRUSTED_SESSION_MS)
    expect(record.expiresAt - now).toBe(30 * DAY)
  })
})

describe('resolveSession', () => {
  it('accepts a live session', async () => {
    const { store } = createMemorySessionStore()
    const { token } = await createSession(store, identity)

    const result = await resolveSession(store, token)
    expect(result.status).toBe('valid')
  })

  it('rejects a missing cookie', async () => {
    const { store } = createMemorySessionStore()
    expect((await resolveSession(store, null)).status).toBe('missing')
  })

  it('rejects an unknown token', async () => {
    const { store } = createMemorySessionStore()
    await createSession(store, identity)
    expect((await resolveSession(store, 'not-a-real-token')).status).toBe('missing')
  })

  it('enforces expiry', async () => {
    const now = Date.UTC(2026, 8, 1)
    const { store } = createMemorySessionStore()
    const { token } = await createSession(store, { ...identity, trusted: false }, now)

    expect((await resolveSession(store, token, now + DAY - 1000)).status).toBe('valid')
    expect((await resolveSession(store, token, now + DAY)).status).toBe('expired')
  })

  it('rejects a revoked session', async () => {
    const { store } = createMemorySessionStore()
    const { token } = await createSession(store, identity)

    await revokeSession(store, token)
    expect((await resolveSession(store, token)).status).toBe('revoked')
  })

  it('rolls a trusted session forward near expiry', async () => {
    const start = Date.UTC(2026, 8, 1)
    const { store } = createMemorySessionStore()
    const { token } = await createSession(store, { ...identity, trusted: true }, start)

    // 26 days in, only 4 days remain, so the session should extend.
    const later = start + 26 * DAY
    const result = await resolveSession(store, token, later)

    expect(result.status).toBe('valid')
    if (result.status !== 'valid') return
    expect(result.session.expiresAt).toBe(later + TRUSTED_SESSION_MS)
  })

  it('does not write on every request for a fresh trusted session', async () => {
    const start = Date.UTC(2026, 8, 1)
    const { store } = createMemorySessionStore()
    const { token, record } = await createSession(store, { ...identity, trusted: true }, start)

    const result = await resolveSession(store, token, start + DAY)
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') return
    // Untouched: expiry is unchanged one day in.
    expect(result.session.expiresAt).toBe(record.expiresAt)
  })

  it('never rolls a non-trusted session forward', async () => {
    const start = Date.UTC(2026, 8, 1)
    const { store } = createMemorySessionStore()
    const { record } = await createSession(store, { ...identity, trusted: false }, start)

    expect(shouldRefresh(record, start + 23 * 60 * 60 * 1000)).toBe(false)
  })
})

describe('session cookie', () => {
  it('is HttpOnly, SameSite=Lax and path-scoped', () => {
    const cookie = buildSessionCookie('token-value', 60_000, false)
    expect(cookie).toContain('vshape_session=token-value')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=60')
  })

  it('adds Secure only when the app origin is https', () => {
    expect(buildSessionCookie('t', 1000, true)).toContain('Secure')
    expect(buildSessionCookie('t', 1000, false)).not.toContain('Secure')
  })

  it('clears with an immediate expiry', () => {
    expect(buildClearedSessionCookie(true)).toContain('Max-Age=0')
  })

  it('reads its own cookie out of a shared header', () => {
    const header = 'other=1; vshape_session=abc123; another=2'
    expect(readCookie(header, 'vshape_session')).toBe('abc123')
    expect(readCookie(header, 'missing')).toBeNull()
    expect(readCookie(null, 'vshape_session')).toBeNull()
  })
})
