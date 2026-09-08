import { ArrowLeft, CheckCircle2, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import { Badge, IntensityBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Banner, Skeleton } from '@/components/ui/Feedback'
import { HeroCard, PageHeader } from '@/components/ui/Layout'
import { useLocalToday } from '@/features/progress/useLocalToday'
import { ExerciseAccordion } from './ExerciseAccordion'
import { useExerciseInputTypeLibrary } from '@/features/settings/useExerciseInputTypeLibrary'
import { modalityVerdictAt } from './inputTypeMismatch'
import { workoutSessionFromSnapshot } from './extra'

/** Does this stored intensity have a chip in this build? */
function isSessionIntensity(value: string): value is 'HARD' | 'LIGHT' | 'PUMP' {
  return value === 'HARD' || value === 'LIGHT' || value === 'PUMP'
}
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
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 rounded-hero" />
          <Skeleton className="h-16 rounded-card" />
          <Skeleton className="h-16 rounded-card" />
        </div>
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
        <Banner
          tone="danger"
          live="alert"
          title="Your programme could not be read"
          actions={
            <Button size="sm" onClick={reload}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          }
        >
          This day is not being guessed at, and nothing has been lost.
        </Banner>
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

  /*
   * WHAT THE LIST RENDERS, BEFORE AND AFTER START.
   *
   * Before Start: the account's CURRENT programme, which is the whole point of
   * Round 22 — the user edits it and sees the edit.
   *
   * After Start: the STORED SNAPSHOT, and nothing else. The accordion renders
   * each row from `exercises[index]` while the logging controls for that row
   * are matched by `exerciseOrder === index`, so rendering the current
   * programme against frozen set positions would pair a renamed or reordered
   * exercise with somebody else's sets — and the user would log against the
   * wrong exercise without any sign of it.
   *
   * The same rebuild an Extra has always used, under this session's own id.
   */
  const rendered = useMemo(
    () =>
      workout.started && workout.sets.length > 0
        ? workoutSessionFromSnapshot(session.id, workout.sets)
        : session,
    [workout.started, workout.sets, session],
  )

  /*
   * The header follows the FROZEN occurrence once one exists. Day, focus and
   * intensity are historical facts of the workout that was begun; replacing
   * them with today's programme metadata would relabel it.
   */
  /*
   * ROUND 22 CORRECTION 1 (C3). The account's CURRENT input types, so a
   * started workout can say when its frozen modality no longer matches.
   *
   * CORRECTION 2. The STATUS travels with the map, because the map alone
   * cannot be told apart from an account that has configured nothing: it is
   * empty while loading and empty after a failed read. The verdict fails
   * closed on both, rather than reporting a modality it has not checked.
   */
  const { status: inputTypeStatus, byExercise } = useExerciseInputTypeLibrary()
  const modalityAt = useCallback(
    (exerciseOrder: number) =>
      modalityVerdictAt(workout.sets, exerciseOrder, {
        status: inputTypeStatus,
        byExercise,
      }),
    [workout.sets, inputTypeStatus, byExercise],
  )

  const header = workout.occurrence
    ? {
        day: workout.occurrence.day,
        focus: workout.occurrence.focus,
        // A stored snapshot may carry an intensity this build has no chip for
        // — a workout begun under an older vocabulary. Rather than force it
        // into a style it does not have, the badge is simply not drawn.
        intensity: isSessionIntensity(workout.occurrence.intensity)
          ? workout.occurrence.intensity
          : null,
      }
    : { day: session.day, focus: session.focus, intensity: session.intensity }

  return (
    <>
      <BackToTraining />
      <PageHeader
        eyebrow={header.day}
        title={header.focus}
        subline="Tap an exercise for its prescription."
        actions={
          header.intensity ? <IntensityBadge intensity={header.intensity} /> : undefined
        }
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
        session={rendered}
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
        modalityAt={modalityAt}
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

  /*
   * A WORKOUT CLOSES.
   *
   * Before Round 24 a fully resolved session still said "Resume workout" at
   * 17 / 17, which reads as "you are not done" at exactly the moment the app
   * should say the opposite.
   *
   * DERIVED from the server's own counts. Nothing new is stored, and a started
   * workout with nothing resolved is not finished.
   */
  const finished =
    started && progress !== null && progress.total > 0 && progress.resolved === progress.total

  return (
    <HeroCard accent={status === 'ready'} className="mb-4">
      {status === 'loading' && (
        <p
          role="status"
          className="flex items-center gap-2 text-[13px] font-semibold text-ink-2"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Checking your workout…
        </p>
      )}

      {status === 'error' && (
        <Banner
          tone="danger"
          live="alert"
          title="Could not load this workout. Nothing has been lost."
          actions={
            <Button size="sm" onClick={reload}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          }
        />
      )}

      {status === 'ready' && !started && (
        <div>
          <p className="text-[15px] font-bold text-ink">Workout not started</p>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {plan
              ? `${session.exercises.length} exercises · ${totalSets(plan)} sets to log`
              : 'This session cannot be logged yet.'}
          </p>
          <Button
            variant="primary"
            size="lg"
            block
            onClick={onStart}
            disabled={!plan || starting}
            className="mt-4"
          >
            {starting ? (
              <Loader2 className="size-[18px] animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-[18px]" aria-hidden="true" />
            )}
            Start workout
          </Button>
          <p className="mt-2.5 text-xs text-ink-3">
            Starting freezes today’s programme into this workout. Later programme edits will
            not change it.
          </p>
        </div>
      )}

      {status === 'ready' && started && progress && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {finished ? (
              <Badge tone="done" icon={CheckCircle2}>
                Workout complete
              </Badge>
            ) : (
              <Badge tone="current">In progress</Badge>
            )}
          </div>
          <p className="text-[15px] font-bold text-ink">
            {finished ? 'Every set is resolved' : 'Resume workout'}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-2">
            Workout in progress · {progress.resolved} / {progress.total} sets resolved
          </p>
          {/*
            Completed and skipped are reported SEPARATELY and never added
            together: a skip is not a smaller success, and nothing downstream
            may read one as training that happened.
          */}
          <p className="mt-1 text-[13px] font-semibold text-ink-2">
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
              className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-line-strong px-3 py-1.5 text-[12px] font-bold text-ink-2 transition-colors duration-fast hover:text-ink"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Cancel workout start
            </button>
          )}

          {cancelable && confirming && (
            <div className="mt-4 rounded-control border border-danger-ink/25 bg-danger-soft p-4">
              <p className="text-[13px] font-bold text-ink">Cancel this workout?</p>
              <p className="mt-0.5 text-[12px] text-ink-3">
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
                  className="inline-flex items-center gap-1.5 rounded-control bg-danger-ink px-3 py-1.5 text-[12px] font-bold text-ink transition-opacity duration-fast disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="rounded-control px-3 py-1.5 text-[12px] font-bold text-ink-2 transition-colors duration-fast hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Keep workout
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mutationError && (
        <p role="alert" className="mt-3 text-[13px] font-semibold text-danger-ink">
          {mutationError}
        </p>
      )}
    </HeroCard>
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
      className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
    >
      <div className="h-full rounded-full bg-accent-edge" style={{ width: `${percent}%` }} />
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
      className="mb-4 inline-flex items-center gap-1.5 rounded-control text-[13px] font-semibold text-ink-3 transition-colors duration-fast hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Training week
    </Link>
  )
}
