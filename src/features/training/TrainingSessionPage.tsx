import { ArrowLeft, Loader2, Play, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import { Card } from '@/components/ui/Card'
import { IntensityBadge } from '@/components/ui/IntensityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { ExerciseAccordion } from './ExerciseAccordion'
import { getSession, type TrainingSession } from './sessions'
import { useWorkoutLog } from './useWorkoutLog'
import { buildWorkoutPlan, localWorkoutDate, toStartPayload } from './workoutPlan'

/** Nested shell: /training/:session */
export function TrainingSessionPage() {
  const { session: sessionId } = useParams()
  const session = getSession(sessionId)

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
  return <SessionView key={session.id} session={session} />
}

function SessionView({ session }: { session: TrainingSession }) {
  // The user's own calendar date, fixed for this mount so the workout cannot
  // change identity mid-session. No timezone is hardcoded.
  const [date] = useState(() => localWorkoutDate())
  const workout = useWorkoutLog(date, session.id)

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
          if (plan) void workout.start(toStartPayload(session, plan))
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
  session: TrainingSession
  plan: ReturnType<typeof buildWorkoutPlan>
  workout: ReturnType<typeof useWorkoutLog>
  onStart: () => void
}) {
  const { status, started, starting, progress, mutationError, reload } = workout

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
