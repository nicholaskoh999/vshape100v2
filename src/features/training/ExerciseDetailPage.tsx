import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { useParams, useSearchParams } from 'react-router'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { ExerciseMedia } from './ExerciseMedia'
import { ORIGIN_PARAM, resolveExerciseReturn } from './navigation'
import { getExercise, trainingSessions } from './sessions'

/** Nested shell: /exercises/:id */
export function ExerciseDetailPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const found = getExercise(id)

  // The return target comes from the session that opened this exercise, never
  // from the exercise itself — the same exercise sits in several days. The raw
  // value is validated before it can become a link (see ./navigation).
  const back = resolveExerciseReturn(searchParams.get(ORIGIN_PARAM))

  const appearances = found
    ? trainingSessions.filter((session) =>
        session.exercises.some((exercise) => exercise.id === id),
      )
    : []

  return (
    <>
      <Link
        to={back.to}
        aria-label={`Back to ${back.label}`}
        className="mb-4 inline-flex items-center gap-1.5 rounded-control text-[13px] font-semibold text-ink-faint transition-colors duration-150 hover:text-offwhite"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {back.label}
      </Link>

      <PageHeader
        eyebrow="Exercise"
        title={found ? found.exercise.name : 'Exercise not found'}
        subline={
          found
            ? 'Demo media and logging connect here in a later round.'
            : 'This exercise is not part of the Foundation base.'
        }
      />

      {found && (
        <div className="flex flex-col gap-4">
          {/*
            The V2 media library is not populated yet, so no exercise carries
            a source and every one resolves to the no-media fallback. When the
            library lands, this is the only line that changes.
          */}
          <ExerciseMedia media={null} />

          <Card className="divide-y divide-edge">
            {appearances.map((session) => {
              const entry = session.exercises.find(
                (exercise) => exercise.id === id,
              )
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-4 px-5 py-3.5"
                >
                  <p className="text-sm font-bold text-ink-dim">{session.day}</p>
                  <p className="text-sm text-ink-faint">
                    {entry?.sets}
                    {entry?.equipment ? ` · ${entry.equipment}` : ''}
                  </p>
                </div>
              )
            })}
          </Card>
        </div>
      )}
    </>
  )
}
