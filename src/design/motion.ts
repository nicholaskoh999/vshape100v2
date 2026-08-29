import type { Transition, Variants } from 'motion/react'

/**
 * Centralized motion tokens for VShape100 v2.
 *
 * Every animated component pulls timing/easing/springs from here so the app
 * moves as one system. Values mirror the CSS custom properties in tokens.css.
 *
 * Reduced motion: the app root wraps everything in
 * `<MotionConfig reducedMotion="user">`, so transform/layout animations
 * degrade automatically; tokens.css covers plain CSS transitions.
 */

/** Durations in seconds (Motion uses seconds). */
export const duration = {
  instant: 0.1,
  fast: 0.18,
  base: 0.28,
  slow: 0.42,
} as const

/** Shared easing curves. */
export const ease = {
  outQuart: [0.16, 1, 0.3, 1],
  inOutSoft: [0.45, 0, 0.2, 1],
} as const

/** Shared spring presets. */
export const spring = {
  /** Nav indicator + small UI that should feel snappy but settled. */
  snappy: { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 },
  /** Sheets / larger surfaces. */
  gentle: { type: 'spring', stiffness: 320, damping: 34 },
} as const satisfies Record<string, Transition>

/** Default tween used by page-level entrances. */
export const tween = {
  enter: { duration: duration.base, ease: ease.outQuart },
  exit: { duration: duration.fast, ease: ease.inOutSoft },
} as const satisfies Record<string, Transition>

/** Route transition: subtle rise + fade. Keyed on pathname in the shell. */
export const pageVariants = {
  initial: { opacity: 0, y: 10 },
  enter: {
    opacity: 1,
    y: 0,
    transition: tween.enter,
  },
} as const satisfies Variants

/** Staggered list entrance for shell content blocks. */
export const listVariants = {
  initial: {},
  enter: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
} as const satisfies Variants

export const listItemVariants = {
  initial: { opacity: 0, y: 12 },
  enter: { opacity: 1, y: 0, transition: tween.enter },
} as const satisfies Variants

/** Polished press feedback for tappable surfaces. */
export const press = {
  whileTap: { scale: 0.97 },
  transition: spring.snappy,
} as const

/** Slightly stronger press for small controls (icon buttons, tabs). */
export const pressStrong = {
  whileTap: { scale: 0.92 },
  transition: spring.snappy,
} as const

/** layoutId used by every nav variant so the active pill morphs between items. */
export const NAV_INDICATOR_ID = 'nav-active-indicator'
