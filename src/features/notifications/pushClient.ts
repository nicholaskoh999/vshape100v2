/**
 * The browser half of reminders.
 *
 * Permission and a PushSubscription belong to ONE browser profile, so
 * everything here is explicitly about "this device". Nothing in this module
 * runs on its own: `requestPermission` is only ever reached from an explicit
 * user action, never from a render, a route change or app bootstrap.
 */

import { base64UrlToBytes } from './base64'

const CONFIG_PATH = '/api/notifications/config'
const SUBSCRIPTION_PATH = '/api/notifications/subscription'
const SERVICE_WORKER_PATH = '/sw.js'

const REQUEST_INIT: RequestInit = {
  credentials: 'same-origin',
  headers: { Accept: 'application/json' },
}

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' }

/**
 * Why this device cannot have reminders, when it cannot.
 *
 * These are reported honestly and separately, because the fix differs: a
 * blocked permission needs browser settings, an uninstalled iOS PWA needs
 * Add to Home Screen, and an unconfigured server needs a deployment.
 */
export type PushSupport =
  | { supported: true }
  | { supported: false; reason: 'unsupported' | 'install-required' }

/**
 * Can this browser do Web Push at all?
 *
 * iOS grants Push only to an installed PWA, and it is the one platform where
 * "unsupported" would be a lie: Safari has the APIs, it just withholds them
 * until the app is on the Home Screen. That case is reported separately so the
 * UI can say something the person can act on.
 */
export function detectSupport(): PushSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'unsupported' }

  const hasApis =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'

  if (hasApis) return { supported: true }

  // Safari on iOS: the APIs appear only once the app is installed.
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

  if (iOS && !standalone) return { supported: false, reason: 'install-required' }
  return { supported: false, reason: 'unsupported' }
}

/** The browser's current permission, without asking for it. */
export function currentPermission(): NotificationPermission | null {
  if (typeof Notification === 'undefined') return null
  return Notification.permission
}

/** This device's IANA timezone, e.g. 'Asia/Kuala_Lumpur'. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export type NotificationConfig = { available: boolean; publicKey: string | null }

/** The deployment's public VAPID key, or an honest "unavailable". */
export async function fetchConfig(signal?: AbortSignal): Promise<NotificationConfig> {
  const response = await fetch(CONFIG_PATH, { ...REQUEST_INIT, signal })
  if (!response.ok) throw new Error(`notification config failed (${response.status})`)
  const body = (await response.json()) as Record<string, unknown>
  return {
    available: body.available === true,
    publicKey: typeof body.publicKey === 'string' ? body.publicKey : null,
  }
}

/**
 * Register the service worker.
 *
 * Registration alone asks for nothing: no permission prompt, no subscription.
 * It only makes a push receiver available for later.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: '/' })
  } catch {
    return null
  }
}

/** The subscription this browser already has, if any. Never prompts. */
export async function existingSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    if (!registration) return null
    return await registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

/** The subscription's public halves, in the shape the server validates. */
export function describeSubscription(
  subscription: PushSubscription,
  timezone: string,
): { endpoint: string; p256dh: string; auth: string; timezone: string } | null {
  const json = subscription.toJSON()
  const keys = json.keys as Record<string, string> | undefined
  if (!json.endpoint || !keys?.p256dh || !keys?.auth) return null
  return { endpoint: json.endpoint, p256dh: keys.p256dh, auth: keys.auth, timezone }
}

/** Register or reconcile this device with the server. */
export async function saveSubscription(
  subscription: PushSubscription,
  timezone: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const described = describeSubscription(subscription, timezone)
  if (!described) return false

  const response = await fetch(SUBSCRIPTION_PATH, {
    ...REQUEST_INIT,
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(described),
    signal,
  })
  return response.ok
}

/** Tell the server this device should stop receiving reminders. */
export async function forgetSubscription(
  endpoint: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const response = await fetch(SUBSCRIPTION_PATH, {
    ...REQUEST_INIT,
    method: 'DELETE',
    headers: JSON_HEADERS,
    body: JSON.stringify({ endpoint }),
    signal,
  })
  return response.ok
}

/**
 * Ask the browser for permission.
 *
 * The ONLY caller is an explicit Enable action. If permission was already
 * decided, the browser resolves immediately with that decision and shows no
 * prompt — which is why an already-granted device can re-subscribe without
 * being asked twice.
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  return Notification.requestPermission()
}

/** Create this device's push subscription against the server's VAPID key. */
export async function subscribe(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<PushSubscription | null> {
  try {
    return await registration.pushManager.subscribe({
      // Required by every browser: a push must be shown to the user.
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey) as BufferSource,
    })
  } catch {
    return null
  }
}

/**
 * Retire this device everywhere: server first, then the browser.
 *
 * Server first on purpose. If the local unsubscribe succeeded but the server
 * call failed, the server would keep pushing to an endpoint the browser has
 * abandoned; the other way round, a failure leaves a subscription that still
 * works and can be retried.
 *
 * Returns whether BOTH halves are confirmed, so a caller can be honest instead
 * of claiming reminders are off when only half of it happened.
 */
export async function disableOnThisDevice(): Promise<boolean> {
  const subscription = await existingSubscription()
  if (!subscription) return true

  // Each half reports its own success; a thrown call counts as a failure.
  const retired = await forgetSubscription(subscription.endpoint).catch(() => false)
  const unsubscribed = await subscription.unsubscribe().catch(() => false)

  return retired && unsubscribed
}
