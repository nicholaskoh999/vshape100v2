import { Archive, ArrowLeft, ChevronRight, ImageOff, Images, Loader2 } from 'lucide-react'
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants, press } from '@/design/motion'
import { buildCatalog, usedInSummary, type CatalogExercise } from '@/features/training/catalog'
import { useProgramme } from '@/features/programme/programmeContext'
import { toTrainingSessions } from '@/features/programme/programmeApi'
import { AddExerciseCard } from './AddExerciseCard'
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
  /*
   * ROUND 22. The library is the account's OWN exercises — renamed ones,
   * custom ones, and the weekdays each is currently used on. The static
   * Foundation catalog is no longer read here; it is only what a new account
   * starts from.
   */
  const { status: programmeStatus, programme, reload: reloadProgramme } = useProgramme()

  const catalog = useMemo(
    () => (programme ? buildCatalog(toTrainingSessions(programme)) : []),
    [programme],
  )

  // An archived exercise, and a custom one with no weekday yet, both hold no
  // slot — so neither appears in a catalog built from the weekdays. They are
  // listed from the exercise master instead.
  const byId = new Map(catalog.map((entry) => [entry.id, entry]))
  const active = (programme?.exercises ?? [])
    .filter((exercise) => !exercise.archived)
    .map(
      (exercise) =>
        byId.get(exercise.exerciseId) ?? {
          id: exercise.exerciseId,
          name: exercise.name,
          appearances: [],
        },
    )
    // The catalog carries the name from the weekday; the master is the truth.
    .map((entry) => ({
      ...entry,
      name:
        programme?.exercises.find((e) => e.exerciseId === entry.id)?.name ?? entry.name,
    }))
  const archived = (programme?.exercises ?? []).filter((exercise) => exercise.archived)

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
        {programmeStatus === 'error' && (
          <>
            <span className="text-coral">Your programme could not be loaded.</span>
            <button
              type="button"
              onClick={reloadProgramme}
              className="rounded-control font-bold text-blue underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </>
        )}
        {library.status === 'ready' && programmeStatus === 'ready' && (
          <>
            {active.length} exercises · {library.withMedia.size} with media ·{' '}
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
        {active.map((entry) => (
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

      {programmeStatus === 'ready' && <AddExerciseCard />}

      {archived.length > 0 && (
        <section className="mt-6" data-archived-section>
          <h2 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
            <Archive className="size-3.5" aria-hidden="true" />
            Archived
          </h2>
          <p className="mb-3 text-[13px] text-ink-faint">
            Kept, with all their history and media. They hold no place in any
            weekday until you put them back.
          </p>
          <ul className="flex flex-col gap-2">
            {archived.map((exercise) => (
              <li key={exercise.exerciseId}>
                <Link
                  to={`/settings/exercises/${exercise.exerciseId}`}
                  aria-label={`Edit settings for ${exercise.name}`}
                  className="flex items-center gap-3 rounded-card border border-dashed border-edge px-4 py-3 transition-colors duration-150 hover:border-edge-strong"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-dim">
                    {exercise.name}
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-overlay px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                    Archived
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
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
