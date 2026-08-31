/**
 * Push subscription contract and validation.
 *
 * Shared by the Worker (which decides what may be stored) and the browser
 * (which must not offer to save something the server will reject), following
 * shared/holiday.ts and shared/workoutLog.ts.
 *
 * ## A subscription belongs to a device, not to an account
 *
 * Notification permission and a PushSubscription live in one browser profile.
 * An account can hold several, and enabling or disabling one must never speak
 * for the others — "notifications are on" is not a property a person has, it
 * is a property this browser has.
 *
 * ## The timezone is load-bearing
 *
 * The accepted schedule is local-clock: 20:30 means 20:30 where the person is.
 * The server has no other way to know that, so the device reports its IANA
 * zone and the scheduler converts into it. A subscription whose zone is
 * missing or unusable is NOT eligible for delivery — it fails closed rather
 * than guessing a zone and buzzing at the wrong hour.
 */

import { isIanaTimeZone, MAX_TIMEZONE_LENGTH } from '../timeZone'

// Re-exported so existing importers of this module keep working unchanged.
// The definition itself now lives in shared/timeZone.ts, because Round 15's
// body-weight dates need the same truth and must not carry a second copy.
export { isIanaTimeZone, MAX_TIMEZONE_LENGTH }

/** Longest push endpoint accepted. Real endpoints are far shorter. */
export const MAX_ENDPOINT_LENGTH = 1024
/** Longest base64url key material accepted. */
export const MAX_KEY_LENGTH = 256

/** What the browser sends when enabling reminders on this device. */
export type PushSubscriptionInput = {
  endpoint: string
  p256dh: string
  auth: string
  /** IANA zone, e.g. 'Asia/Kuala_Lumpur'. */
  timezone: string
}

export type SubscriptionField = 'body' | 'endpoint' | 'p256dh' | 'auth' | 'timezone'

export type ParsedSubscription =
  | { ok: true; value: PushSubscriptionInput }
  | { ok: false; field: SubscriptionField }

/** base64url only. Rejects padding, whitespace and anything exotic. */
function isBase64Url(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  )
}

/** Decoded byte length, or null when the value is not decodable base64url. */
function decodedLength(value: string): number | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)).length
  } catch {
    return null
  }
}

/** The first decoded byte, or null. */
function firstByte(value: string): number | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    return decoded.length > 0 ? decoded.charCodeAt(0) : null
  } catch {
    return null
  }
}

/** An uncompressed P-256 point: 65 bytes beginning with 0x04. */
export const P256DH_BYTES = 65
/** The Web Push auth secret is exactly 16 bytes. */
export const AUTH_BYTES = 16

/**
 * Is this a real subscription public key?
 *
 * Shape is checked, not merely non-emptiness. Key material that cannot be a
 * P-256 point will fail at encryption time anyway, so refusing it at the door
 * keeps unusable rows out of D1 and out of every future scheduled sweep.
 */
export function isP256dhKey(value: unknown, maxLength = MAX_KEY_LENGTH): value is string {
  if (!isBase64Url(value, maxLength)) return false
  if (decodedLength(value) !== P256DH_BYTES) return false
  // 0x04 marks an uncompressed point; anything else is not what Web Push uses.
  return firstByte(value) === 0x04
}

/** Is this a real 16-byte auth secret? */
export function isAuthSecret(value: unknown, maxLength = MAX_KEY_LENGTH): value is string {
  if (!isBase64Url(value, maxLength)) return false
  return decodedLength(value) === AUTH_BYTES
}

/**
 * A push endpoint must be an absolute HTTPS URL.
 *
 * HTTP is refused outright: the encrypted payload is only as private as the
 * transport carrying it, and a non-HTTPS endpoint is not a real push service.
 */
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** Validate the body of an enable/reconcile request. */
export function parseSubscriptionInput(body: unknown): ParsedSubscription {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' }
  }
  const raw = body as Record<string, unknown>

  if (!isPushEndpoint(raw.endpoint)) return { ok: false, field: 'endpoint' }
  // Shape-checked, not just present: unusable key material can never be
  // encrypted to, so it must not reach storage.
  if (!isP256dhKey(raw.p256dh)) return { ok: false, field: 'p256dh' }
  if (!isAuthSecret(raw.auth)) return { ok: false, field: 'auth' }
  if (!isIanaTimeZone(raw.timezone)) return { ok: false, field: 'timezone' }

  return {
    ok: true,
    value: {
      endpoint: raw.endpoint,
      p256dh: raw.p256dh,
      auth: raw.auth,
      timezone: raw.timezone,
    },
  }
}

/**
 * A stable lookup id for an endpoint.
 *
 * Hashing means the unique index does not span a long URL, and it gives the
 * server a way to talk about "this browser" in logs and queries without
 * handling the endpoint itself.
 */
export async function hashEndpoint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------------------------------------------ */
/* Local time                                                          */
/* ------------------------------------------------------------------ */

/**
 * An instant, as the wall clock reads in a given zone.
 *
 * Returns a Date whose LOCAL getters (getHours, getDay, getFullYear…) report
 * the target zone's wall clock. That is precisely what the Today engine wants:
 * it works in local calendar parts throughout and never inspects an offset.
 *
 * Returns null for a zone the platform does not recognise, so a caller must
 * decide what to do rather than silently landing in UTC.
 */
export function wallClockIn(instant: Date, timeZone: string): Date | null {
  if (!isIanaTimeZone(timeZone)) return null

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant)

    const read = (type: string) => {
      const found = parts.find((part) => part.type === type)
      return found ? Number(found.value) : NaN
    }

    const year = read('year')
    const month = read('month')
    const day = read('day')
    // Midnight formats as hour 24 in some locales/zones; normalise it.
    const hour = read('hour') % 24
    const minute = read('minute')
    const second = read('second')

    if ([year, month, day, hour, minute, second].some(Number.isNaN)) return null

    return new Date(year, month - 1, day, hour, minute, second)
  } catch {
    return null
  }
}

/** Whole minutes since the epoch — the identity of one scheduled trigger. */
export function toEpochMinute(instant: Date): number {
  return Math.floor(instant.getTime() / 60_000)
}
