import { ArrowLeft, ChevronRight, ImageOff, Images, Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants, press } from '@/design/motion'
import {
  exerciseCatalog,
  usedInSummary,
  type CatalogExercise,
} from '@/features/training/catalog'
import { WORKOUT_INPUT_TYPE_LABELS, type WorkoutInputType } from '@shared/workoutInput'

import { useExerciseInputTypeLibrary } from './useExerciseInputTypeLibrary'
import { useExerciseMediaLibrary } from './useExerciseMediaLibrary'

/**
 * Settings → Exercise Library — /settings/exercises
 *
 * One row per unique exercise identity. Lat Pulldown appears once even though
 * the week trains it on Monday, Wednesday and Thursday; those days show up in
 * its "Used in" line instead. Each row opens that exercise's settings.
 *
 * Round 20 put the input type on these rows because it is the setting that
 * decides what the app RECORDS, and the user needs to see at a glance which
 * exercises they have answered for. An unanswered exercise says so rather than
 * showing a default — "not set" and "kilograms" are different facts.
 */
export function ExerciseLibraryPage() {
  const library = useExerciseMediaLibrary()
  const inputTypes = useExerciseInputTypeLibrary()

  return (
    <>
      <Link
        to="/settings"
        aria-label="Back to Settings"
        className="mb-4 inline-flex items-center gap-1.5 rounded-control text-[13px] font-semibold text-ink-faint transition-colors duration-150 hover:text-offwhite"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Settings
      </Link>

      <PageHeader
        eyebrow="Settings"
        title="Exercise Library"
        subline="One record per exercise, shared by every day it is trained."
      />

      <div
        role="status"
        aria-live="polite"
        className="mb-4 flex items-center gap-2 text-[13px] text-ink-faint"
      >
        {library.status === 'loading' && (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading media status
          </>
        )}
        {library.status === 'error' && (
          <>
            <span className="text-coral">Media status could not be loaded.</span>
            <button
              type="button"
              onClick={library.reload}
              className="rounded-control font-bold text-blue underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </>
        )}
        {library.status === 'ready' && (
          <>
            {exerciseCatalog.length} exercises · {library.withMedia.size} with media ·{' '}
            {inputTypes.status === 'ready'
              ? `${inputTypes.byExercise.size} with an input type`
              : 'checking input types'}
          </>
        )}
      </div>

      <motion.ul
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-3"
      >
        {exerciseCatalog.map((entry) => (
          <motion.li key={entry.id} variants={listItemVariants}>
            <ExerciseRow
              entry={entry}
              hasMedia={library.withMedia.has(entry.id)}
              known={library.status === 'ready'}
              inputType={inputTypes.byExercise.get(entry.id) ?? null}
              inputTypeKnown={inputTypes.status === 'ready'}
              inputTypeUnreadable={inputTypes.unreadable.has(entry.id)}
            />
          </motion.li>
        ))}
      </motion.ul>
    </>
  )
}

function ExerciseRow({
  entry,
  hasMedia,
  known,
  inputType,
  inputTypeKnown,
  inputTypeUnreadable,
}: {
  entry: CatalogExercise
  hasMedia: boolean
  known: boolean
  /** The stated input type, or null when this exercise has never been answered for. */
  inputType: WorkoutInputType | null
  inputTypeKnown: boolean
  /** A setting EXISTS for this exercise but could not be read. */
  inputTypeUnreadable: boolean
}) {
  return (
    <Link
      to={`/settings/exercises/${entry.id}`}
      aria-label={`Edit settings for ${entry.name}`}
      className="block rounded-card"
    >
      <motion.div {...press} tabIndex={-1}>
        <Card className="flex items-center gap-4 p-4.5 transition-colors duration-150 hover:border-edge-strong">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-overlay text-ink-dim"
          >
            {hasMedia ? <Images className="size-5" /> : <ImageOff className="size-5" />}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate font-extrabold tracking-tight text-offwhite">
              {entry.name}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-ink-faint">
              Used in {usedInSummary(entry)}
            </p>
            <p
              className={cn(
                'mt-0.5 truncate text-[12px] font-semibold',
                // An unreadable setting is a problem, not a blank. Saying "not
                // set" would hide that this exercise's workouts are refused.
                inputTypeUnreadable ? 'text-coral' : 'text-ink-faint',
              )}
            >
              {!inputTypeKnown
                ? 'Checking input type'
                : inputTypeUnreadable
                  ? 'Input type could not be read — set it again'
                  : inputType
                    ? WORKOUT_INPUT_TYPE_LABELS[inputType]
                    : 'Input type not set'}
            </p>
          </div>

          <span
            className={
              known && hasMedia
                ? 'shrink-0 rounded-full bg-surface-overlay px-3 py-1 text-[12px] font-bold text-completed'
                : 'shrink-0 rounded-full bg-surface-overlay px-3 py-1 text-[12px] font-bold text-ink-faint'
            }
          >
            {known ? (hasMedia ? 'Media set' : 'No media') : 'Checking'}
          </span>

          <ChevronRight className="size-5 shrink-0 text-ink-faint" aria-hidden="true" />
        </Card>
      </motion.div>
    </Link>
  )
}
