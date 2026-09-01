import { Check, HelpCircle, Lock } from 'lucide-react'
import { motion } from 'motion/react'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants } from '@/design/motion'
import { cn } from '@/lib/utils'

import { milestoneProgressLabel, type Milestone } from './model/milestones'
import type { StreakEvaluation, StreakUnavailableReason } from './model/streak'
import { useAchievements } from './useAchievements'

/**
 * Achievements — derived, never stored.
 *
 * Every number on this page is recomputed from recorded workouts, Holiday
 * records and the local calendar date. Nothing is unlocked as an event, which
 * is why no card shows a date: the app never recorded one and will not invent
 * it.
 *
 * The page's other job is to say when it does not know. A streak needs
 * complete workout AND Holiday truth for the whole window; without it the
 * numbers are withheld rather than guessed, because guessing would turn a
 * planned Holiday into a missed session.
 */

export function AchievementsPage() {
  const { streak, milestones, reload } = useAchievements()

  return (
    <>
      <PageHeader
        eyebrow="Foundation"
        title="Achievements"
        subline="Milestones unlock as the Foundation progresses"
      />

      <motion.div
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-4"
      >
        <motion.div variants={listItemVariants}>
          <StreakSummary streak={streak} onRetry={reload} />
        </motion.div>

        <motion.ul
          variants={listVariants}
          className="grid grid-cols-2 gap-3 md:grid-cols-3"
        >
          {milestones.map((milestone) => (
            <motion.li key={milestone.id} variants={listItemVariants}>
              <MilestoneCard milestone={milestone} />
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Streak summary                                                      */
/* ------------------------------------------------------------------ */

/** Plain-language reason a streak cannot be stated. */
const UNAVAILABLE_COPY: Record<StreakUnavailableReason, string> = {
  holidays: 'Holiday days could not be loaded, so rest days cannot be told from missed ones.',
  workouts: 'Recorded workouts could not be loaded.',
  coverage: 'The workout history returned did not cover the whole period.',
  range: 'The period to measure could not be worked out.',
  provenance:
    'A recorded workout could not be read as scheduled or extra, so this period cannot be judged.',
  flex: 'Your recovery and alternative-activity days could not be loaded, so a resolved day cannot be told from a missed one.',
}

function StreakSummary({
  streak,
  onRetry,
}: {
  streak: StreakEvaluation
  onRetry: () => void
}) {
  return (
    <Card className="p-5">
      {/* Card does not forward extra props, so the marker lives here. */}
      <div data-streak-summary data-streak-state={streak.status}>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
          Training streak
        </p>

        {streak.status === 'checking' && (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">
            Checking streak
          </p>
        )}

        {streak.status === 'unavailable' && (
          <div className="mt-2">
            <p className="text-[15px] font-extrabold tracking-tight text-offwhite">
              Streak unavailable
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
              {UNAVAILABLE_COPY[streak.reason]} Nothing has been counted as missed.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite"
            >
              Try again
            </button>
          </div>
        )}

        {streak.status === 'ready' && (
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Current streak" value={streak.facts.current} unit="training days" />
            <Stat label="Best streak" value={streak.facts.best} unit="training days" />
            <Stat
              label="Sessions finished"
              value={streak.facts.qualifyingSessions}
              unit="sessions"
            />
          </dl>
        )}

        <p className="mt-4 text-[12px] leading-relaxed text-ink-faint">
          Weekends and Holidays are exempt — they never break a streak.
        </p>
      </div>
    </Card>
  )
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-[22px] font-extrabold tabular-nums tracking-tight text-offwhite">
        {value}
        <span className="ml-1 text-[11px] font-semibold text-ink-faint">
          {value === 1 ? unit.replace(/s$/, '') : unit}
        </span>
      </dd>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

function MilestoneCard({ milestone }: { milestone: Milestone }) {
  const state = milestone.state.status
  const unlocked = state === 'unlocked'
  const progress = milestoneProgressLabel(milestone)

  return (
    <div
      data-milestone={milestone.id}
      data-milestone-state={state}
      className={cn(
        'flex h-full flex-col items-center gap-2.5 rounded-card border px-3 py-6 text-center',
        unlocked
          ? 'border-edge-strong bg-surface'
          : 'border-dashed border-edge bg-surface/50',
      )}
    >
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-full',
          unlocked ? 'bg-blue/15 text-blue' : 'bg-surface-overlay text-ink-faint',
        )}
      >
        {unlocked ? (
          <Check className="size-4.5" aria-hidden="true" />
        ) : state === 'unresolved' ? (
          <HelpCircle className="size-4.5" aria-hidden="true" />
        ) : (
          <Lock className="size-4.5" aria-hidden="true" />
        )}
      </span>

      <p
        className={cn(
          'text-[13px] font-bold',
          unlocked ? 'text-offwhite' : 'text-ink-faint',
        )}
      >
        {milestone.label}
      </p>

      {/* One status line, never a fabricated unlock date. */}
      <p className="text-[11px] font-semibold text-ink-faint">
        {unlocked ? 'Unlocked' : state === 'unresolved' ? 'Checking' : progress}
      </p>

      <span className="sr-only">{milestone.description}</span>
    </div>
  )
}
