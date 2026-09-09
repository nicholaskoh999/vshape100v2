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

/**
 * THE WAY IN.
 *
 * Round 24 final polish. UI only: the Google flow, the callback, the session
 * cookie, the redirect target and the trust-device contract are all untouched
 * below — `startGoogleLogin` still calls exactly the same `googleStartUrl(next,
 * trustDevice)` it did before, with the same state.
 *
 * WHAT CHANGED, AND WHY.
 *
 *   THE BUTTON WAS UNREADABLE. It was `bg-ink … text-ink` — near-black label on
 *   a near-black fill, which is how the screen came to read as "a floating
 *   Google G": the G was the only part of the control with any contrast. That
 *   is a genuine accessibility defect rather than a matter of taste, so it is
 *   fixed here rather than deferred.
 *
 *   THE MARK WAS THE OLD LETTER TILE, drawn on navy with electric blue — a
 *   palette Round 24 superseded, sitting on a warm off-white canvas. It is now
 *   the production shield-and-path symbol, transparent, standing on the card.
 *
 *   THE AUTH BLOCK WAS A DOT IN A DESKTOP CANVAS. It is now a quiet white card
 *   in the same radius / border / shadow language as every other card in the
 *   app, 400–440px, centred.
 *
 *   THE TRUST-DEVICE CONTROL WAS A 18px BOX with a caption. The whole row is
 *   now the target, the box is 22px, and the helper line says where the 30 days
 *   apply — which is the part somebody actually needs to know before ticking it
 *   on a shared machine.
 *
 * The symbol is `aria-hidden`: the `VShape100` heading beside it already
 * supplies the brand name, so announcing it twice would be noise.
 */

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
    <main className="grid min-h-dvh place-items-center px-4 py-10 sm:px-6 sm:py-14">
      <motion.div
        variants={listVariants}
        initial="initial"
        animate="enter"
        /*
          Full width inside `main`'s own gutter, capped at 26rem (416px) — the
          focused column the brief asks for, and never a small dot floating in
          a wide desktop canvas.

          Deliberately NOT a calc(): `w-[calc(100%-32px)]` encodes the gutter a
          second time, in a whitespace-sensitive arbitrary value that has to
          stay in step with `main`'s padding by hand. The padding already
          supplies the gutter; the card only has to fill what is left.
        */
        className="w-full max-w-[26rem]"
      >
        <motion.div
          variants={listItemVariants}
          className="vs-bordered rounded-hero border border-line bg-surface p-7 shadow-card sm:p-9"
        >
          <div className="flex flex-col items-center text-center">
            {/*
              The standalone shield, not the rounded app tile: on this warm
              off-white card the tile would add a second background for no
              reason.

              The box is larger than the mark it holds. The artwork sits in a
              1024 viewBox with real margin — the shield itself is 864 tall —
              so a 68px box draws a 57px shield and an 80px box draws a 68px
              one. These two are chosen for the VISUAL sizes the brief asks
              for (56–64 on a phone, 64–72 on desktop), not for the numbers on
              the element.
            */}
            <img
              src="/vshape-symbol.svg"
              alt=""
              aria-hidden="true"
              className="size-[68px] sm:size-20"
            />
            <h1 className="mt-5 text-[28px] font-bold leading-none tracking-[-0.02em] text-ink sm:text-[32px]">
              VShape<span className="text-accent-ink">100</span>
            </h1>
            <p className="mt-2 text-[14.5px] text-ink-2">Build your foundation.</p>
          </div>

          <motion.button
            {...press}
            type="button"
            onClick={startGoogleLogin}
            disabled={isRedirecting}
            /*
              The app's primary language — an ink fill — with `ink-on-dark`
              text at 14.9:1 rather than the ink-on-ink it used to carry. Full
              width, 56px, and plainly a provider button rather than anything
              that could be mistaken for a password form.
            */
            /*
              Tighter gap and padding below `sm` so the label stays on one line
              on a 320px phone; the roomier spacing returns as soon as there is
              width for it.
            */
            className="mt-8 flex min-h-gym w-full items-center justify-center gap-2.5 rounded-control bg-ink px-3.5 text-[15.5px] font-bold text-ink-on-dark shadow-card transition-opacity duration-fast hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70 sm:gap-3 sm:px-5"
          >
            {isRedirecting ? (
              <>
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                Taking you to Google
              </>
            ) : (
              <>
                {/*
                  Google's multicolour mark needs a light ground to stay
                  legible and on-brand, so it keeps its own white chip.
                */}
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-surface"
                >
                  <GoogleMark className="size-[18px]" />
                </span>
                Continue with Google
              </>
            )}
          </motion.button>

          {errorMessage && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.fast, ease: ease.outQuart }}
              className="mt-4 flex items-start gap-2 rounded-control border border-danger-ink/30 bg-danger-soft px-3.5 py-3 text-[13px] font-semibold text-danger-ink"
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
              className="mt-4 flex items-start gap-2 rounded-control border border-line-strong bg-surface-soft px-3.5 py-3 text-[13px] font-semibold text-ink-2"
            >
              <AlertCircle className="mt-px size-4 shrink-0" aria-hidden="true" />
              {signOutNotice}
            </motion.p>
          )}

          {/*
            The whole row is the target, not an 18px box. Ticking this on a
            shared machine is the mistake worth preventing, so the helper says
            WHERE the thirty days apply rather than only how long they last.
          */}
          <label className="mt-6 flex min-h-tap cursor-pointer items-start gap-3 rounded-control border border-line bg-surface-soft p-3.5 transition-colors duration-fast hover:border-line-strong has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
            <span className="relative mt-px shrink-0">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(event) => setTrustDevice(event.target.checked)}
                className="peer block size-[22px] cursor-pointer appearance-none rounded-[7px] border-2 border-line-control bg-surface transition-colors duration-fast checked:border-accent-edge checked:bg-accent"
              />
              <Check
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 m-auto size-3.5 text-ink opacity-0 transition-opacity duration-fast peer-checked:opacity-100"
                strokeWidth={3.5}
              />
            </span>
            <span className="leading-tight">
              <span className="block text-[14.5px] font-bold text-ink">Trust this device</span>
              <span className="mt-1 block text-[13px] text-ink-2">
                Stay signed in for 30 days on this device.
              </span>
            </span>
          </label>
        </motion.div>

        <motion.p
          variants={listItemVariants}
          className="mt-6 text-center text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3"
        >
          Private · Personal
        </motion.p>
      </motion.div>
    </main>
  )
}
