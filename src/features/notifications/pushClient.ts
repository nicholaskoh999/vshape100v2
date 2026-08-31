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

/**
 * What the browser could tell us about this device's subscription.
 *
 * Three states, not two. "There is no subscription" and "I could not find out
 * whether there is a subscription" look identical if both collapse to null,
 * and treating the second as the first is how a device ends up reported as Off
 * while it is still receiving pushes.
 */
export type SubscriptionLookup =
  | { state: 'found'; subscription: PushSubscription }
  /** The browser answered, and there is genuinely none. */
  | { state: 'none' }
  /** The browser could not answer. Nothing may be concluded from this. */
  | { state: 'unavailable' }

/**
 * Look up this device's subscription. Never prompts for anything.
 *
 * Every failure path reports `unavailable` rather than `none`, so a caller has
 * to decide what an unknown means for it instead of inheriting a wrong answer.
 */
export async function lookupSubscription(): Promise<SubscriptionLookup> {
  if (!('serviceWorker' in navigator)) return { state: 'unavailable' }
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    // No registration at all is a real answer: nothing is subscribed here.
    if (!registration) return { state: 'none' }
    const subscription = await registration.pushManager.getSubscription()
    return subscription ? { state: 'found', subscription } : { state: 'none' }
  } catch {
    return { state: 'unavailable' }
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
 * What happened when this device was retired.
 *
 * The halves are reported separately because they fail differently and matter
 * differently. A server retirement that did not happen means the account can
 * still push here; a local unsubscribe that did not happen means the browser
 * still holds a subscription that a future sign-in would re-register.
 */
export type DisableResult = {
  /** There was something to disable at all. */
  had: boolean
  /** The server confirmed it will no longer push to this device. */
  server: boolean
  /** The browser confirmed it dropped the subscription. */
  local: boolean
}

/** Nothing left to disable is a complete success, not a partial one. */
export function isFullyDisabled(result: DisableResult): boolean {
  return !result.had || (result.server && result.local)
}

/**
 * Retire this device everywhere: server first, then the browser.
 *
 * Server first on purpose. If the local unsubscribe succeeded but the server
 * call failed, the server would keep pushing to an endpoint the browser has
 * abandoned and nothing could be retried; the other way round, a failure
 * leaves a subscription that still works and can be tried again.
 */
export async function disableOnThisDevice(): Promise<DisableResult> {
  const lookup = await lookupSubscription()

  // Confirmed none: nothing to retire, and that is a complete success.
  if (lookup.state === 'none') return { had: false, server: true, local: true }

  // Could not find out. There may well be a live subscription here, so this
  // must NOT read as "already off" — it is an unconfirmed cleanup, and the
  // caller surfaces that rather than promising silence.
  if (lookup.state === 'unavailable') return { had: true, server: false, local: false }

  // Each half reports its own success; a thrown call counts as a failure.
  const server = await forgetSubscription(lookup.subscription.endpoint).catch(() => false)
  const local = await lookup.subscription.unsubscribe().catch(() => false)

  return { had: true, server, local }
}
