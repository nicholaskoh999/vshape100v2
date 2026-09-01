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
      <div className="flex items-center gap-4 rounded-card border border-edge bg-surface p-5 md:p-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-overlay text-ink-faint">
          <Coffee className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold tracking-tight text-offwhite">
            Nothing scheduled right now
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-faint">{routeSummary}</p>
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
        isNext ? 'border-edge-strong bg-surface' : 'border-blue/50 bg-surface-raised',
        done && 'border-completed/45',
      )}
    >
      {/* One restrained tint, in the same language as the app background. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -right-16 -top-24 size-56 rounded-full blur-3xl',
          done ? 'bg-completed/10' : isNext ? 'bg-blue/[0.07]' : 'bg-blue/15',
        )}
      />

      <div className="relative flex items-start gap-4">
        <span
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-2xl md:size-14',
            done
              ? 'bg-completed/15 text-completed'
              : isNext
                ? 'bg-surface-overlay text-ink-dim'
                : 'bg-blue/15 text-blue',
          )}
        >
          <Icon className="size-6" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={entry.status} />
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">
              {entry.timeLabel}
            </span>
            {isNext && (
              <span className="text-[11px] font-semibold text-blue">
                {formatLead(entry.start - nowMinutes)}
              </span>
            )}
            {entry.spillover ? (
              <span className="text-[11px] font-semibold text-ink-faint">from yesterday</span>
            ) : (
              afterMidnight && (
                <span className="text-[11px] font-semibold text-ink-faint">after midnight</span>
              )
            )}
          </div>

          <h2
            className={cn(
              'text-xl font-extrabold tracking-tight md:text-2xl',
              done ? 'text-ink-dim line-through decoration-completed/60' : 'text-offwhite',
            )}
          >
            {entry.item.title}
          </h2>

          {entry.item.note && (
            <p className="mt-1 text-[13px] text-ink-faint">{entry.item.note}</p>
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
              className="inline-flex h-12 w-full items-center justify-center gap-1 rounded-control border border-edge-strong px-4 text-sm font-bold text-ink-dim transition-colors duration-150 hover:border-blue/60 hover:text-offwhite sm:w-auto"
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
