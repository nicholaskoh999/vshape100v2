import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'

import { IntensityBadge } from '@/components/ui/IntensityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { ExerciseAccordion } from './ExerciseAccordion'
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
        subline="Tap an exercise for its prescription."
        actions={<IntensityBadge intensity={session.intensity} />}
      />

      {/* Session-keyed so the open row resets when the day changes. */}
      <ExerciseAccordion key={session.id} session={session} />
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
