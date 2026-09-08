import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Every status this app shows, as one component.
 *
 * TWO RULES, BOTH LOAD-BEARING.
 *
 * 1. NO STATUS BY COLOUR ALONE. Every badge renders a word, and every badge
 *    that carries a state rather than a plain label renders an icon too. That
 *    is what makes the deliberate hue overlap between the two axes safe, and
 *    what makes forced-colors mode degrade to legible rather than ambiguous.
 *
 * 2. PROVENANCE AND STATE ARE DIFFERENT TONES. `extra` is an OUTLINE chip —
 *    shape, not hue, keeps it distinct from an accent-soft surface — and
 *    `current` is an ink fill. Reusing the Extra chip for "happening now"
 *    would make a provenance signal stop being a signal.
 *
 * The two axes are:
 *
 *   session intensity   HARD / LIGHT / PUMP
 *   day resolution      Scheduled / Recovery / Extra / Holiday
 *
 * They never appear in the same legend, which is why LIGHT and Recovery may
 * share a teal and PUMP and Holiday may share a purple.
 */

export type BadgeTone =
  /* session intensity */
  | 'hard'
  | 'light'
  | 'pump'
  /* day resolution */
  | 'scheduled'
  | 'recovery'
  | 'extra'
  | 'holiday'
  /* outcome */
  | 'done'
  | 'skipped'
  | 'late'
  | 'info'
  /* ui state, never provenance */
  | 'current'
  /* plain */
  | 'neutral'
  | 'outline'

const tones: Record<BadgeTone, string> = {
  hard: 'bg-hard-soft text-hard-ink',
  light: 'bg-light-soft text-light-ink',
  pump: 'bg-pump-soft text-pump-ink',

  scheduled: 'bg-scheduled-soft text-scheduled-ink',
  recovery: 'bg-recovery-soft text-recovery-ink',
  // Outline, not a fill: an Extra is real recorded training and must never be
  // mistaken for the accent surface or for the current-item marker.
  extra: 'border border-accent-edge text-extra-ink',
  holiday: 'bg-holiday-soft text-holiday-ink',

  done: 'bg-success-soft text-success-ink',
  skipped: 'bg-warn-soft text-warn-ink',
  late: 'bg-warn-soft text-warn-ink',
  info: 'bg-info-soft text-info-ink',

  current: 'bg-ink text-ink-on-dark',

  neutral: 'bg-surface-soft text-ink-2',
  outline: 'border border-line-strong text-ink-2',
}

export function Badge({
  tone = 'neutral',
  icon: Icon,
  children,
  className,
}: {
  tone?: BadgeTone
  icon?: LucideIcon
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'vs-bordered inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold',
        tones[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  )
}

/** The accepted session intensities, with their locked semantic colours. */
export type SessionIntensityTone = 'HARD' | 'LIGHT' | 'PUMP'

const intensityTone: Record<SessionIntensityTone, BadgeTone> = {
  HARD: 'hard',
  LIGHT: 'light',
  PUMP: 'pump',
}

export function IntensityBadge({
  intensity,
  className,
}: {
  intensity: SessionIntensityTone
  className?: string
}) {
  return (
    <Badge tone={intensityTone[intensity]} className={className}>
      {intensity}
    </Badge>
  )
}
