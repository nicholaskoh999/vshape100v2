import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ListChecks,
} from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/Feedback'
import { useImmersive } from '@/app/shell/immersive'
import { cn } from '@/lib/utils'
import { WORKOUT_INPUT_TYPE_LABELS, type WorkoutInputType } from '@shared/workoutInput'
import type { WorkoutProgress } from '@shared/workoutLog'

import { ExerciseMedia } from './ExerciseMedia'
import { toMediaSource } from './exerciseMediaApi'
import { useExerciseMedia } from './useExerciseMedia'
import type { AccordionModality } from './ExerciseAccordion'
import type { SessionExercise } from './sessions'
import type { WorkoutLoad, WorkoutSet } from './workoutApi'
import { firstPendingExercise } from './focusedSelection'
import { setKey, type SetKey } from './useWorkoutLog'
import {
  PendingSetControls,
  ResolvedSetRow,
  type WorkoutSetListProps,
} from './WorkoutSetList'

/**
 * FOCUSED WORKOUT MODE — ONE EXERCISE, ONE SET, ONE ACTION.
 *
 * Round 24 correction (Blocker 3). The session screen is a good session
 * OVERVIEW: every exercise, collapsed, with the whole week's navigation still
 * on screen. It is a bad thing to be holding at arm's length between sets. This
 * is the other half — entered deliberately from Continue workout, left
 * deliberately by Back to all exercises, and never the thing that happens to
 * you when you tap Start.
 *
 * WHAT IT IS ALLOWED TO DECIDE: which exercise to open first, and nothing else.
 *
 * WHAT IT IS NOT ALLOWED TO DO, and does not:
 *
 *   IT DOES NOT GUESS THE CURRENT EXERCISE. The opening exercise is the one
 *   holding the first PENDING set, read from the persisted workout — the same
 *   truth the progress counter is derived from. Not "the one you looked at
 *   last", not "the first one with no logged sets".
 *
 *   IT WRITES NOTHING ON ENTRY. Opening the workspace issues no request of any
 *   kind. Every mutation is still an explicit Complete, Skip or Undo, and each
 *   goes through exactly the same handler the accordion uses.
 *
 *   IT DOES NOT TOUCH THE SNAPSHOT. Exercises, their order, set identity and
 *   set modality all come from what the workout was started with. This screen
 *   re-arranges nothing and re-numbers nothing.
 *
 *   IT AUTO-COMPLETES NOTHING, and prefills nothing. The set controls are
 *   literally the same component the accordion renders — see
 *   `PendingSetControls` — so "kg each" means per dumbbell here too, a band
 *   set has no kilogram field here either, and a bodyweight set has no load
 *   field at all.
 *
 *   IT DOES NOT MOVE UNDER YOU. The opening exercise is derived ONCE, when
 *   focus is entered. After that the exercise changes only when the user says
 *   so. Completing the last set of an exercise offers the next one; it does
 *   not perform it.
 *
 * When every set is resolved there is no current set to invent, so it says the
 * workout is complete instead.
 */

export type FocusedWorkoutProps = {
  /** The exercises of this workout, in performance order, from the snapshot. */
  exercises: SessionExercise[]
  /** Every set of the workout. */
  sets: WorkoutSet[]
  progress: WorkoutProgress
  busySet: SetKey | null
  mutationError: string | null
  /** The page's per-position modality verdict — known, disagreeing, or not yet. */
  modalityAt: AccordionModality
  /** A load derived guidance can offer for one exercise. Offered, never applied. */
  suggestedLoadFor?: (exerciseOrder: number) => WorkoutLoad | null
  suggestionLocked?: boolean
  onComplete: WorkoutSetListProps['onComplete']
  onSkip: WorkoutSetListProps['onSkip']
  onUndo: WorkoutSetListProps['onUndo']
  /** Back to the session overview. */
  onExit: () => void
}

