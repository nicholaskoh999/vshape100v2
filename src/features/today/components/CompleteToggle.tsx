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
        'relative z-10 grid size-tap shrink-0 place-items-center rounded-full border transition-colors duration-fast',
        done
          ? 'border-success-ink/40 bg-success-soft text-success-ink hover:border-success-ink/70'
          : 'border-line-control bg-surface text-ink-2 hover:border-ink hover:text-ink',
        blocked && 'cursor-not-allowed opacity-60 hover:border-line-control',
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
        'on-fill inline-flex min-h-tap items-center justify-center gap-2 rounded-control border px-5 text-sm font-bold transition-colors duration-fast',
        done
          ? 'border-success-ink/30 bg-success-soft text-success-ink hover:border-success-ink/55'
          : 'border-line-strong bg-surface text-ink hover:border-ink-4',
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
