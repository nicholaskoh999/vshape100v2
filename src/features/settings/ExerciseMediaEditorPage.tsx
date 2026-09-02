import { ArrowLeft, Loader2, Save, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { press } from '@/design/motion'
import { usedInSummary } from '@/features/training/catalog'
import { useProgramme } from '@/features/programme/programmeContext'
import { toTrainingSessions } from '@/features/programme/programmeApi'
import { ExerciseMedia } from '@/features/training/ExerciseMedia'
import {
  deleteExerciseMedia,
  saveExerciseMedia,
} from '@/features/training/exerciseMediaApi'
import { useExerciseMedia } from '@/features/training/useExerciseMedia'
import { ExerciseInputTypeCard } from './ExerciseInputTypeCard'
import { ExerciseProgrammeCard } from './ExerciseProgrammeCard'
import { cn } from '@/lib/utils'
import {
  isSafeMediaUrl,
  isUsefulAlt,
  MAX_MEDIA_ALT_LENGTH,
  MAX_MEDIA_URL_LENGTH,
  MEDIA_KINDS,
  type ExerciseMediaKind,
} from '@shared/exerciseMedia'

/**
 * Settings → Exercise Library → editor — /settings/exercises/:id
 *
 * The ONE canonical media editor. Exercise Detail links here rather than
 * carrying an editor of its own, so there is a single place this record is
 * written and a single piece of state behind it.
 *
 * Draft state is local and never touches D1 until Save. The preview reflects
 * the current *valid* draft, so an in-progress URL cannot make the page claim
 * media that is not there.
 */

const KIND_LABEL: Record<ExerciseMediaKind, string> = {
  gif: 'GIF',
  image: 'Image',
}

/** The editable fields. */
type Draft = {
  kind: ExerciseMediaKind
  url: string
  alt: string
}

/** What the last mutation is doing / did. Drives the live status line. */
type Feedback =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'removing' }
  | { state: 'removed' }
  | { state: 'error'; message: string }

export function ExerciseMediaEditorPage() {
  const { id } = useParams()
  /*
   * ROUND 22. Resolved from the account's PROGRAMME, so a renamed exercise
   * shows its new name here and a custom one — which was never in the static
   * Foundation week — has a settings page at all.
   */
  const { status, programme } = useProgramme()
  const exercise = programme?.exercises.find((e) => e.exerciseId === id)
  const weekdays = programme ? toTrainingSessions(programme) : []
  const entry = exercise
    ? {
        id: exercise.exerciseId,
        name: exercise.name,
        appearances: weekdays
          .filter((session) => session.exercises.some((e) => e.id === exercise.exerciseId))
          .map((session) => ({ sessionId: session.id, day: session.day })),
      }
    : undefined

  if (status === 'loading') {
    return (
      <>
        <BackToLibrary />
        <PageHeader eyebrow="Exercise Library" title="Loading" subline="Reading your programme." />
      </>
    )
  }

  if (!entry) {
    return (
      <>
        <BackToLibrary />
        <PageHeader
          eyebrow="Exercise Library"
          title="Exercise not found"
          subline="This exercise is not in your programme."
        />
      </>
    )
  }

  // Keyed by id so switching exercises starts from a clean draft rather than
  // carrying the previous exercise's URL across.
  return <Editor key={entry.id} exerciseId={entry.id} name={entry.name} usedIn={usedInSummary(entry)} />
}

