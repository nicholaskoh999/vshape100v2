import { generateKeyPair, SignJWT, type CryptoKey } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  __setGoogleTestDoubles,
  buildAuthorizationUrl,
  exchangeCode,
  GoogleAuthError,
  verifyIdToken,
} from '../auth/google'

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
const NONCE = 'expected-nonce-value'

const discovery = {
  issuer: 'https://accounts.google.com',
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
}

let privateKey: CryptoKey
let publicKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  privateKey = pair.privateKey
  publicKey = pair.publicKey

  // Never reach the network in unit tests: pin discovery and the key set.
  __setGoogleTestDoubles({
    discovery,
    keySet: (async () => publicKey) as never,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

type Claims = Record<string, unknown>

async function signIdToken(claims: Claims = {}, options: { audience?: string; issuer?: string } = {}) {
  return new SignJWT({ nonce: NONCE, email: 'person@example.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(options.issuer ?? 'https://accounts.google.com')
    .setAudience(options.audience ?? CLIENT_ID)
    .setSubject((claims.sub as string) ?? 'google-sub-123')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

describe('authorization URL', () => {
  it('carries state, nonce and an S256 PKCE challenge', async () => {
    const url = new URL(
      await buildAuthorizationUrl({
        clientId: CLIENT_ID,
        redirectUri: 'https://app.example.com/api/auth/google/callback',
        state: 'state-value',
        nonce: NONCE,
        codeVerifier: 'verifier-value',
      }),
    )

    expect(url.origin + url.pathname).toBe(discovery.authorization_endpoint)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('state')).toBe('state-value')
    expect(url.searchParams.get('nonce')).toBe(NONCE)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    // The raw verifier must never travel in the front-channel.
    expect(url.toString()).not.toContain('verifier-value')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
  })
})

describe('verifyIdToken', () => {
  it('accepts a correctly signed token and extracts the identity', async () => {
    const idToken = await signIdToken({ name: 'Test Person', picture: 'https://img/p.png' })

    const identity = await verifyIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: NONCE })

    expect(identity.sub).toBe('google-sub-123')
    expect(identity.email).toBe('person@example.com')
    expect(identity.emailVerified).toBe(true)
    expect(identity.name).toBe('Test Person')
  })

  it('rejects a nonce mismatch', async () => {
    const idToken = await signIdToken({ nonce: 'a-different-nonce' })
    await expect(
      verifyIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: NONCE }),
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })

  it('rejects a token minted for another audience', async () => {
    const idToken = await signIdToken({}, { audience: 'someone-elses-client-id' })
    await expect(
      verifyIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: NONCE }),
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })

  it('rejects a token from the wrong issuer', async () => {
    const idToken = await signIdToken({}, { issuer: 'https://evil.example.com' })
    await expect(
      verifyIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: NONCE }),
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })

  it('rejects a token signed by an unknown key', async () => {
    const attacker = await generateKeyPair('RS256', { extractable: true })
    const idToken = await new SignJWT({ nonce: NONCE, email: 'person@example.com' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://accounts.google.com')
      .setAudience(CLIENT_ID)
      .setSubject('google-sub-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(attacker.privateKey)

    await expect(
      verifyIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: NONCE }),
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })

  it('rejects an expired token', async () => {
    const idToken = await new SignJWT({ nonce: NONCE, email: 'person@example.com' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://accounts.google.com')
      .setAudience(CLIENT_ID)
      .setSubject('google-sub-123')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey)

    await expect(
      verifyIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: NONCE }),
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })

  it('rejects a token whose email is unverified', async () => {
    const idToken = await signIdToken({ email_verified: false })
    await expect(
      verifyIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: NONCE }),
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })

  it('rejects a token with no email claim', async () => {
    const idToken = await new SignJWT({ nonce: NONCE })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://accounts.google.com')
      .setAudience(CLIENT_ID)
      .setSubject('google-sub-123')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(
      verifyIdToken({ idToken, clientId: CLIENT_ID, expectedNonce: NONCE }),
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })
})

describe('exchangeCode', () => {
  it('posts the PKCE verifier and returns only the id_token', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id_token: 'the-id-token', access_token: 'secret-access' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const idToken = await exchangeCode({
      code: 'auth-code',
      clientId: CLIENT_ID,
      clientSecret: 'client-secret',
      redirectUri: 'https://app.example.com/api/auth/google/callback',
      codeVerifier: 'verifier-value',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(idToken).toBe('the-id-token')

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = (init.body as URLSearchParams).toString()
    expect(body).toContain('code_verifier=verifier-value')
    expect(body).toContain('grant_type=authorization_code')
  })

  it('fails when Google rejects the exchange', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 400 }))
    await expect(
      exchangeCode({
        code: 'bad-code',
        clientId: CLIENT_ID,
        clientSecret: 'client-secret',
        redirectUri: 'https://app.example.com/api/auth/google/callback',
        codeVerifier: 'verifier-value',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(GoogleAuthError)
  })
})
