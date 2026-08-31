/**
 * VAPID configuration, read from the environment.
 *
 * Absent configuration is a normal deployment state, not an error: a build
 * without notification secrets must still serve login, Today, Calendar and
 * Achievements exactly as before. So this returns null rather than throwing,
 * Settings reports "unavailable", and the scheduled sweep sends nothing.
 *
 * The private key is read here and handed only to the signing code. It is
 * never returned to a browser, never included in a response, and never
 * logged — not even in a diagnostic.
 */

import type { Env } from '../auth/config'
import type { VapidConfig } from '../push/webPush'

/** A subject must be a contact the push service can reach (RFC 8292). */
function isVapidSubject(value: string): boolean {
  return value.startsWith('mailto:') || value.startsWith('https://')
}

/**
 * The VAPID configuration, or null when this deployment has none.
 *
 * All three values must be present and plausibly shaped. A half-configured
 * deployment is treated as unconfigured rather than being allowed to fail
 * later, mid-send, once per minute.
 */
export function readVapidConfig(env: Env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY?.trim()
  const subject = env.VAPID_SUBJECT?.trim()

  if (!publicKey || !privateKey || !subject) return null
  if (!isVapidSubject(subject)) return null
  // base64url only, and the public key is a 65-byte point (86 chars unpadded).
  if (!/^[A-Za-z0-9_-]{80,120}$/.test(publicKey)) return null
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(privateKey)) return null

  return { publicKey, privateKey, subject }
}

/** Whether reminders can be delivered at all in this deployment. */
export function notificationsAvailable(env: Env): boolean {
  return readVapidConfig(env) !== null
}
