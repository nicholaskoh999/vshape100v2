import { Check, Loader2, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { duration, pressStrong } from '@/design/motion'
import { cn } from '@/lib/utils'
import type { TodayEntry } from '../model/types'

/**
 * The only way an item can become DONE EARLIER, and the only way back.
 *
 * Nothing here reads the clock: time changes how an item looks, never whether
 * it is finished. While the write is in flight the control is disabled and
 * shows a spinner, so a double tap cannot fire a second request and nothing
 * claims to be saved before the server says so.
 */
export function CompleteToggle({
  entry,
  onToggle,
  pending = false,
  disabled = false,
  className,
}: {
  entry: TodayEntry
  onToggle: (key: string) => void
  pending?: boolean
  disabled?: boolean
  className?: string
}) {
  const done = entry.completed
  const blocked = pending || disabled

  return (
    <motion.button
      type="button"
      onClick={() => onToggle(entry.key)}
      disabled={blocked}
      aria-busy={pending}
      aria-pressed={done}
      aria-label={`${done ? 'Undo' : 'Complete'} ${entry.item.title}`}
      whileTap={blocked ? undefined : pressStrong.whileTap}
      transition={pressStrong.transition}
      className={cn(
        'relative z-10 grid size-11 shrink-0 place-items-center rounded-full border transition-colors duration-150',
        done
          ? 'border-completed/60 bg-completed/20 text-completed hover:bg-completed/30'
          : 'border-edge-strong bg-surface-overlay text-ink-faint hover:border-blue/60 hover:text-blue',
        blocked && 'cursor-not-allowed opacity-60 hover:border-edge-strong',
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={pending ? 'pending' : done ? 'done' : 'todo'}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ duration: duration.fast }}
          className="grid place-items-center"
        >
          {pending ? (
            <Loader2 className="size-[18px] animate-spin" aria-hidden="true" />
          ) : done ? (
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
  pending = false,
  disabled = false,
  className,
}: {
  entry: TodayEntry
  onToggle: (key: string) => void
  pending?: boolean
  disabled?: boolean
  className?: string
}) {
  const done = entry.completed
  const blocked = pending || disabled

  return (
    <motion.button
      type="button"
      onClick={() => onToggle(entry.key)}
      disabled={blocked}
      aria-busy={pending}
      aria-pressed={done}
      aria-label={`${done ? 'Undo' : 'Complete'} ${entry.item.title}`}
      whileTap={blocked ? undefined : pressStrong.whileTap}
      transition={pressStrong.transition}
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 rounded-control px-5 text-sm font-extrabold tracking-tight transition-colors duration-150',
        done
          ? 'bg-completed/15 text-completed ring-1 ring-completed/50 hover:bg-completed/25'
          : 'bg-blue text-navy hover:bg-blue/90',
        blocked && 'cursor-not-allowed opacity-70',
        className,
      )}
    >
      {pending ? (
        <Loader2 className="size-[18px] animate-spin" aria-hidden="true" />
      ) : done ? (
        <Undo2 className="size-[18px]" aria-hidden="true" />
      ) : (
        <Check className="size-[18px]" aria-hidden="true" />
      )}
      {pending ? 'Saving…' : done ? 'Undo' : 'Mark done'}
    </motion.button>
  )
}
