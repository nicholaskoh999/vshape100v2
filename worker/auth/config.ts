/**
 * Environment configuration for auth.
 *
 * Everything secret comes from Wrangler secrets / `.dev.vars` — never from
 * committed source. Missing configuration is a server-side error, surfaced to
 * the user only as a generic "couldn't complete sign-in".
 */

export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  ALLOWED_GOOGLE_EMAILS?: string
  APP_ORIGIN?: string
  /** VAPID public key, base64url. Public by design: browsers subscribe with it. */
  VAPID_PUBLIC_KEY?: string
  /** VAPID private key, base64url. SECRET. Never returned, never logged. */
  VAPID_PRIVATE_KEY?: string
  /** VAPID contact, `mailto:` or `https:` (RFC 8292). */
  VAPID_SUBJECT?: string
}

export type AuthConfig = {
  clientId: string
  clientSecret: string
  allowedEmails: string[]
  appOrigin: string
  redirectUri: string
  /** Secure cookies everywhere except plain-http local development. */
  secureCookies: boolean
}

export class ConfigError extends Error {}

/** Normalise an email for allowlist comparison. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Parse the comma-separated allowlist. Empty entries are ignored. */
export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(normaliseEmail)
    .filter((email) => email.length > 0)
}

/**
 * The allowlist is the whole authorisation model in Foundation: a verified
 * Google identity is only accepted if its email is explicitly listed.
 */
export function isAllowedEmail(email: string, allowed: string[]): boolean {
  if (allowed.length === 0) return false
  return allowed.includes(normaliseEmail(email))
}

/**
 * Whether session cookies must carry `Secure`.
 *
 * Resolved without requiring Google credentials, so the session and logout
 * routes keep working (and keep issuing consistent cookie attributes) even
 * when OAuth configuration is absent.
 */
export function resolveSecureCookies(env: Env, requestUrl: URL): boolean {
  const appOrigin = env.APP_ORIGIN?.trim()
  if (appOrigin) return appOrigin.startsWith('https://')
  return requestUrl.protocol === 'https:'
}

/**
 * Resolve config for a request. `APP_ORIGIN` is preferred so redirect URIs
 * stay stable and predictable; we fall back to the request origin for local
 * development convenience.
 */
export function loadConfig(env: Env, requestUrl: URL): AuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()

  if (!clientId) throw new ConfigError('GOOGLE_CLIENT_ID is not configured')
  if (!clientSecret) throw new ConfigError('GOOGLE_CLIENT_SECRET is not configured')

  const appOrigin = (env.APP_ORIGIN?.trim() || requestUrl.origin).replace(/\/+$/, '')
  const allowedEmails = parseAllowedEmails(env.ALLOWED_GOOGLE_EMAILS)

  if (allowedEmails.length === 0) {
    throw new ConfigError('ALLOWED_GOOGLE_EMAILS is not configured')
  }

  return {
    clientId,
    clientSecret,
    allowedEmails,
    appOrigin,
    redirectUri: `${appOrigin}/api/auth/google/callback`,
    secureCookies: appOrigin.startsWith('https://'),
  }
}
