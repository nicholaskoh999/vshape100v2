import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  currentPermission,
  detectSupport,
  deviceTimeZone,
  disableOnThisDevice,
  isFullyDisabled,
  fetchConfig,
  lookupSubscription,
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

      const lookup = await lookupSubscription()
      if (!active) return

      if (lookup.state === 'unavailable') {
        // Neither Off nor On: the browser could not say whether this device is
        // subscribed, and guessing either way would be a claim we cannot make.
        setState({
          status: 'error',
          message: 'Could not read this device reminder state. Try again.',
        })
        return
      }

      if (permission === 'granted' && lookup.state === 'found') {
        const subscription = lookup.subscription
        // A local PushSubscription is only half of "on". The other half is the
        // server knowing about it: without a registered row and a usable
        // timezone, nothing will ever be scheduled or delivered, so claiming
        // "On this device" here would be a promise the app cannot keep.
        const timezone = deviceTimeZone()
        if (!timezone) {
          setState({
            status: 'error',
            message: 'Could not read this device timezone, so reminders cannot be scheduled.',
          })
          return
        }

        // Reconcile and WAIT for it. This also carries a changed timezone
        // after travel, and involves no permission prompt because permission
        // is already granted.
        const confirmed = await saveSubscription(subscription, timezone, controller.signal)
          .catch(() => false)
        if (!active) return

        setState(
          confirmed
            ? { status: 'on', timezone }
            : {
                status: 'error',
                message: 'Reminders are not registered on the server. Try enabling again.',
              },
        )
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

        // On an unavailable lookup, subscribing is still safe: a browser that
        // already has one returns that same subscription rather than a second.
        const found = await lookupSubscription()
        const subscription =
          found.state === 'found' ? found.subscription : await subscribe(registration, key)
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
        const result = await disableOnThisDevice()
        setState(
          isFullyDisabled(result)
            ? { status: 'off' }
            : {
                status: 'error',
                // Honest: half-done is not off, and claiming otherwise would
                // leave someone expecting silence they will not get.
                message: result.server
                  ? 'The server stopped reminders, but this browser still holds a subscription. Try again.'
                  : 'Could not fully turn reminders off. Try again.',
              },
        )
      } finally {
        busy.current = false
      }
    })()
  }, [])

  return { state, enable, disable }
}
