import { motion } from 'motion/react'

import { duration, ease } from '@/design/motion'

/**
 * Shown while the server session is being resolved.
 *
 * Deliberately brand-only: no app chrome and no protected content, so nothing
 * leaks before the answer arrives.
 */
export function AuthSplash({ label = 'Loading your day' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-dvh place-items-center px-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: duration.base, ease: ease.outQuart }}
        className="flex flex-col items-center gap-4"
      >
        <motion.img
          src="/app-icon.svg"
          alt=""
          aria-hidden="true"
          className="size-14 rounded-2xl"
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: ease.inOutSoft }}
        />
        <p className="text-[13px] font-semibold text-ink-faint">{label}</p>
      </motion.div>
    </div>
  )
}
