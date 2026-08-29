import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Placeholder block for features that arrive in later rounds.
 * Communicates intent without pretending data exists.
 */
export function EmptyShell({
  icon: Icon,
  title,
  note,
  className,
}: {
  icon: LucideIcon
  title: string
  note: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-card border border-dashed border-edge-strong bg-surface/50 px-6 py-10 text-center',
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-surface-overlay text-ink-faint">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-bold text-ink-dim">{title}</p>
        <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-ink-faint">
          {note}
        </p>
      </div>
    </div>
  )
}
