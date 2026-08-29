import { Loader2, RotateCcw, TriangleAlert, X } from 'lucide-react'

import { pressStrong } from '@/design/motion'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

/**
 * The one honest line about the saved-progress connection.
 *
 * While progress is loading the completion controls are held, because acting
 * on state we have not read yet would be guessing. If the load fails we say
 * so rather than quietly showing finished work as unfinished.
 */
export function TodayStatusNotice({
  hydration,
  failureMessage,
  onRetry,
  onDismiss,
}: {
  hydration: 'loading' | 'ready' | 'error'
  failureMessage: string | null
  onRetry: () => void
  onDismiss: () => void
}) {
  if (hydration === 'loading') {
    return (
      <Notice tone="quiet">
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        <p className="min-w-0 flex-1">Loading your saved progress…</p>
      </Notice>
    )
  }

  if (hydration === 'error') {
    return (
      <Notice tone="alert" role="alert">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-ink-dim">
          Couldn’t load your saved progress. Marking items done is paused until
          it loads.
        </p>
        <Action onClick={onRetry} icon={RotateCcw} label="Try again" />
      </Notice>
    )
  }

  if (failureMessage) {
    return (
      <Notice tone="alert" role="alert">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-ink-dim">{failureMessage}</p>
        <Action onClick={onDismiss} icon={X} label="Dismiss" />
      </Notice>
    )
  }

  return null
}

function Notice({
  tone,
  role,
  children,
}: {
  tone: 'quiet' | 'alert'
  role?: string
  children: React.ReactNode
}) {
  return (
    <div
      role={role}
      className={cn(
        'mb-4 flex items-center gap-2.5 rounded-card border px-4 py-2.5 text-[13px]',
        tone === 'alert'
          ? 'border-late/40 bg-late/[0.06] text-late'
          : 'border-edge bg-surface/60 text-ink-faint',
      )}
    >
      {children}
    </div>
  )
}

function Action({
  onClick,
  icon: Icon,
  label,
}: {
  onClick: () => void
  icon: typeof RotateCcw
  label: string
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={pressStrong.whileTap}
      transition={pressStrong.transition}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-edge-strong px-2.5 py-1 text-[12px] font-bold text-ink-dim transition-colors duration-150 hover:border-blue/60 hover:text-offwhite"
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </motion.button>
  )
}
