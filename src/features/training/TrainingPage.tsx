import { ChevronRight, Moon, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { IntensityBadge } from '@/components/ui/IntensityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants, press } from '@/design/motion'
import { useLocalToday } from '@/features/progress/useLocalToday'
import { EXTRA_SESSION_ID, extraSnapshotLabel } from './extra'
import { trainingSessions } from './sessions'
import { useWorkoutLog } from './useWorkoutLog'

const restDays = [
  { day: 'Saturday', label: 'Chill · no gym' },
  { day: 'Sunday', label: 'Recovery · no gym' },
]

export function TrainingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Home Mode"
        title="Training"
        subline="Monday–Friday Foundation base"
      />

      <motion.ul
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-3"
      >
        {trainingSessions.map((session) => (
          <motion.li key={session.id} variants={listItemVariants}>
            <Link to={`/training/${session.id}`} className="block rounded-card">
              <motion.div {...press}>
                <Card className="flex items-center gap-4 p-4.5 transition-colors duration-150 hover:border-edge-strong">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                        {session.day}
                      </span>
                      <IntensityBadge intensity={session.intensity} />
                    </div>
                    <p className="truncate font-extrabold tracking-tight text-offwhite">
                      {session.focus}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-faint">
                      {session.exercises.length} exercises
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-ink-faint" aria-hidden="true" />
                </Card>
              </motion.div>
            </Link>
          </motion.li>
        ))}

        {restDays.map(({ day, label }) => (
          <motion.li key={day} variants={listItemVariants}>
            <div className="flex items-center gap-3.5 rounded-card border border-dashed border-edge px-4.5 py-3.5">
              <Moon className="size-4 text-ink-faint" aria-hidden="true" />
              <p className="text-sm text-ink-faint">
                <span className="font-bold text-ink-dim">{day}</span> · {label}
              </p>
            </div>
          </motion.li>
        ))}
      </motion.ul>

      <ExtraWorkoutEntry />
    </>
  )
}

/**
 * The way into an Extra Workout.
 *
 * Deliberately BELOW the Foundation week and visually secondary: the
 * Monday–Friday programme is the schedule, and an extra session is an
 * exception to it, not a peer. It is a dashed, quieter card for the same
 * reason the Recovery rows are — it must be easy to find and impossible to
 * mistake for a scheduled obligation.
 *
 * It reads today's Extra so it can say Resume rather than offering to start a
 * second one. Reading is all it does: no occurrence is created by looking.
 */
function ExtraWorkoutEntry() {
  // The CURRENT local date, resynced at the next local midnight and whenever
  // the tab wakes. This entry only ever reads, so there is nothing to pin: once
  // the day turns, today has no Extra yet and the card correctly goes back to
  // offering one instead of claiming yesterday's is in progress.
  const date = useLocalToday()
  const workout = useWorkoutLog(date, EXTRA_SESSION_ID)

  const started = workout.status === 'ready' && workout.started
  // Frozen snapshot identity, not a lookup against today's template.
  const sourceLabel = extraSnapshotLabel(workout.occurrence)

  return (
    <div className="mt-6">
      <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
        Outside the schedule
      </p>

      <Link to="/training/extra" className="block rounded-card">
        <motion.div {...press}>
          <Card className="flex items-center gap-4 border-dashed p-4.5 transition-colors duration-150 hover:border-edge-strong">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-overlay text-ink-dim"
            >
              <Plus className="size-5" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="font-extrabold tracking-tight text-offwhite">
                {started ? 'Resume extra workout' : 'Extra workout'}
              </p>
              <p className="mt-0.5 truncate text-[13px] text-ink-faint">
                {workout.status === 'loading'
                  ? 'Checking…'
                  : started
                    ? // The frozen source template identity, so the user knows
                      // which session is already underway before opening it.
                      `In progress · based on ${sourceLabel ?? workout.occurrence?.day ?? 'a Foundation session'}`
                    : 'Train again today, on top of your schedule'}
              </p>
            </div>

            <ChevronRight className="size-5 shrink-0 text-ink-faint" aria-hidden="true" />
          </Card>
        </motion.div>
      </Link>
    </div>
  )
}
