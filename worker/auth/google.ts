/**
 * Google OpenID Connect.
 *
 * Standards-compliant authorization-code + PKCE flow. Endpoints come from
 * Google's discovery document rather than being hardcoded, and the ID token
 * is verified against Google's JWKS — never trusted because it arrived over
 * the wire.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { pkceChallenge } from './crypto'

const DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration'

/** Google issues tokens under both spellings; both are legitimate. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

type Discovery = {
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  issuer: string
}

// Cached per isolate: discovery metadata is stable and this avoids a network
// round-trip on every sign-in.
let discoveryCache: Discovery | null = null
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

export async function getDiscovery(fetchImpl: typeof fetch = fetch): Promise<Discovery> {
  if (discoveryCache) return discoveryCache

  const response = await fetchImpl(DISCOVERY_URL)
  if (!response.ok) {
    throw new Error(`Google OIDC discovery failed with ${response.status}`)
  }

  const document = (await response.json()) as Discovery
  discoveryCache = document
  return document
}

function getJwks(jwksUri: string) {
  // createRemoteJWKSet does its own key caching and rotation handling.
  jwks ??= createRemoteJWKSet(new URL(jwksUri))
  return jwks
}

/** Test seam so unit tests never reach the network. */
export function __setGoogleTestDoubles(options: {
  discovery?: Discovery | null
  keySet?: ReturnType<typeof createRemoteJWKSet> | null
}) {
  if (options.discovery !== undefined) discoveryCache = options.discovery
  if (options.keySet !== undefined) jwks = options.keySet
}

export async function buildAuthorizationUrl(options: {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  codeVerifier: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const discovery = await getDiscovery(options.fetchImpl ?? fetch)
  const url = new URL(discovery.authorization_endpoint)

  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', options.state)
  url.searchParams.set('nonce', options.nonce)
  url.searchParams.set('code_challenge', await pkceChallenge(options.codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  // We never want a Google refresh token: the app owns its own session.
  url.searchParams.set('access_type', 'online')
  url.searchParams.set('prompt', 'select_account')

  return url.toString()
}

export type GoogleIdentity = {
  sub: string
  email: string
  emailVerified: boolean
  name: string | null
  picture: string | null
}

export class GoogleAuthError extends Error {}

/**
 * Exchange the authorization code for tokens.
 *
 * Only the ID token is used. The access token is deliberately discarded and
 * no refresh token is requested, so there is nothing Google-issued to store.
 */
export async function exchangeCode(options: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
  codeVerifier: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch
  const discovery = await getDiscovery(fetchImpl)

  const body = new URLSearchParams({
    code: options.code,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    redirect_uri: options.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: options.codeVerifier,
  })

  const response = await fetchImpl(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    throw new GoogleAuthError(`Token exchange failed with ${response.status}`)
  }

  const payload = (await response.json()) as { id_token?: string }
  if (!payload.id_token) {
    throw new GoogleAuthError('Token response did not contain an id_token')
  }

  return payload.id_token
}

/**
 * Verify an ID token and extract the identity.
 *
 * jwtVerify checks the signature against Google's JWKS plus issuer, audience
 * and expiry. Nonce and email claims are checked here on top of that.
 */
export async function verifyIdToken(options: {
  idToken: string
  clientId: string
  expectedNonce: string
  fetchImpl?: typeof fetch
}): Promise<GoogleIdentity> {
  const discovery = await getDiscovery(options.fetchImpl ?? fetch)

  let payload: JWTPayload
  try {
    const verified = await jwtVerify(options.idToken, getJwks(discovery.jwks_uri), {
      issuer: GOOGLE_ISSUERS,
      audience: options.clientId,
    })
    payload = verified.payload
  } catch (cause) {
    throw new GoogleAuthError('ID token verification failed', { cause })
  }

  if (typeof payload.nonce !== 'string' || payload.nonce !== options.expectedNonce) {
    throw new GoogleAuthError('ID token nonce mismatch')
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!sub) throw new GoogleAuthError('ID token is missing sub')

  const email = typeof payload.email === 'string' ? payload.email : ''
  if (!email) throw new GoogleAuthError('ID token is missing email')

  // Google exposes email_verified for Google accounts; require it when present.
  const emailVerified = payload.email_verified
  if (emailVerified !== undefined && emailVerified !== true) {
    throw new GoogleAuthError('Google email is not verified')
  }

  return {
    sub,
    email,
    emailVerified: emailVerified === true,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  }
}
