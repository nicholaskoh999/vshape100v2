import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { TodayEntry } from '../model/types'
import { TodayItemRow } from './TodayItemRow'

/** Section wrapper: small heading, count, then the animated list. */
export function TodaySection({
  title,
  entries,
  onToggle,
  pendingKeys,
  disabled = false,
  tone = 'default',
  listClassName,
  className,
  children,
}: {
  title: string
  entries: TodayEntry[]
  onToggle: (key: string) => void
  pendingKeys: ReadonlySet<string>
  disabled?: boolean
  tone?: 'default' | 'alert'
  listClassName?: string
  className?: string
  children?: ReactNode
}) {
  if (entries.length === 0) return null

  return (
    <section className={cn('min-w-0', className)} aria-label={title}>
      <div className="mb-2.5 flex items-center gap-2 px-0.5">
        <h2
          className={cn(
            'text-[11px] font-extrabold uppercase tracking-[0.16em]',
            tone === 'alert' ? 'text-late' : 'text-ink-faint',
          )}
        >
          {title}
        </h2>
        <span
          className={cn(
            'grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-extrabold',
            tone === 'alert' ? 'bg-late/20 text-late' : 'bg-surface-overlay text-ink-faint',
          )}
        >
          {entries.length}
        </span>
      </div>

      {children}

      <ul className={cn('flex flex-col gap-2', listClassName)}>
        {entries.map((entry) => (
          <TodayItemRow
            key={entry.key}
            entry={entry}
            onToggle={onToggle}
            pending={pendingKeys.has(entry.key)}
            disabled={disabled}
          />
        ))}
      </ul>
    </section>
  )
}
