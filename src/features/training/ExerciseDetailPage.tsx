import { ArrowLeft, ImageOff } from 'lucide-react'
import { Link } from 'react-router'
import { useParams } from 'react-router'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { getExercise, trainingSessions } from './sessions'

/** Nested shell: /exercises/:id */
export function ExerciseDetailPage() {
  const { id } = useParams()
  const found = getExercise(id)

  const appearances = found
    ? trainingSessions.filter((session) =>
        session.exercises.some((exercise) => exercise.id === id),
      )
    : []

  return (
    <>
      <Link
        to="/training"
        className="mb-4 inline-flex items-center gap-1.5 rounded-control text-[13px] font-semibold text-ink-faint transition-colors duration-150 hover:text-offwhite"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Training
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
          {/* ExerciseMedia slot — external URL first, fallback always present. */}
          <Card className="grid aspect-video place-items-center overflow-hidden">
            <div className="flex flex-col items-center gap-2 text-ink-faint">
              <ImageOff className="size-7" aria-hidden="true" />
              <p className="text-[13px] font-semibold">Media coming soon</p>
            </div>
          </Card>

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
