/**
 * Auth HTTP surface.
 *
 *   GET  /api/auth/google/start     begin the OIDC flow
 *   GET  /api/auth/google/callback  verify identity, mint the app session
 *   GET  /api/auth/session          who am I (authoritative)
 *   POST /api/auth/logout           revoke this device's session
 */

import { safeNextPath } from '../../shared/redirect'
import { isAllowedEmail, loadConfig, resolveSecureCookies, type Env } from './config'
import { createD1OAuthStateStore, createD1SessionStore } from './d1Stores'
import {
  buildAuthorizationUrl,
  exchangeCode,
  GoogleAuthError,
  verifyIdToken,
} from './google'
import { consumeOAuthState, createOAuthState } from './oauthState'
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSession,
  readCookie,
  resolveSession,
  revokeSession,
  sessionLifetimeMs,
  SESSION_COOKIE,
  toPublicUser,
} from './session'

/**
 * Login-screen error codes. Deliberately coarse: the user gets a calm,
 * actionable message and never an internal detail.
 */
export type LoginErrorCode = 'unauthorized' | 'expired' | 'failed'

function redirectTo(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } })
}

function loginRedirect(
  origin: string,
  code: LoginErrorCode,
  next?: string,
  headers: HeadersInit = {},
): Response {
  const url = new URL('/login', origin)
  url.searchParams.set('error', code)
  if (next && next !== '/today') url.searchParams.set('next', next)
  return redirectTo(url.toString(), headers)
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Session state must never be cached by a proxy or the browser.
      'Cache-Control': 'no-store',
      ...(init.headers ?? {}),
    },
  })
}

/** GET /api/auth/google/start */
export async function handleStart(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const config = loadConfig(env, url)

  const returnTo = safeNextPath(url.searchParams.get('next'))
  const trusted = url.searchParams.get('trust') === '1'

  const stateStore = createD1OAuthStateStore(env.DB)
  const now = Date.now()

  // Opportunistic cleanup; the table is tiny and short-lived by design.
  await stateStore.deleteExpired(now)

  const { state, nonce, codeVerifier } = await createOAuthState(
    stateStore,
    { returnTo, trusted },
    now,
  )

  const authorizationUrl = await buildAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
    nonce,
    codeVerifier,
  })

  return redirectTo(authorizationUrl, { 'Cache-Control': 'no-store' })
}

/** GET /api/auth/google/callback */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const config = loadConfig(env, url)
  const stateStore = createD1OAuthStateStore(env.DB)

  // Google reports user-side failures (e.g. consent denied) via `error`.
  if (url.searchParams.get('error')) {
    return loginRedirect(config.appOrigin, 'failed')
  }

  const stateResult = await consumeOAuthState(stateStore, url.searchParams.get('state'))
  if (stateResult.status === 'expired') {
    return loginRedirect(config.appOrigin, 'expired')
  }
  if (stateResult.status !== 'ok') {
    return loginRedirect(config.appOrigin, 'failed')
  }

  const stateRecord = stateResult.record
  const code = url.searchParams.get('code')
  if (!code) {
    return loginRedirect(config.appOrigin, 'failed', stateRecord.returnTo)
  }

  let identity
  try {
    const idToken = await exchangeCode({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      codeVerifier: stateRecord.codeVerifier,
    })

    identity = await verifyIdToken({
      idToken,
      clientId: config.clientId,
      expectedNonce: stateRecord.nonce,
    })
  } catch (error) {
    if (!(error instanceof GoogleAuthError)) throw error
    return loginRedirect(config.appOrigin, 'failed', stateRecord.returnTo)
  }

  if (!isAllowedEmail(identity.email, config.allowedEmails)) {
    return loginRedirect(config.appOrigin, 'unauthorized', stateRecord.returnTo)
  }

  const { token } = await createSession(createD1SessionStore(env.DB), {
    googleSub: identity.sub,
    email: identity.email,
    name: identity.name,
    picture: identity.picture,
    trusted: stateRecord.trusted,
  })

  const cookie = buildSessionCookie(
    token,
    sessionLifetimeMs(stateRecord.trusted),
    config.secureCookies,
  )

  return redirectTo(new URL(stateRecord.returnTo, config.appOrigin).toString(), {
    'Set-Cookie': cookie,
    'Cache-Control': 'no-store',
  })
}

/** GET /api/auth/session — the authoritative answer to "am I signed in?" */
export async function handleSession(request: Request, env: Env): Promise<Response> {
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  const secure = resolveSecureCookies(env, new URL(request.url))
  const result = await resolveSession(createD1SessionStore(env.DB), token)

  if (result.status !== 'valid') {
    // Clear a cookie that can no longer authenticate, so the browser stops
    // sending it and the login screen can explain an expiry.
    const headers: HeadersInit = token
      ? { 'Set-Cookie': buildClearedSessionCookie(secure) }
      : {}
    return json(
      { authenticated: false, reason: result.status === 'missing' ? null : result.status },
      { headers },
    )
  }

  // A trusted session that just rolled forward needs its cookie re-issued
  // with a matching Max-Age — otherwise the browser would drop the cookie at
  // the original expiry even though the session is still live in D1. The same
  // opaque token is reused, so nothing else about the session changes.
  const headers: HeadersInit = result.refreshed
    ? {
        'Set-Cookie': buildSessionCookie(
          token as string,
          sessionLifetimeMs(result.session.trusted),
          secure,
        ),
      }
    : {}

  return json({ authenticated: true, user: toPublicUser(result.session) }, { headers })
}

/** POST /api/auth/logout — revoke this device only. */
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, { status: 405 })
  }

  // Same-origin check: a cross-site POST must not be able to log the user out.
  const requestUrl = new URL(request.url)
  const origin = request.headers.get('Origin')
  if (origin && origin !== requestUrl.origin) {
    return json({ error: 'forbidden' }, { status: 403 })
  }

  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  await revokeSession(createD1SessionStore(env.DB), token)

  return json(
    { authenticated: false },
    {
      headers: {
        'Set-Cookie': buildClearedSessionCookie(resolveSecureCookies(env, requestUrl)),
      },
    },
  )
}

/**
 * Route the auth API. Returns null when the request is not ours, so the
 * Worker can fall through to static assets.
 */
export async function handleAuthRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith('/api/auth/')) return null

  try {
    switch (pathname) {
      case '/api/auth/google/start':
        return await handleStart(request, env)
      case '/api/auth/google/callback':
        return await handleCallback(request, env)
      case '/api/auth/session':
        return await handleSession(request, env)
      case '/api/auth/logout':
        return await handleLogout(request, env)
      default:
        return json({ error: 'not_found' }, { status: 404 })
    }
  } catch (error) {
    // Never leak configuration or stack details to the browser.
    console.error('auth request failed', error)

    // Misconfiguration and upstream failures look the same to the user: the
    // login screen simply offers another attempt.
    if (pathname.startsWith('/api/auth/google/')) {
      const origin = env.APP_ORIGIN?.trim() || new URL(request.url).origin
      return loginRedirect(origin, 'failed')
    }

    return json({ error: 'server_error' }, { status: 500 })
  }
}
