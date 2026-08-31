import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  currentPermission,
  detectSupport,
  deviceTimeZone,
  disableOnThisDevice,
  existingSubscription,
  fetchConfig,
  registerServiceWorker,
  requestPermission,
  saveSubscription,
  subscribe,
} from './pushClient'

/**
 * Reminder state for THIS device.
 *
 * ## Nothing here asks for permission on its own
 *
 * The effect below registers the service worker and reads the state the
 * browser already has. Registration prompts for nothing, and reading
 * `Notification.permission` prompts for nothing. `requestPermission` is
 * reachable only through `enable()`, which only a button calls.
 *
 * ## It reports what is true, not what is convenient
 *
 * "Blocked", "unsupported", "install the app first" and "the server has no
 * push configuration" are different problems with different fixes, so they are
 * different states rather than one vague "off".
 */

export type NotificationState =
  /** Still finding out. Nothing is claimed yet. */
  | { status: 'checking' }
  /** Everything works; this device simply has not been enabled. */
  | { status: 'off' }
  /** Enabling right now. */
  | { status: 'enabling' }
  /** This device will receive reminders. */
  | { status: 'on'; timezone: string | null }
  /** The browser refused, and only the person can undo that. */
  | { status: 'blocked' }
  /** This browser cannot do Web Push. */
  | { status: 'unsupported' }
  /** The APIs exist but only for an installed app (iOS). */
  | { status: 'install-required' }
  /** The deployment has no VAPID configuration. */
  | { status: 'unavailable' }
  /** Something failed; say so rather than implying it worked. */
  | { status: 'error'; message: string }

export type NotificationControls = {
  state: NotificationState
  /** Only ever called from an explicit user action. */
  enable: () => void
  disable: () => void
}

export function useNotifications(): NotificationControls {
  const [state, setState] = useState<NotificationState>({ status: 'checking' })
  // The server's public key, once known. Held in a ref because it is a fact
  // about the deployment, not something the UI renders.
  const publicKey = useRef<string | null>(null)
  const busy = useRef(false)

  const support = useMemo(() => detectSupport(), [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    async function look() {
      if (!support.supported) {
        setState({ status: support.reason === 'install-required' ? 'install-required' : 'unsupported' })
        return
      }

      let config
      try {
        config = await fetchConfig(controller.signal)
      } catch {
        if (active) setState({ status: 'error', message: 'Could not check reminder settings.' })
        return
      }
      if (!active) return

      if (!config.available || !config.publicKey) {
        // A deployment without push configuration is a normal state, not a
        // fault of this browser.
        setState({ status: 'unavailable' })
        return
      }
      publicKey.current = config.publicKey

      // Registering asks for nothing. It only makes a receiver available.
      await registerServiceWorker()
      if (!active) return

      const permission = currentPermission()
      if (permission === 'denied') {
        setState({ status: 'blocked' })
        return
      }

      const subscription = await existingSubscription()
      if (!active) return

      if (permission === 'granted' && subscription) {
        const timezone = deviceTimeZone()
        setState({ status: 'on', timezone })
        // Silent reconcile: travel changes the local clock the schedule is
        // written in, and the server has no other way to learn about it. No
        // prompt is involved, because permission is already granted.
        if (timezone) void saveSubscription(subscription, timezone, controller.signal)
        return
      }

      setState({ status: 'off' })
    }

    void look()
    return () => {
      active = false
      controller.abort()
    }
  }, [support])

  const enable = useCallback(() => {
    if (busy.current) return
    busy.current = true

    void (async () => {
      setState({ status: 'enabling' })
      try {
        const key = publicKey.current
        if (!key) {
          setState({ status: 'unavailable' })
          return
        }

        // The one place permission is ever requested. If the browser already
        // decided, this resolves with that decision and shows no prompt.
        const permission = await requestPermission()
        if (permission === 'denied') {
          setState({ status: 'blocked' })
          return
        }
        if (permission !== 'granted') {
          setState({ status: 'off' })
          return
        }

        const registration = await registerServiceWorker()
        if (!registration) {
          setState({ status: 'error', message: 'Could not start the reminder service.' })
          return
        }

        const subscription =
          (await existingSubscription()) ?? (await subscribe(registration, key))
        if (!subscription) {
          setState({ status: 'error', message: 'This browser refused the subscription.' })
          return
        }

        const timezone = deviceTimeZone()
        if (!timezone) {
          // Without a zone the server cannot know when 20:30 is here, so it
          // would never be eligible to send. Say so instead of appearing on.
          setState({ status: 'error', message: 'Could not read this device timezone.' })
          return
        }

        const saved = await saveSubscription(subscription, timezone)
        setState(
          saved
            ? { status: 'on', timezone }
            : { status: 'error', message: 'Could not save reminders for this device.' },
        )
      } finally {
        busy.current = false
      }
    })()
  }, [])

  const disable = useCallback(() => {
    if (busy.current) return
    busy.current = true

    void (async () => {
      setState({ status: 'enabling' })
      try {
        const done = await disableOnThisDevice()
        setState(
          done
            ? { status: 'off' }
            : {
                status: 'error',
                // Honest: half-done is not off, and claiming otherwise would
                // leave someone expecting silence they will not get.
                message: 'Could not fully turn reminders off. Try again.',
              },
        )
      } finally {
        busy.current = false
      }
    })()
  }, [])

  return { state, enable, disable }
}
