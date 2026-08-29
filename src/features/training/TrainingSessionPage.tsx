import { ArrowLeft, ChevronRight } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, useParams } from 'react-router'

import { Card } from '@/components/ui/Card'
import { IntensityBadge } from '@/components/ui/IntensityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants, press } from '@/design/motion'
import { exercisePath } from './navigation'
import { getSession } from './sessions'

/** Nested shell: /training/:session */
export function TrainingSessionPage() {
  const { session: sessionId } = useParams()
  const session = getSession(sessionId)

  if (!session) {
    return (
      <>
        <BackToTraining />
        <PageHeader
          title="Session not found"
          subline="This training day does not exist in the Foundation base."
        />
      </>
    )
  }

  return (
    <>
      <BackToTraining />
      <PageHeader
        eyebrow={session.day}
        title={session.focus}
        subline="Set-by-set logging arrives in a later round."
        actions={<IntensityBadge intensity={session.intensity} />}
      />

      <motion.ol
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-3"
      >
        {session.exercises.map((exercise, index) => (
          <motion.li key={`${exercise.id}-${index}`} variants={listItemVariants}>
            <Link
              to={exercisePath(exercise.id, session.id)}
              className="block rounded-card"
            >
              <motion.div {...press}>
                <Card className="flex items-center gap-4 p-4 transition-colors duration-150 hover:border-edge-strong">
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-overlay text-sm font-extrabold text-ink-dim"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-offwhite">{exercise.name}</p>
                    <p className="mt-0.5 text-[13px] text-ink-faint">
                      {exercise.sets}
                      {exercise.equipment ? ` · ${exercise.equipment}` : ''}
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-ink-faint" aria-hidden="true" />
                </Card>
              </motion.div>
            </Link>
          </motion.li>
        ))}
      </motion.ol>
    </>
  )
}

function BackToTraining() {
  return (
    <Link
      to="/training"
      className="mb-4 inline-flex items-center gap-1.5 rounded-control text-[13px] font-semibold text-ink-faint transition-colors duration-150 hover:text-offwhite"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Training week
    </Link>
  )
}
