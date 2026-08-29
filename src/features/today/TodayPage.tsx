import { ChevronRight, Moon, Scale, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { EmptyShell } from '@/components/ui/EmptyShell'
import { IntensityBadge } from '@/components/ui/IntensityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants, press } from '@/design/motion'
import { trainingSessions } from '@/features/training/sessions'

const FOUNDATION_DAY_1 = new Date(2026, 7, 31) // 2026-08-31 local time
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Foundation day number by real calendar date. Day 100 is a milestone, not an end. */
function foundationDay(now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor((today.getTime() - FOUNDATION_DAY_1.getTime()) / MS_PER_DAY) + 1
}

const weekdaySessionIds = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

export function TodayPage() {
  const now = new Date()
  const day = foundationDay(now)
  const weekday = now.getDay() // 0 = Sunday
  const session = trainingSessions.find(
    (entry) => entry.id === weekdaySessionIds[weekday - 1],
  )

  const dateLabel = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <>
      <PageHeader
        eyebrow={
          day < 1
            ? `Foundation starts in ${1 - day} day${1 - day === 1 ? '' : 's'}`
            : `Foundation · Day ${day}`
        }
        title="Today"
        subline={dateLabel}
      />

      <motion.div
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-4"
      >
        <motion.div variants={listItemVariants}>
          {session ? (
            <Link to={`/training/${session.id}`} className="block rounded-card">
              <motion.div {...press}>
                <Card className="flex items-center gap-4 p-5 transition-colors duration-150 hover:border-edge-strong">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center gap-2">
                      <IntensityBadge intensity={session.intensity} />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                        20:30 – 21:30
                      </span>
                    </div>
                    <p className="truncate text-lg font-extrabold tracking-tight text-offwhite">
                      {session.focus}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-faint">
                      {session.exercises.length} exercises · Home Mode
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-ink-faint" aria-hidden="true" />
                </Card>
              </motion.div>
            </Link>
          ) : (
            <Card className="flex items-center gap-4 p-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-light-day/15 text-light-day">
                <Moon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-lg font-extrabold tracking-tight text-offwhite">
                  {weekday === 6 ? 'Chill route' : 'Recovery route'}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-faint">
                  {weekday === 6
                    ? 'No gym today — flexible after work.'
                    : 'No gym — weekly progress check + room reset.'}
                </p>
              </div>
            </Card>
          )}
        </motion.div>

        <motion.div variants={listItemVariants}>
          <EmptyShell
            icon={Sparkles}
            title="Your day builds here"
            note="NOW / NEXT / LATER routine flow arrives with the daily engine in an upcoming round."
          />
        </motion.div>

        <motion.div variants={listItemVariants}>
          <EmptyShell
            icon={Scale}
            title="Weight check-in"
            note="Optional daily weight logging lands together with local data storage."
          />
        </motion.div>
      </motion.div>
    </>
  )
}
