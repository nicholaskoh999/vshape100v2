import { ArrowLeft, ChevronRight, ImageOff, Images, Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants, press } from '@/design/motion'
import {
  exerciseCatalog,
  usedInSummary,
  type CatalogExercise,
} from '@/features/training/catalog'
import { useExerciseMediaLibrary } from './useExerciseMediaLibrary'

/**
 * Settings → Exercise Library — /settings/exercises
 *
 * One row per unique exercise identity. Lat Pulldown appears once even though
 * the week trains it on Monday, Wednesday and Thursday; those days show up in
 * its "Used in" line instead. Each row opens the one canonical media editor
 * for that exercise.
 */
export function ExerciseLibraryPage() {
  const library = useExerciseMediaLibrary()

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
        subline="One media record per exercise, shared by every day it is trained."
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
            {exerciseCatalog.length} exercises · {library.withMedia.size} with media
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
}: {
  entry: CatalogExercise
  hasMedia: boolean
  known: boolean
}) {
  return (
    <Link
      to={`/settings/exercises/${entry.id}`}
      aria-label={`Edit media for ${entry.name}`}
      className="block rounded-card"
    >
      <motion.div {...press}>
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
