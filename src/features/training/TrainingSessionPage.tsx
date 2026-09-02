import { ArrowLeft, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import { Card } from '@/components/ui/Card'
import { IntensityBadge } from '@/components/ui/IntensityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { useLocalToday } from '@/features/progress/useLocalToday'
import { ExerciseAccordion } from './ExerciseAccordion'
import { useProgramme } from '@/features/programme/programmeContext'
import { toTrainingSession, type TrainingSessionView } from '@/features/programme/programmeApi'
import { useProgression } from './useProgression'
import { useWorkoutLog } from './useWorkoutLog'
import { buildWorkoutPlan } from './workoutPlan'

/** Nested shell: /training/:session */
export function TrainingSessionPage() {
  const { session: sessionId } = useParams()
  // ROUND 22. The session comes from the account's programme.
  const { status, programme, reload } = useProgramme()
  const session = programme ? toTrainingSession(programme, sessionId ?? '') : undefined

  if (status === 'loading') {
    return (
      <>
        <BackToTraining />
        <PageHeader title="Loading" subline="Reading your training week." />
      </>
    )
  }

  if (status === 'error') {
    return (
      <>
        <BackToTraining />
        <PageHeader
          title="Could not load this session"
          subline="Your programme could not be read, so this day is not being guessed at."
        />
        <button
          type="button"
          onClick={reload}
          className="mt-3 rounded-control text-[13px] font-bold text-blue underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </>
    )
  }

  if (!session) {
    return (
      <>
        <BackToTraining />
        <PageHeader
          title="Session not found"
          subline="This training day does not exist in the Foundation base."
        />
      </>
    )
  }

  // Session-keyed so workout state resets cleanly when the day changes.
  return (
    <SessionView
      key={session.id}
      session={session}
      revision={programme?.revision ?? 0}
    />
  )
}

function SessionView({
  session,
  revision,
}: {
  session: TrainingSessionView
  /** The programme revision this page is showing, sent with Start. */
  revision: number
}) {
  // Round 18: the same rollover fix Round 17 gave the Extra page, for the same
  // reason. Read once at mount, a session opened at 23:58 and started at 00:05
  // filed the workout under YESTERDAY — a day the user did not train on.
  //
  // So the date follows the clock while nothing has been started, and is PINNED
  // the moment a workout exists: sets already logged happened on that date, and
  // a started occurrence is never moved or rewritten.
  const liveToday = useLocalToday()
  const [pinnedDate, setPinnedDate] = useState<string | null>(null)
  const date = pinnedDate ?? liveToday

  const workout = useWorkoutLog(date, session.id)

  // Adjusted during render rather than in an effect — React supports this for
  // deriving state from what was just learned, and an effect here would trip
  // the cascading-render rule and flash the wrong date first. Pinning on the
  // CONFIRMED read means a resumed workout is held too, not only a new one.
  if (workout.started && pinnedDate === null) setPinnedDate(date)

  // Guidance is DERIVED from stored history, so it is read only once a workout
  // exists, and re-read whenever that workout changes — a Complete, a Skip or
  // an Undo all move the truth it was derived from.
  const guidance = useProgression(date, session.id, {
    enabled: workout.started,
    revision: workout.revision,
  })

  // The set structure the accepted prescriptions imply. Null when any
  // prescription cannot be parsed — in which case the page refuses to offer a
  // Start rather than logging a workout it cannot describe honestly.
  const plan = useMemo(() => buildWorkoutPlan(session), [session])

  return (
    <>
      <BackToTraining />
      <PageHeader
        eyebrow={session.day}
        title={session.focus}
        subline="Tap an exercise for its prescription."
        actions={<IntensityBadge intensity={session.intensity} />}
      />

      <WorkoutBar
        session={session}
        plan={plan}
        workout={workout}
        onStart={() => {
          // ROUND 22. The body states only which programme the user was
          // looking at. The server builds the snapshot from that programme.
          if (plan) void workout.start({ expectedRevision: revision })
        }}
      />

      <ExerciseAccordion
        session={session}
        logging={
          workout.started
            ? {
                sets: workout.sets,
                busySet: workout.busySet,
                onComplete: workout.complete,
                onSkip: workout.skip,
                onUndo: workout.undo,
              }
            : undefined
        }
        guidance={
          workout.started && guidance.status === 'ready'
            ? {
                laneFor: guidance.laneFor,
                // Displayed guidance is not the same as guidance that still
                // describes this workout. Only the latter may be acted on.
                confirmed: guidance.confirmed,
                busyLane: guidance.busyLane,
                error: guidance.mutationError,
                onFeedback: guidance.saveFeedback,
              }
            : undefined
        }
      />
    </>
  )
}

/**
 * Start / Resume and the workout's progress.
 *
 * The load state is honest: until the server has answered, this says it is
 * checking rather than offering "Start workout" — otherwise a workout already
 * underway would briefly look unstarted.
 */
function WorkoutBar({
  session,
  plan,
  workout,
  onStart,
}: {
  session: TrainingSessionView
  plan: ReturnType<typeof buildWorkoutPlan>
  workout: ReturnType<typeof useWorkoutLog>
  onStart: () => void
}) {
  const { status, started, starting, progress, mutationError, reload } = workout
  const { cancelable, cancelling, cancelStart } = workout
  // The confirmation is local to this card: cancelling a Start is destructive,
  // so it is never one tap away.
  const [confirming, setConfirming] = useState(false)

  return (
    <Card className="mb-4 p-4">
      {status === 'loading' && (
        <p
          role="status"
          className="flex items-center gap-2 text-[13px] font-semibold text-ink-dim"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Checking your workout…
        </p>
      )}

      {status === 'error' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-[13px] font-semibold text-coral">
            Could not load this workout. Nothing has been lost.
          </p>
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {status === 'ready' && !started && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-offwhite">Workout not started</p>
            <p className="mt-0.5 text-[13px] text-ink-faint">
              {plan
                ? `${session.exercises.length} exercises · ${totalSets(plan)} sets to log`
                : 'This session cannot be logged yet.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onStart}
            disabled={!plan || starting}
            className="inline-flex items-center gap-1.5 rounded-control bg-blue px-4 py-2.5 text-[13px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            Start workout
          </button>
        </div>
      )}

      {status === 'ready' && started && progress && (
        <div>
          <p className="text-[15px] font-bold text-offwhite">Resume workout</p>
          <p className="mt-0.5 text-[13px] text-ink-faint">
            Workout in progress · {progress.resolved} / {progress.total} sets resolved
          </p>
          <p className="mt-1 text-[12px] font-semibold text-ink-faint">
            {progress.completed} completed · {progress.skipped} skipped
          </p>
          <ProgressBar resolved={progress.resolved} total={progress.total} />

          {/*
            TAKING BACK AN ACCIDENTAL START.

            Offered only while the SERVER says the workout was never worked in.
            A workout that was completed and then undone reads 0 / 0 here too,
            and deliberately does not get this button — the training happened,
            even though the sets were put back.
          */}
          {cancelable && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3 py-1.5 text-[12px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Cancel workout start
            </button>
          )}

          {cancelable && confirming && (
            <div className="mt-3 rounded-control border border-edge-strong bg-surface-overlay/60 p-3">
              <p className="text-[13px] font-bold text-offwhite">Cancel this workout?</p>
              <p className="mt-0.5 text-[12px] text-ink-faint">
                No sets have been recorded. This will return the workout to Not
                started.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false)
                    void cancelStart()
                  }}
                  disabled={cancelling}
                  className="inline-flex items-center gap-1.5 rounded-control bg-coral px-3 py-1.5 text-[12px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {cancelling ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  )}
                  Cancel workout
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={cancelling}
                  className="rounded-control px-3 py-1.5 text-[12px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Keep workout
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mutationError && (
        <p role="alert" className="mt-3 text-[13px] font-semibold text-coral">
          {mutationError}
        </p>
      )}
    </Card>
  )
}

function ProgressBar({ resolved, total }: { resolved: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((resolved / total) * 100)
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={resolved}
      aria-label="Sets resolved"
      className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay"
    >
      <div className="h-full rounded-full bg-blue" style={{ width: `${percent}%` }} />
    </div>
  )
}

function totalSets(plan: NonNullable<ReturnType<typeof buildWorkoutPlan>>): number {
  return plan.reduce((sum, exercise) => sum + exercise.setCount, 0)
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
