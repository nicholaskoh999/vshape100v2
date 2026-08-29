import { ChevronRight, TriangleAlert } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { spring, tween } from '@/design/motion'
import { cn } from '@/lib/utils'
import { MINUTES_PER_DAY, type TodayEntry, type TodayStatus } from '../model/types'
import { CompleteToggle } from './CompleteToggle'
import { itemIcons } from './itemIcons'
import { statusLabel } from './statusMeta'

const surface: Record<TodayStatus, string> = {
  NOW: 'border-blue/45 bg-surface-raised',
  LATE: 'border-late/35 bg-late/[0.05]',
  NEXT: 'border-edge-strong bg-surface',
  LATER: 'border-edge bg-surface/60',
  DONE_EARLIER: 'border-edge/70 bg-surface/35',
}

const iconTone: Record<TodayStatus, string> = {
  NOW: 'bg-blue/15 text-blue',
  LATE: 'bg-late/15 text-late',
  NEXT: 'bg-surface-overlay text-ink-dim',
  LATER: 'bg-surface-overlay text-ink-faint',
  DONE_EARLIER: 'bg-completed/15 text-completed',
}

/**
 * One routine occurrence.
 *
 * `layout` lets the row slide to its new place when a complete, an undo or a
 * minute boundary reorders the list, and the rows around it close the gap —
 * the same Motion tokens the rest of the app uses, and reduced motion is
 * handled globally by `MotionConfig`.
 *
 * Removal is immediate on purpose: an item never disappears, it moves to
 * another section, so an exit animation would only leave a ghost row behind
 * the item it is already animating into.
 */
export function TodayItemRow({
  entry,
  onToggle,
}: {
  entry: TodayEntry
  onToggle: (key: string) => void
}) {
  const Icon = itemIcons[entry.item.icon]
  const done = entry.completed
  const afterMidnight = entry.start >= MINUTES_PER_DAY

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: spring.snappy, ...tween.enter }}
      className="list-none"
    >
      <div
        className={cn(
          'relative flex items-center gap-3 rounded-card border p-3 transition-colors duration-150 md:p-3.5',
          surface[entry.status],
          done && 'opacity-70',
        )}
      >
        <span
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-xl',
            iconTone[entry.status],
          )}
        >
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {/* The section heading names the status; the row only needs a
                shape cue so LATE does not rely on colour alone. Icon and
                label stay one unit so a narrow column never orphans it. */}
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.1em]',
                entry.status === 'LATE' ? 'text-late' : 'text-ink-faint',
              )}
            >
              {entry.status === 'LATE' && (
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              {entry.timeLabel}
            </span>
            {entry.spillover ? (
              <span className="text-[11px] font-semibold text-ink-faint">· yesterday</span>
            ) : (
              afterMidnight && (
                <span className="text-[11px] font-semibold text-ink-faint">
                  · after midnight
                </span>
              )
            )}
            <span className="sr-only">{statusLabel(entry.status)}</span>
          </div>

          <p
            className={cn(
              'line-clamp-2 text-[15px] font-bold tracking-tight',
              done ? 'text-ink-dim line-through decoration-completed/60' : 'text-offwhite',
            )}
          >
            {entry.item.to && !done ? (
              <Link
                to={entry.item.to}
                className="rounded-sm after:absolute after:inset-0 after:content-['']"
              >
                {entry.item.title}
              </Link>
            ) : (
              entry.item.title
            )}
          </p>

          {entry.item.note && (
            <p className="line-clamp-2 text-[12.5px] text-ink-faint">{entry.item.note}</p>
          )}
        </div>

        {entry.item.to && !done && (
          <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
        )}
        <CompleteToggle entry={entry} onToggle={onToggle} />
      </div>
    </motion.li>
  )
}
