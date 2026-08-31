import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'

import { duration, ease, listItemVariants, listVariants, press } from '@/design/motion'
import { safeNextPath } from '@shared/redirect'
import { googleStartUrl, navigateToGoogle } from './api'
import { useAuth } from './AuthContext'
import { AuthSplash } from './AuthSplash'
import { GoogleMark } from './GoogleMark'

/** Calm, non-technical wording for every failure the user can actually hit. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'That Google account is not authorized.',
  expired: 'Your sign-in expired. Try again.',
  failed: "We couldn't complete sign-in. Try again.",
}

export function LoginPage() {
  const [params] = useSearchParams()
  const { status, endReason, signOutNotice } = useAuth()
  const [trustDevice, setTrustDevice] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const next = safeNextPath(params.get('next'))

  // A session that expired while the app was open should say so, even though
  // the redirect here carries no error code.
  const errorCode = params.get('error') ?? (endReason === 'expired' ? 'expired' : null)
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.failed) : null

  if (status === 'bootstrapping') return <AuthSplash label="Checking your session" />
  // Already signed in: never leave the user sitting on the login screen.
  if (status === 'authenticated') return <Navigate to={next} replace />

  const startGoogleLogin = () => {
    setIsRedirecting(true)
    navigateToGoogle(googleStartUrl(next, trustDevice))
  }

  return (
    <main className="relative grid min-h-dvh place-items-center px-6 py-12">
      <motion.div
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="w-full max-w-sm"
      >
        <motion.div variants={listItemVariants} className="flex flex-col items-center">
          <img src="/app-icon.svg" alt="" aria-hidden="true" className="size-16 rounded-2xl" />
          <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-offwhite">
            VShape<span className="text-blue">100</span>
          </h1>
          <p className="mt-1.5 text-sm text-ink-faint">Build your foundation.</p>
        </motion.div>

        <motion.div variants={listItemVariants} className="mt-9">
          <motion.button
            {...press}
            type="button"
            onClick={startGoogleLogin}
            disabled={isRedirecting}
            className="flex w-full items-center justify-center gap-3 rounded-control bg-offwhite px-5 py-3.5 text-[15px] font-bold text-navy shadow-card transition-opacity duration-150 disabled:opacity-70"
          >
            {isRedirecting ? (
              <>
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                Taking you to Google
              </>
            ) : (
              <>
                <GoogleMark className="size-5" />
                Continue with Google
              </>
            )}
          </motion.button>
        </motion.div>

        {errorMessage && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.fast, ease: ease.outQuart }}
            className="mt-4 flex items-start gap-2 rounded-control border border-coral/30 bg-coral/10 px-3.5 py-3 text-[13px] font-semibold text-coral"
          >
            <AlertCircle className="mt-px size-4 shrink-0" aria-hidden="true" />
            {errorMessage}
          </motion.p>
        )}

        {/*
          Sign-out worked, but retiring this device's reminders could not be
          confirmed. That is privacy-relevant, so it is surfaced here rather
          than swallowed — and only once, without blocking anything, so nobody
          is trapped retrying.
        */}
        {signOutNotice && (
          <motion.p
            role="status"
            data-signout-notice
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.fast, ease: ease.outQuart }}
            className="mt-4 flex items-start gap-2 rounded-control border border-edge-strong bg-surface-overlay px-3.5 py-3 text-[13px] font-semibold text-ink-dim"
          >
            <AlertCircle className="mt-px size-4 shrink-0" aria-hidden="true" />
            {signOutNotice}
          </motion.p>
        )}

        <motion.div variants={listItemVariants} className="mt-6">
          <label className="flex cursor-pointer items-start gap-3 rounded-control px-1 py-1">
            <span className="relative mt-0.5 shrink-0">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(event) => setTrustDevice(event.target.checked)}
                className="peer block size-[18px] cursor-pointer appearance-none rounded-[6px] border-2 border-edge-strong bg-surface transition-colors duration-150 checked:border-lime checked:bg-lime"
              />
              <Check
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 m-auto size-3 text-navy opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
                strokeWidth={3.5}
              />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold text-ink-dim">Trust this device</span>
              <span className="mt-0.5 block text-[13px] text-ink-faint">
                Stay signed in for 30 days
              </span>
            </span>
          </label>
        </motion.div>

        <motion.p
          variants={listItemVariants}
          className="mt-10 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint"
        >
          Private · Personal
        </motion.p>
      </motion.div>
    </main>
  )
}
