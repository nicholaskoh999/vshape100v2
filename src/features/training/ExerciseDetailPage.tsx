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
        /*
          Round 09 — one measured column for the media and its prescriptions.

          The shell's content column grows to `xl:max-w-4xl`, which let the
          16:9 media stretch past the width a demo clip is actually watched at:
          the taller it got, the more the prescriptions below fell out of view.
          Capping the column at 44rem (704px) holds the media at a comfortable
          size on a wide screen without introducing a second page container.

          `w-full` keeps it fluid: the cap only engages once there is more room
          than that, so tablet and mobile are unchanged and nothing can exceed
          the padded shell column at any width.

          Both children are laid out by this one element, so the media and the
          prescription card share a width and a left edge — aligned with the
          page title above rather than centred away from it.

          The 16:9 ratio and the absence of a fixed media height stay where
          they belong, in ExerciseMedia's own Frame. Nothing here sets a
          height, so the media is still free to size itself from its width.
        */
        <div
          data-exercise-detail-column
          className="flex w-full max-w-[44rem] flex-col gap-4 md:gap-5"
        >
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
