import { describe, expect, it } from 'vitest'

import { sha256Hex } from '../auth/crypto'
import {
  consumeOAuthState,
  createOAuthState,
  OAUTH_STATE_TTL_MS,
} from '../auth/oauthState'
import { createMemoryStateStore } from './memoryStores'

describe('oauth state', () => {
  it('stores only the hash of the state value', async () => {
    const { store, rows } = createMemoryStateStore()
    const { state } = await createOAuthState(store, { returnTo: '/today', trusted: false })

    const stored = [...rows.values()]
    expect(stored).toHaveLength(1)
    expect(stored[0].stateHash).toBe(await sha256Hex(state))
    expect(JSON.stringify(stored[0])).not.toContain(state)
  })

  it('issues distinct state, nonce and verifier', async () => {
    const { store } = createMemoryStateStore()
    const { state, nonce, codeVerifier } = await createOAuthState(
      store,
      { returnTo: '/today', trusted: false },
      Date.now(),
    )

    expect(new Set([state, nonce, codeVerifier]).size).toBe(3)
    for (const value of [state, nonce, codeVerifier]) {
      expect(value.length).toBeGreaterThanOrEqual(32)
    }
  })

  it('accepts a valid state exactly once', async () => {
    const { store } = createMemoryStateStore()
    const { state, nonce } = await createOAuthState(store, {
      returnTo: '/training/monday',
      trusted: true,
    })

    const first = await consumeOAuthState(store, state)
    expect(first.status).toBe('ok')
    if (first.status !== 'ok') return
    expect(first.record.nonce).toBe(nonce)
    expect(first.record.returnTo).toBe('/training/monday')
    expect(first.record.trusted).toBe(true)

    // Replay must fail: the record is gone.
    expect((await consumeOAuthState(store, state)).status).toBe('invalid')
  })

  it('rejects a missing state', async () => {
    const { store } = createMemoryStateStore()
    expect((await consumeOAuthState(store, null)).status).toBe('invalid')
    expect((await consumeOAuthState(store, '')).status).toBe('invalid')
  })

  it('rejects an unknown state', async () => {
    const { store } = createMemoryStateStore()
    await createOAuthState(store, { returnTo: '/today', trusted: false })
    expect((await consumeOAuthState(store, 'forged-state')).status).toBe('invalid')
  })

  it('rejects an expired state', async () => {
    const now = Date.UTC(2026, 8, 1)
    const { store } = createMemoryStateStore()
    const { state } = await createOAuthState(store, { returnTo: '/today', trusted: false }, now)

    const result = await consumeOAuthState(store, state, now + OAUTH_STATE_TTL_MS + 1)
    expect(result.status).toBe('expired')
  })

  it('never persists an unsafe return path', async () => {
    const { store } = createMemoryStateStore()
    const { state } = await createOAuthState(store, {
      returnTo: 'https://evil.example.com/steal',
      trusted: false,
    })

    const result = await consumeOAuthState(store, state)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.record.returnTo).toBe('/today')
  })

  it('drops expired rows on cleanup', async () => {
    const now = Date.UTC(2026, 8, 1)
    const { store, rows } = createMemoryStateStore()
    await createOAuthState(store, { returnTo: '/today', trusted: false }, now)

    await store.deleteExpired(now + OAUTH_STATE_TTL_MS + 1)
    expect(rows.size).toBe(0)
  })
})
