import { ChevronRight, Moon } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { IntensityBadge } from '@/components/ui/IntensityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants, press } from '@/design/motion'
import { trainingSessions } from './sessions'

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
    </>
  )
}
