import { Bell, BellOff, Loader2 } from 'lucide-react'

import { Card } from '@/components/ui/Card'
import { press } from '@/design/motion'
import { motion } from 'motion/react'

import { useNotifications, type NotificationState } from './useNotifications'

/**
 * Routine reminders, in Settings.
 *
 * Deliberately one card in the existing Settings list, not a destination:
 * there is no notification route, no nav item and no inbox. Reminders are a
 * setting for this device, and that is all the surface they need.
 *
 * The explanation sits ABOVE the button on purpose. A browser permission
 * prompt is a poor place to learn what you are agreeing to, so the card says
 * what will notify — and what will not — before anything is requested.
 */

type Copy = { value: string; note: string; action: 'enable' | 'disable' | null }

function describe(state: NotificationState): Copy {
  switch (state.status) {
    case 'checking':
      return { value: 'Checking', note: 'Looking at this device.', action: null }
    case 'off':
      return {
        value: 'Off',
        note: 'Uses your existing VShape schedule. Only fixed-time items notify.',
        action: 'enable',
      }
    case 'enabling':
      return { value: 'Working', note: 'One moment.', action: null }
    case 'on':
      return {
        value: 'On this device',
        note: state.timezone
          ? `Reminders follow this device clock (${state.timezone}).`
          : 'Reminders follow this device clock.',
        action: 'disable',
      }
    case 'blocked':
      return {
        value: 'Blocked',
        // Only the person can undo this, and only in browser settings, so the
        // card must not offer a button that would do nothing.
        note: 'This browser is blocking notifications. Allow them in your browser settings first.',
        action: null,
      }
    case 'install-required':
      return {
        value: 'Install first',
        note: 'On iPhone and iPad, add VShape to your Home Screen to allow reminders.',
        action: null,
      }
    case 'unsupported':
      return {
        value: 'Unsupported',
        note: 'This browser cannot deliver reminders.',
        action: null,
      }
    case 'unavailable':
      return {
        value: 'Unavailable',
        note: 'Reminders are not configured on the server yet.',
        action: null,
      }
    case 'error':
      return { value: 'Unavailable', note: state.message, action: 'enable' }
  }
}

export function NotificationSettingsCard() {
  const { state, enable, disable } = useNotifications()
  const copy = describe(state)
  const working = state.status === 'enabling' || state.status === 'checking'

  return (
    <Card className="px-5 py-4">
      {/* Card does not forward extra props, so the marker lives here. */}
      <div data-notification-settings data-notification-state={state.status}>
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-overlay text-ink-dim">
            {state.status === 'on' ? (
              <Bell className="size-5" aria-hidden="true" />
            ) : (
              <BellOff className="size-5" aria-hidden="true" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-bold text-offwhite">Routine reminders</p>
              <p className="text-[13px] font-semibold text-ink-dim">{copy.value}</p>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">{copy.note}</p>

            {copy.action && (
              <motion.button
                {...press}
                type="button"
                onClick={copy.action === 'enable' ? enable : disable}
                disabled={working}
                data-notification-action={copy.action}
                className="mt-3 inline-flex h-10 items-center justify-center gap-1.5 rounded-control border border-edge-strong px-3.5 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
              >
                {working && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {copy.action === 'enable'
                  ? 'Enable on this device'
                  : 'Disable on this device'}
              </motion.button>
            )}

            <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
              Only this device. Flexible items like Free time never notify.
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}