function Editor({
  exerciseId,
  name,
  usedIn,
}: {
  exerciseId: string
  name: string
  usedIn: string
}) {
  const media = useExerciseMedia(exerciseId)
  const fieldId = useId()

  // The draft is an *override*: null means "whatever is saved". Deriving the
  // fields this way means the saved record flows into the form as soon as it
  // arrives, with no hydration effect and no chance of the form showing a
  // stale exercise's values.
  const [draft, setDraft] = useState<Draft | null>(null)
  const [feedback, setFeedback] = useState<Feedback>({ state: 'idle' })

  // A mutation in flight. A ref so the double-submit guard is decided
  // synchronously inside the handler, the same rule Today's toggle uses.
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)

  const saved: Draft = media.record
    ? { kind: media.record.kind, url: media.record.url, alt: media.record.alt }
    : // A sensible starting description, not a fake one: it says what the
      // media should show. The URL is never prefilled — there is no honest
      // value to put there.
      { kind: 'gif', url: '', alt: `${name} demonstration` }

  const { kind, url, alt } = draft ?? saved

  const edit = (patch: Partial<Draft>) => setDraft({ ...(draft ?? saved), ...patch })
  const setKind = (next: ExerciseMediaKind) => edit({ kind: next })

  const trimmedUrl = url.trim()
  const urlValid = isSafeMediaUrl(trimmedUrl)
  const altValid = isUsefulAlt(alt)
  const canSave = urlValid && altValid && !busy

  const hasPersisted = media.record !== null && media.status === 'ready'

  // The preview shows the current valid draft; anything less falls back to the
  // saved record, and failing that to the honest no-media state.
  const previewSource = urlValid && altValid
    ? { kind, url: trimmedUrl, alt: alt.trim() }
    : media.record
      ? { kind: media.record.kind, url: media.record.url, alt: media.record.alt }
      : null

  const previewResolution =
    media.status === 'loading' ? 'loading' : media.status === 'error' ? 'error' : 'ready'

  async function handleSave() {
    if (inFlight.current || !canSave) return
    inFlight.current = true
    setBusy(true)
    setFeedback({ state: 'saving' })

    try {
      const persisted = await saveExerciseMedia(exerciseId, {
        kind,
        url: trimmedUrl,
        alt: alt.trim(),
      })
      // Adopt what the server confirmed, never an assumed value, and drop
      // the draft override so the form now reflects the persisted record.
      media.adopt(persisted)
      setDraft(null)
      setFeedback({ state: 'saved' })
    } catch (error: unknown) {
      console.error('Exercise media could not be saved', error)
      setFeedback({ state: 'error', message: 'Could not save media. Nothing was changed.' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (inFlight.current || !hasPersisted) return
    inFlight.current = true
    setBusy(true)
    setFeedback({ state: 'removing' })

    try {
      // DELETE removes the record outright — it never saves a blank one.
      await deleteExerciseMedia(exerciseId)
      media.adopt(null)
      // No draft override either, so the form and the preview both fall back
      // to the honest no-media state.
      setDraft(null)
      setFeedback({ state: 'removed' })
    } catch (error: unknown) {
      console.error('Exercise media could not be removed', error)
      setFeedback({ state: 'error', message: 'Could not remove media. Nothing was changed.' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <BackToLibrary />

      <PageHeader
        eyebrow="Exercise settings"
        title={name}
        subline={`Used in ${usedIn}`}
      />

      <div className="flex flex-col gap-4">
        {/*
          First, because it changes what the app RECORDS, while everything
          below it changes only what the app shows.
        */}
        {/*
          The programme card first: it owns the name, which everything below is
          labelled by, and the weekdays this exercise is actually trained on.
        */}
        <ExerciseProgrammeCard exerciseId={exerciseId} />

        <ExerciseInputTypeCard exerciseId={exerciseId} name={name} />

        <ExerciseMedia media={previewSource} resolution={previewResolution} />

        <StatusLine media={media} feedback={feedback} />

        <Card className="flex flex-col gap-5 p-5">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-[13px] font-bold text-ink-dim">Media type</legend>
            <div role="radiogroup" aria-label="Media type" className="flex flex-wrap gap-2">
              {MEDIA_KINDS.map((option) => (
                <motion.button
                  {...press}
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={kind === option}
                  onClick={() => setKind(option)}
                  className={cn(
                    'rounded-control border px-4 py-2 text-sm font-bold transition-colors duration-150',
                    kind === option
                      ? 'border-blue bg-blue text-offwhite'
                      : 'border-edge bg-surface-overlay text-ink-dim hover:border-edge-strong',
                  )}
                >
                  {KIND_LABEL[option]}
                </motion.button>
              ))}
            </div>
          </fieldset>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor={`${fieldId}-url`}
              className="text-[13px] font-bold text-ink-dim"
            >
              Media URL
            </label>
            <input
              id={`${fieldId}-url`}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={MAX_MEDIA_URL_LENGTH}
              value={url}
              onChange={(event) => edit({ url: event.target.value })}
              aria-invalid={url.length > 0 && !urlValid}
              aria-describedby={`${fieldId}-url-help`}
              placeholder="https://…"
              className="w-full min-w-0 rounded-control border border-edge bg-surface-overlay px-3.5 py-2.5 text-sm text-offwhite placeholder:text-ink-faint focus:border-blue focus:outline-none"
            />
            <p
              id={`${fieldId}-url-help`}
              className={cn(
                'text-[12px]',
                url.length > 0 && !urlValid ? 'text-coral' : 'text-ink-faint',
              )}
            >
              {url.length > 0 && !urlValid
                ? 'Enter an absolute http:// or https:// address.'
                : 'Absolute http:// or https:// address of the demo file.'}
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor={`${fieldId}-alt`}
              className="text-[13px] font-bold text-ink-dim"
            >
              Alt / Label
            </label>
            <input
              id={`${fieldId}-alt`}
              type="text"
              maxLength={MAX_MEDIA_ALT_LENGTH}
              value={alt}
              onChange={(event) => edit({ alt: event.target.value })}
              aria-invalid={!altValid}
              aria-describedby={`${fieldId}-alt-help`}
              className="w-full min-w-0 rounded-control border border-edge bg-surface-overlay px-3.5 py-2.5 text-sm text-offwhite placeholder:text-ink-faint focus:border-blue focus:outline-none"
            />
            <p
              id={`${fieldId}-alt-help`}
              className={cn('text-[12px]', altValid ? 'text-ink-faint' : 'text-coral')}
            >
              {altValid
                ? 'What the media shows, for anyone who cannot see it.'
                : 'Describe what the media shows — this cannot be blank.'}
            </p>
          </div>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row">
          <motion.button
            {...press}
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="flex flex-1 items-center justify-center gap-2.5 rounded-card border border-blue bg-blue px-5 py-4 text-sm font-bold text-offwhite transition-opacity duration-150 disabled:opacity-50"
          >
            {feedback.state === 'saving' ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Saving
              </>
            ) : (
              <>
                <Save className="size-4" aria-hidden="true" />
                {hasPersisted ? 'Replace media' : 'Save media'}
              </>
            )}
          </motion.button>

          {hasPersisted && (
            <motion.button
              {...press}
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="flex items-center justify-center gap-2.5 rounded-card border border-edge bg-surface px-5 py-4 text-sm font-bold text-coral transition-colors duration-150 hover:border-coral/40 disabled:opacity-50"
            >
              {feedback.state === 'removing' ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Removing
                </>
              ) : (
                <>
                  <Trash2 className="size-4" aria-hidden="true" />
                  Remove media
                </>
              )}
            </motion.button>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * One live region for every state this page can be in, so no action ever
 * looks unresponsive and a screen reader hears the outcome.
 */
function StatusLine({
  media,
  feedback,
}: {
  media: ReturnType<typeof useExerciseMedia>
  feedback: Feedback
}) {
  const loadFailed = media.status === 'error'

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-6 flex-wrap items-center gap-2 text-[13px]"
    >
      {media.status === 'loading' && (
        <span className="flex items-center gap-2 text-ink-faint">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading current media
        </span>
      )}

      {loadFailed && (
        <>
          <span className="text-coral">Current media could not be loaded.</span>
          <button
            type="button"
            onClick={media.reload}
            className="rounded-control font-bold text-blue underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </>
      )}

      {!loadFailed && media.status === 'ready' && (
        <>
          {feedback.state === 'saving' && <span className="text-ink-faint">Saving…</span>}
          {feedback.state === 'saved' && <span className="text-completed">Saved</span>}
          {feedback.state === 'removing' && <span className="text-ink-faint">Removing…</span>}
          {feedback.state === 'removed' && <span className="text-ink-dim">Removed</span>}
          {feedback.state === 'error' && <span className="text-coral">{feedback.message}</span>}
          {feedback.state === 'idle' && (
            <span className="text-ink-faint">
              {media.record ? 'Media set for this exercise.' : 'No media set yet.'}
            </span>
          )}
        </>
      )}
    </div>
  )
}

function BackToLibrary() {
  return (
    <Link
      to="/settings/exercises"
      aria-label="Back to Exercise Library"
      className="mb-4 inline-flex items-center gap-1.5 rounded-control text-[13px] font-semibold text-ink-faint transition-colors duration-150 hover:text-offwhite"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Exercise Library
    </Link>
  )
}
