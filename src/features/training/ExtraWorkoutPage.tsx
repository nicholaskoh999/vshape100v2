import { ArrowLeft, Check, Loader2, Play, RefreshCw } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { IntensityBadge } from '@/components/ui/IntensityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { press } from '@/design/motion'
import { useLocalToday } from '@/features/progress/useLocalToday'
import { cn } from '@/lib/utils'
import { motion } from 'motion/react'

import { ExerciseAccordion } from './ExerciseAccordion'
import {
  EXTRA_SESSION_ID,
  buildExtraPlan,
  extraSessionFromSnapshot,
  extraSnapshotLabel,
  isExtraOccurrence,
  toExtraStartPayload,
} from './extra'
import { useExerciseInputTypeLibrary } from '@/features/settings/useExerciseInputTypeLibrary'
import { modalityMismatchAt } from './inputTypeMismatch'
import { useProgramme } from '@/features/programme/programmeContext'
import { toTrainingSessions, type TrainingSessionView } from '@/features/programme/programmeApi'
import { useWorkoutLog } from './useWorkoutLog'

/**
 * Extra Workout — /training/extra
 *
 * A voluntary additional workout on the CURRENT LOCAL DAY, copied from one
 * Foundation session. There is no date picker: an Extra is something you are
 * doing now, not something you back-fill or plan.
 *
 * Round 16 guidance is deliberately absent from this page. No progression
 * request is made, no calibration is offered, and no suggested load is shown —
 * an Extra records what was actually performed and nothing else. That is
 * enforced structurally: the accordion below is never handed a `guidance`
 * prop, so there is no state in which those controls could render.
 */
