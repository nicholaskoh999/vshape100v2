import { ArrowLeft, Pencil } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { useParams, useSearchParams } from 'react-router'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { press } from '@/design/motion'
import { ExerciseMedia } from './ExerciseMedia'
import { toMediaSource } from './exerciseMediaApi'
import { ORIGIN_PARAM, resolveExerciseReturn } from './navigation'
import { getExercise, trainingSessions } from './sessions'
import { useExerciseMedia } from './useExerciseMedia'

/** Nested shell: /exercises/:id */
export function ExerciseDetailPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const found = getExercise(id)

  // The canonical record for this exercise identity — the same one the
  // Settings editor writes. Lat Pulldown resolves to it from Monday,
  // Wednesday and Thursday alike, because the lookup key is the slug only.
  const media = useExerciseMedia(found ? id : undefined)

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
            ? 'Demo media is shared by every day this exercise is trained.'
            : 'This exercise is not part of the Foundation base.'
        }
        actions={
          found ? (
            <Link
              to={`/settings/exercises/${found.exercise.id}`}
              aria-label={`Edit media for ${found.exercise.name}`}
              className="shrink-0 rounded-control"
            >
              <motion.span
                {...press}
                className="inline-flex items-center gap-1.5 rounded-control border border-edge bg-surface-overlay px-3 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:border-edge-strong hover:text-offwhite"
              >
                <Pencil className="size-4" aria-hidden="true" />
                Edit media
              </motion.span>
            </Link>
          ) : undefined
        }
      />

      {found && (
        <div className="flex flex-col gap-4">
          {/*
            Read-only here. There is no second media editor on this page — the
            "Edit media" action above goes to the one canonical editor, so this
            record has a single writer.

            `resolution` keeps "still loading" distinct from "no media set":
            without it a slow read would briefly claim "Media coming soon",
            which is not true yet, and a failed read would claim it
            permanently.
          */}
          <ExerciseMedia
            media={toMediaSource(media.record)}
            resolution={media.status}
          />

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
