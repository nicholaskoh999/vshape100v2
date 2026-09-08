import { AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The shared vocabulary for "something is happening", "there is nothing here"
 * and "that did not work".
 *
 * Before Round 24 six screens hand-rolled their own error row, each with
 * slightly different wording, retry affordance and markup. The wording rules
 * are now in one place:
 *
 *   an error says WHAT FAILED, WHAT WAS NOT LOST, and ONE WAY FORWARD
 *
 * and never an automatic retry loop, never a destructive "reset and try
 * again", never a bare status code.
 */

/* ------------------------------------------------------------------ */
/* Banner                                                              */
/* ------------------------------------------------------------------ */

export type BannerTone = 'info' | 'success' | 'warn' | 'danger'

const tones: Record<BannerTone, { box: string; icon: LucideIcon }> = {
  info: { box: 'bg-info-soft border-info-ink/20 text-info-ink', icon: Info },
  success: {
    box: 'bg-success-soft border-success-ink/25 text-success-ink',
    icon: CheckCircle2,
  },
  warn: { box: 'bg-warn-soft border-warn-ink/25 text-warn-ink', icon: AlertTriangle },
  danger: {
    box: 'bg-danger-soft border-danger-ink/25 text-danger-ink',
    icon: AlertTriangle,
  },
}

export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  className,
  /**
   * `alert` for a failure or a refusal the user must notice, `status` for
   * progress. Omitted for a purely explanatory note, which must NOT be
   * announced — an inline explanation interrupting a screen reader mid-task
   * is worse than useful.
   */
  live,
}: {
  tone?: BannerTone
  title?: string
  children?: ReactNode
  actions?: ReactNode
  className?: string
  live?: 'alert' | 'status'
}) {
  const { box, icon: Icon } = tones[tone]
  return (
    <div
      role={live}
      className={cn(
        'vs-bordered flex items-start gap-3 rounded-control border p-3.5 text-[13.5px]',
        box,
        className,
      )}
    >
      <Icon className="mt-0.5 size-4.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
        {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Empty                                                               */
/* ------------------------------------------------------------------ */

/**
 * "The answer is known, and there is nothing."
 *
 * Deliberately NOT the old EmptyShell, which existed to say "this arrives in
 * a later round" — roadmap language, in developer terms, on a shipped screen.
 * An empty state names what would put something here, and offers the one
 * action that would.
 */
export function EmptyState({
  icon: Icon,
  title,
  note,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  note: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong bg-surface px-6 py-8 text-center',
        className,
      )}
    >
      <span className="grid size-11 place-items-center rounded-2xl bg-surface-soft text-ink-3">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-ink-2">
          {note}
        </p>
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/**
 * A placeholder shaped like the content it replaces.
 *
 * IT MUST READ AS A PLACEHOLDER WHILE COMPLETELY STILL. The app's global
 * reduced-motion rule sets `animation-duration: 0.01ms !important` on
 * everything, so a loading signal carried only by movement disappears for
 * exactly the users most likely to have that setting on. The solid sunken
 * ground is the signal; the shimmer is an enhancement on top of it.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block animate-pulse rounded-field bg-surface-sunken',
        className,
      )}
    />
  )
}

/**
 * The announced half of a loading state.
 *
 * Paired with skeletons: they carry it visually, this carries it to assistive
 * technology, and neither depends on animation.
 */
export function LoadingNote({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p role="status" className={cn('text-[13px] font-semibold text-ink-2', className)}>
      {children}
    </p>
  )
}
