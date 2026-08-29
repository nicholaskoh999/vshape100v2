import { Check, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { duration, pressStrong } from '@/design/motion'
import { cn } from '@/lib/utils'
import type { TodayEntry } from '../model/types'

/**
 * The only way an item can become DONE EARLIER, and the only way back.
 *
 * Nothing here reads the clock: time changes how an item looks, never whether
 * it is finished.
 */
export function CompleteToggle({
  entry,
  onToggle,
  className,
}: {
  entry: TodayEntry
  onToggle: (key: string) => void
  className?: string
}) {
  const done = entry.completed

  return (
    <motion.button
      type="button"
      onClick={() => onToggle(entry.key)}
      aria-pressed={done}
      aria-label={`${done ? 'Undo' : 'Complete'} ${entry.item.title}`}
      whileTap={pressStrong.whileTap}
      transition={pressStrong.transition}
      className={cn(
        'relative z-10 grid size-11 shrink-0 place-items-center rounded-full border transition-colors duration-150',
        done
          ? 'border-completed/60 bg-completed/20 text-completed hover:bg-completed/30'
          : 'border-edge-strong bg-surface-overlay text-ink-faint hover:border-blue/60 hover:text-blue',
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={done ? 'done' : 'todo'}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ duration: duration.fast }}
          className="grid place-items-center"
        >
          {done ? (
            <Undo2 className="size-[18px]" aria-hidden="true" />
          ) : (
            <Check className="size-5" aria-hidden="true" />
          )}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}

/** Labelled variant used on the hero card, where there is room for words. */
export function CompleteButton({
  entry,
  onToggle,
  className,
}: {
  entry: TodayEntry
  onToggle: (key: string) => void
  className?: string
}) {
  const done = entry.completed

  return (
    <motion.button
      type="button"
      onClick={() => onToggle(entry.key)}
      aria-pressed={done}
      aria-label={`${done ? 'Undo' : 'Complete'} ${entry.item.title}`}
      whileTap={pressStrong.whileTap}
      transition={pressStrong.transition}
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 rounded-control px-5 text-sm font-extrabold tracking-tight transition-colors duration-150',
        done
          ? 'bg-completed/15 text-completed ring-1 ring-completed/50 hover:bg-completed/25'
          : 'bg-blue text-navy hover:bg-blue/90',
        className,
      )}
    >
      {done ? (
        <Undo2 className="size-[18px]" aria-hidden="true" />
      ) : (
        <Check className="size-[18px]" aria-hidden="true" />
      )}
      {done ? 'Undo' : 'Mark done'}
    </motion.button>
  )
}