export function ExtraWorkoutPage() {
  // The user's own calendar date, kept CURRENT while the page stays mounted —
  // one armed timeout for the next local midnight, plus a resync when the tab
  // becomes visible or regains focus, so a slept-through timer is harmless.
  // The same accepted helper Progress uses; no polling, no hardcoded zone.
  const liveToday = useLocalToday()

  // …but a workout that has already been STARTED stays bound to the date it
  // was started under. Once an occurrence exists, `pinnedDate` holds it there:
  // an Extra begun at 23:58 must not migrate to tomorrow at midnight, because
  // the sets already logged happened yesterday and history is not moved.
  //
  // Before Start there is nothing to pin, so the identity follows the clock.
  // That is what closes the rollover hole: open the chooser at 23:58, cross
  // midnight, press Start at 00:05, and the workout is created under the NEW
  // date — the day it was actually performed.
  const [pinnedDate, setPinnedDate] = useState<string | null>(null)
  const date = pinnedDate ?? liveToday

  const workout = useWorkoutLog(date, EXTRA_SESSION_ID)

  // ROUND 22. The chooser offers the account's CURRENT weekday templates.
  const programmeState = useProgramme()
  const extraTemplates = useMemo(
    () => (programmeState.programme ? toTrainingSessions(programmeState.programme) : []),
    [programmeState.programme],
  )

  // Which template the picker is offering. Only ever used BEFORE Start — once
  // a workout exists the stored snapshot is the truth and this is ignored.
  const [selectedId, setSelectedId] = useState<string>('')
  const selected = useMemo(
    () =>
      extraTemplates.find((session) => session.id === selectedId) ??
      extraTemplates[0] ??
      null,
    [extraTemplates, selectedId],
  )

  const { status, occurrence, sets } = workout

  // The account's CURRENT input types, so a started Extra can say when its
  // frozen modality no longer matches the setting.
  const inputTypes = useExerciseInputTypeLibrary()
  const mismatchAt = useCallback(
    (exerciseOrder: number) =>
      modalityMismatchAt(workout.sets, exerciseOrder, inputTypes.byExercise),
    [workout.sets, inputTypes.byExercise],
  )

  // Read from PERSISTED provenance, not from the route that got us here. If a
  // workout is somehow filed under this slug without being an Extra, this page
  // declines to wrap its own framing around it rather than mislabelling it.
  const started = workout.started && isExtraOccurrence(occurrence)

  // Pin as soon as the server confirms an Extra exists under the date we are
  // reading. Pinning on the CONFIRMED read rather than on the Start call means
  // a resumed workout is held too, not just one begun in this mount.
  //
  // Adjusted DURING render rather than in an effect. React supports exactly
  // this for "derive state from what we just learned" — it re-runs this
  // component immediately, before anything is committed to the DOM, so there
  // is no flash of the wrong date and no cascading-render effect.
  if (started && pinnedDate === null) setPinnedDate(date)

  // Read back from the snapshot, never rebuilt from today's template, so a
  // later change to the Foundation session cannot rewrite what was performed.
  const performed = useMemo(() => extraSessionFromSnapshot(sets), [sets])
  // Built from the frozen snapshot, never from today's Foundation template, so
  // a later rename cannot rewrite what this workout says it was.
  const sourceLabel = extraSnapshotLabel(occurrence)

  return (
    <>
      <BackToTraining />

      <PageHeader
        eyebrow="Extra Workout"
        title={started && occurrence?.focus ? occurrence.focus : 'Extra workout'}
        subline={
          started
            ? 'Voluntary extra training. Your scheduled week is unchanged.'
            : 'Repeat one Foundation session today, on top of your schedule.'
        }
      />

      {status === 'loading' && (
        <Card className="mb-4 p-4">
          <p
            role="status"
            className="flex items-center gap-2 text-[13px] font-semibold text-ink-dim"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Checking today's extra workout…
          </p>
        </Card>
      )}

      {status === 'error' && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-[13px] font-semibold text-coral">
              Could not load your extra workout. Nothing has been lost.
            </p>
            <button
              type="button"
              onClick={workout.reload}
              className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        </Card>
      )}

      {status === 'ready' && !started && (
        <TemplateChooser
          templates={extraTemplates}
          selected={selected}
          selectedId={selected?.id ?? selectedId}
          onSelect={setSelectedId}
          starting={workout.starting}
          onStart={(session) =>
            void workout.start(
              toExtraStartPayload(session.id, programmeState.programme?.revision ?? 0),
            )
          }
        />
      )}

      {status === 'ready' && started && occurrence && (
        <StartedExtra
          day={occurrence.day}
          sourceLabel={sourceLabel}
          progress={workout.progress}
        />
      )}

      {workout.mutationError && (
        <p role="alert" className="mb-4 text-[13px] font-semibold text-coral">
          {workout.mutationError}
        </p>
      )}

      {status === 'ready' && started && (
        <ExerciseAccordion
          session={performed}
          logging={{
            sets: workout.sets,
            busySet: workout.busySet,
            onComplete: workout.complete,
            onSkip: workout.skip,
            onUndo: workout.undo,
          }}
          /*
           * ROUND 22 CORRECTION 1 (C3). An Extra freezes a modality at Start
           * exactly as a scheduled workout does, so it needs the same warning
           * when the setting moves underneath it. There is still no `guidance`
           * prop, ever — see the note at the top of this file — so there is no
           * calibration action here to suppress.
           */
          mismatchAt={mismatchAt}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Before Start — choose and preview                                   */
/* ------------------------------------------------------------------ */

/**
 * Pick a template, look at it, then start.
 *
 * Nothing here writes. Selecting and previewing create no workout occurrence
 * and no history row — the only request this component can make is the
 * explicit Start below, so a user may change their mind as often as they like
 * and leave no trace.
 */
function TemplateChooser({
  templates,
  selected,
  selectedId,
  onSelect,
  starting,
  onStart,
}: {
  /** The account's CURRENT weekday templates, from its own programme. */
  templates: TrainingSessionView[]
  selected: TrainingSessionView | null
  selectedId: string
  onSelect: (id: string) => void
  starting: boolean
  onStart: (session: TrainingSessionView, plan: NonNullable<ReturnType<typeof buildExtraPlan>>) => void
}) {
  // Derived for the preview only. Null when a prescription cannot be parsed,
  // in which case Start is refused rather than logging a workout the app
  // cannot describe honestly.
  const plan = useMemo(() => (selected ? buildExtraPlan(selected) : null), [selected])
  const totalSets = plan?.reduce((sum, exercise) => sum + exercise.setCount, 0) ?? 0

  return (
    <>
      <Card className="mb-4 p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
          Based on
        </p>
        <ul className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Foundation session">
          {templates.map((session) => {
            const active = session.id === selectedId
            return (
              <li key={session.id}>
                <motion.button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelect(session.id)}
                  whileTap={press.whileTap}
                  transition={press.transition}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors duration-150',
                    active
                      ? 'border-blue/45 bg-surface-raised'
                      : 'border-edge hover:border-edge-strong',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-150',
                      active ? 'border-blue bg-blue text-offwhite' : 'border-edge-strong',
                    )}
                  >
                    {active && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                        {session.day}
                      </span>
                      <IntensityBadge intensity={session.intensity} />
                    </span>
                    <span className="mt-0.5 block truncate font-bold text-offwhite">
                      {session.focus}
                    </span>
                  </span>
                </motion.button>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card className="mb-4 p-4">
        {selected === null ? (
          <p className="text-[13px] text-ink-faint">Choose a session to preview it.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-offwhite">
                {plan ? 'Preview' : 'Cannot be logged'}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-faint">
                {plan
                  ? `${selected.exercises.length} exercises · ${totalSets} sets to log · nothing is recorded until you start`
                  : 'This session cannot be logged yet.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (plan) onStart(selected, plan)
              }}
              disabled={!plan || starting}
              className="inline-flex items-center gap-1.5 rounded-control bg-blue px-4 py-2.5 text-[13px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              Start extra workout
            </button>
          </div>
        )}
      </Card>

      {selected && plan && (
        <Card className="mb-4">
          <p className="px-4 pb-3 pt-4 text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
            What you would do
          </p>
          <ol className="divide-y divide-edge border-t border-edge">
            {plan.map((exercise, index) => (
              <li
                key={`${exercise.exerciseId}-${index}`}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-overlay text-[12px] font-extrabold text-ink-dim"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-offwhite">
                    {exercise.name}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink-faint">
                    {exercise.prescription}
                    {exercise.equipment ? ` · ${exercise.equipment}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* After Start — frozen                                                */
/* ------------------------------------------------------------------ */

/**
 * The resume header for a started Extra.
 *
 * It states the frozen source template identity and offers NO way to change
 * it. Once an Extra is underway its snapshot is history, so a picker here
 * would be offering something the server would correctly refuse.
 */
function StartedExtra({
  day,
  sourceLabel,
  progress,
}: {
  day: string
  sourceLabel: string | null
  progress: { total: number; completed: number; skipped: number; resolved: number } | null
}) {
  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-full bg-blue/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-blue">
          Extra
        </span>
        <p className="text-[15px] font-bold text-offwhite">Resume extra workout</p>
      </div>

      <p className="mt-1 text-[13px] text-ink-faint">
        Based on {sourceLabel ?? day}
      </p>

      {progress && (
        <>
          <p className="mt-2 text-[13px] text-ink-faint">
            {progress.resolved} / {progress.total} sets resolved
          </p>
          <p className="mt-1 text-[12px] font-semibold text-ink-faint">
            {progress.completed} completed · {progress.skipped} skipped
          </p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.resolved}
            aria-label="Sets resolved"
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay"
          >
            <div
              className="h-full rounded-full bg-blue"
              style={{
                width: `${progress.total === 0 ? 0 : Math.round((progress.resolved / progress.total) * 100)}%`,
              }}
            />
          </div>
        </>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
        This does not replace your scheduled session, and it does not count
        toward streaks.
      </p>
    </Card>
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
