import { ChevronRight, Coffee } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { press, spring, tween } from '@/design/motion'
import { cn } from '@/lib/utils'
import { formatLead } from '../model/format'
import { MINUTES_PER_DAY, type TodayEntry } from '../model/types'
import { CompleteButton } from './CompleteToggle'
import { itemIcons } from './itemIcons'
import { StatusBadge } from './StatusBadge'

/**
 * The single thing the day is pointing at right now.
 *
 * Shows the current item when there is one, otherwise the closest upcoming
 * item with how long is left — a Today page should never open on an empty
 * space.
 */
export function TodayHero({
  entry,
  nowMinutes,
  onToggle,
  routeSummary,
  pending = false,
  disabled = false,
}: {
  entry: TodayEntry | null
  nowMinutes: number
  onToggle: (key: string) => void
  routeSummary: string
  pending?: boolean
  disabled?: boolean
}) {
  if (!entry) {
    return (
      <div className="flex items-center gap-4 rounded-card border border-line bg-surface p-5 shadow-card md:p-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-soft text-ink-3">
          <Coffee className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-[-0.015em] text-ink">
            Nothing scheduled right now
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-2">{routeSummary}</p>
        </div>
      </div>
    )
  }

  const Icon = itemIcons[entry.item.icon]
  const isNext = entry.status === 'NEXT'
  const done = entry.completed
  const afterMidnight = entry.start >= MINUTES_PER_DAY

  return (
    <motion.div
      layout
      transition={{ layout: spring.snappy, ...tween.enter }}
      className={cn(
        'relative overflow-hidden rounded-card border p-5 shadow-card md:p-6',
        isNext ? 'border-line-strong bg-surface' : 'border-accent-edge/45 bg-surface',
        done && 'border-success-ink/35',
      )}
    >
      <div className="relative flex items-start gap-4">
        <span
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-2xl md:size-14',
            done
              ? 'bg-success-soft text-success-ink'
              : isNext
                ? 'bg-surface-soft text-ink-2'
                : 'border border-accent-edge bg-accent text-ink',
          )}
        >
          <Icon className="size-6" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={entry.status} />
            <span className="text-[12px] font-semibold text-ink-2">{entry.timeLabel}</span>
            {isNext && (
              <span className="text-[12px] font-semibold text-accent-ink">
                {formatLead(entry.start - nowMinutes)}
              </span>
            )}
            {entry.spillover ? (
              <span className="text-[12px] font-semibold text-ink-3">from yesterday</span>
            ) : (
              afterMidnight && (
                <span className="text-[12px] font-semibold text-ink-3">after midnight</span>
              )
            )}
          </div>

          <h2
            className={cn(
              'text-xl font-bold tracking-[-0.015em] md:text-2xl',
              done ? 'text-ink-3 line-through decoration-success-ink/60' : 'text-ink',
            )}
          >
            {entry.item.title}
          </h2>

          {entry.item.note && (
            <p className="mt-1 text-[13px] text-ink-2">{entry.item.note}</p>
          )}
        </div>
      </div>

      <div className="relative mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <CompleteButton
          entry={entry}
          onToggle={onToggle}
          pending={pending}
          disabled={disabled}
          className="w-full sm:w-auto"
        />
        {entry.item.to && (
          <Link to={entry.item.to} className="rounded-control">
            <motion.span
              whileTap={press.whileTap}
              tabIndex={-1}
              transition={press.transition}
              className="inline-flex min-h-tap w-full items-center justify-center gap-1 rounded-control border border-line-strong bg-surface px-4 text-sm font-bold text-ink transition-colors duration-fast hover:border-ink-4 sm:w-auto"
            >
              Open session
              <ChevronRight className="size-4" aria-hidden="true" />
            </motion.span>
          </Link>
        )}
      </div>
    </motion.div>
  )
}