export function FocusedWorkout({
  exercises,
  sets,
  progress,
  busySet,
  mutationError,
  modalityAt,
  suggestedLoadFor,
  suggestionLocked = false,
  onComplete,
  onSkip,
  onUndo,
  onExit,
}: FocusedWorkoutProps) {
  // Complete set owns the bottom of the phone while this is on screen.
  useImmersive(true)

  /*
   * Derived ONCE, on entry, from persisted state. `chosen` is the user's own
   * navigation and always wins after that — which is what keeps Undo reachable
   * on the set that was just completed.
   */
  const [opening] = useState(() => firstPendingExercise(sets))
  const [chosen, setChosen] = useState<number | null>(null)
  const active = clamp(chosen ?? opening ?? 0, 0, exercises.length - 1)

  const exercise = exercises[active]
  const exerciseSets = sets
    .filter((set) => set.exerciseOrder === active)
    .sort((a, b) => a.setIndex - b.setIndex)

  // The set being worked: the first still unresolved in THIS exercise.
  const currentSet = exerciseSets.find((set) => set.status === 'pending') ?? null
  const resolvedSets = exerciseSets.filter((set) => set.status !== 'pending')
  const remaining = exerciseSets.filter((set) => set.status === 'pending').length

  // DERIVED from the server's own counts. Nothing new is stored.
  const finished = progress.total > 0 && progress.resolved === progress.total

  /*
   * The same verdict the accordion uses, for the same reason: while the frozen
   * modality and the account's current setting disagree — or while the current
   * setting has simply not been read yet — the frozen controls stay, because
   * they are what the logged sets mean, but nothing DERIVED is offered on top
   * of them.
   */
  const verdict = modalityAt(active)
  const actionable = verdict === null
  const suggestedLoad = actionable ? (suggestedLoadFor?.(active) ?? null) : null

  const previous = active > 0 ? exercises[active - 1] : null
  const next = active < exercises.length - 1 ? exercises[active + 1] : null

  return (
    <div data-focused-workout className="pb-28 md:pb-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onExit}>
          <ChevronLeft className="size-4.5" aria-hidden="true" />
          Back to all exercises
        </Button>
        {finished ? (
          <Badge tone="done" icon={CheckCircle2}>
            Workout complete
          </Badge>
        ) : (
          <Badge tone="current">In progress</Badge>
        )}
      </div>

      {/* Session progress, always visible, never added together. */}
      <section
        aria-label="Workout progress"
        className="rounded-card border border-line bg-surface p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[15px] font-bold text-ink">
            {progress.resolved} / {progress.total} sets resolved
          </p>
          <p className="text-[13px] font-semibold text-ink-2">
            {progress.completed} completed · {progress.skipped} skipped
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.resolved}
          aria-label="Sets resolved"
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className="h-full rounded-full bg-accent-edge"
            style={{
              width: `${progress.total === 0 ? 0 : Math.round((progress.resolved / progress.total) * 100)}%`,
            }}
          />
        </div>
      </section>

      {/*
        ONE COLUMN UNTIL THERE IS GENUINELY ROOM FOR TWO.

        A 834px tablet minus the navigation rail and the page gutters leaves
        about 650px, and splitting that in half gives two columns too narrow
        for either job — the media shrinks to a thumbnail and "Completed · 12
        reps · 22.5kg each" wraps onto three lines. So the split waits for
        `lg`, and the tablet gets the phone's stacked layout at a comfortable
        width, with the action row back in the flow (there is no bottom bar to
        stand down from up here).
      */}
      <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* Left: what you are doing. */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
            Exercise {active + 1} of {exercises.length}
          </p>
          <h2 className="mt-1 text-[23px] font-bold leading-tight tracking-[-0.02em] text-ink">
            {exercise.name}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="outline">{exercise.sets}</Badge>
            {exercise.equipment && <Badge tone="neutral">{exercise.equipment}</Badge>}
            <Badge tone="neutral">
              {resolvedSets.length} / {exerciseSets.length} logged
            </Badge>
          </div>

          <FocusMedia exerciseId={exercise.id} />
        </div>

        {/* Right: what you are about to record. */}
        <div className="mt-5 lg:mt-0">
          {verdict?.kind === 'mismatch' && (
            <Banner
              tone="danger"
              live="status"
              className="mb-3.5"
              title="This exercise’s input type changed after the workout started"
            >
              It is frozen as{' '}
              <strong className="font-bold text-ink">
                {WORKOUT_INPUT_TYPE_LABELS[verdict.frozen as WorkoutInputType]}
              </strong>
              ; your current setting is{' '}
              <strong className="font-bold text-ink">
                {WORKOUT_INPUT_TYPE_LABELS[verdict.current as WorkoutInputType]}
              </strong>
              . Nothing has been converted, and what you already recorded is unchanged.
            </Banner>
          )}

          {verdict?.kind === 'unverified' && (
            <Banner
              tone="info"
              live="status"
              className="mb-3.5"
              title={
                verdict.reason === 'error'
                  ? 'Current input type could not be verified'
                  : 'Checking this exercise’s current input type'
              }
            >
              Load guidance is paused. Logging is unaffected — this workout keeps the
              controls it was started with.
            </Banner>
          )}

          {currentSet ? (
            <section
              aria-label={`Set ${currentSet.setIndex + 1} of ${exercise.name}`}
              data-focused-set={currentSet.setIndex}
              className={cn(
                'rounded-card border-2 border-accent-edge bg-surface p-4',
                busySet === setKey(currentSet.exerciseOrder, currentSet.setIndex) &&
                  'opacity-70',
              )}
            >
              <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[17px] font-bold text-ink">
                  Set {currentSet.setIndex + 1}
                </p>
                <Badge tone="current">Current set</Badge>
              </div>

              <PendingSetControls
                key={setKey(currentSet.exerciseOrder, currentSet.setIndex)}
                set={currentSet}
                busy={busySet === setKey(currentSet.exerciseOrder, currentSet.setIndex)}
                locked={busySet !== null}
                suggestedLoad={suggestedLoad}
                suggestionLocked={suggestionLocked}
                completeLabel="Complete set"
                /*
                  On a phone the action row leaves the flow and pins itself to
                  the bottom of the viewport, where the navigation bar would
                  otherwise be — the bar stands down for exactly this. From
                  md up there is room for it to sit under its own controls.
                */
                actionsClassName="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_28px_rgba(23,26,21,0.07)] md:static md:mt-1 md:border-0 md:bg-transparent md:p-0 md:shadow-none"
                onComplete={onComplete}
                onSkip={onSkip}
              />

              {remaining > 1 && (
                <p className="mt-3 text-xs text-ink-3">
                  {remaining - 1} more {remaining - 1 === 1 ? 'set' : 'sets'} after this one.
                </p>
              )}
            </section>
          ) : (
            <section
              aria-label="Nothing left to log here"
              className="rounded-card border border-success-ink/30 bg-success-soft p-4"
            >
              <p className="flex items-center gap-2 text-[15px] font-bold text-success-ink">
                <CheckCircle2 className="size-[18px]" aria-hidden="true" />
                {finished ? 'Workout complete' : `${exercise.name} is done`}
              </p>
              <p className="mt-1 text-[13px] text-ink-2">
                {finished
                  ? 'Every set in this workout is resolved. Nothing is left to log.'
                  : 'Every set of this exercise is resolved. Move on when you are ready.'}
              </p>
            </section>
          )}

          {mutationError && (
            <p role="alert" className="mt-3 text-[13px] font-semibold text-danger-ink">
              {mutationError}
            </p>
          )}

          {resolvedSets.length > 0 && (
            <section aria-label={`Sets already logged for ${exercise.name}`} className="mt-4">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
                This exercise so far
              </h3>
              <ol className="flex flex-col gap-2.5">
                {resolvedSets.map((set) => (
                  <ResolvedSetRow
                    key={setKey(set.exerciseOrder, set.setIndex)}
                    set={set}
                    label={`Set ${set.setIndex + 1}`}
                    busy={busySet === setKey(set.exerciseOrder, set.setIndex)}
                    locked={busySet !== null}
                    onUndo={onUndo}
                  />
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>

      {/* Moving between exercises is always explicit and always named. */}
      <nav aria-label="Exercises in this workout" className="mt-5 flex flex-wrap gap-2.5">
        <Button
          onClick={() => setChosen(active - 1)}
          disabled={previous === null}
          aria-label={previous ? `Previous exercise: ${previous.name}` : 'Previous exercise'}
        >
          <ArrowLeft className="size-4.5" aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant={currentSet === null && next !== null ? 'primary' : 'secondary'}
          onClick={() => setChosen(active + 1)}
          disabled={next === null}
          className="flex-1"
          aria-label={next ? `Next exercise: ${next.name}` : 'Next exercise'}
        >
          {next ? `Next: ${next.name}` : 'Last exercise'}
          <ArrowRight className="size-4.5" aria-hidden="true" />
        </Button>
        <Button variant="ghost" onClick={onExit}>
          <ListChecks className="size-4.5" aria-hidden="true" />
          All exercises
        </Button>
      </nav>
    </div>
  )
}

/**
 * The demo media for the exercise being worked.
 *
 * `resolution` keeps "still loading" apart from "no media set", so a slow read
 * never briefly claims there is nothing to show.
 */
function FocusMedia({ exerciseId }: { exerciseId: string }) {
  const media = useExerciseMedia(exerciseId)
  if (media.status === 'ready' && media.record === null) return null
  return (
    // Capped on the stacked tablet layout: full width there is a 470px-tall
    // clip that pushes the set being logged off the fold, which is the one
    // thing this screen exists to keep in front of you.
    <div className="mt-4 md:max-w-[26rem] lg:max-w-none">
      <ExerciseMedia media={toMediaSource(media.record)} resolution={media.status} />
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}
