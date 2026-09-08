import { CalendarDays, Dumbbell, Play, RefreshCw } from 'lucide-react'
import { Badge, IntensityBadge } from '@/components/ui/Badge'
import { ButtonLink, Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/Feedback'
import { HeroCard } from '@/components/ui/Layout'
import { Skeleton } from '@/components/ui/Feedback'
import type { TrainingFlexKind } from '@shared/trainingFlex'
import type { SessionIntensity } from '@/features/training/sessions'

import type { ScheduledStartedState } from '../useScheduledStarted'
import type { TrainingFlexState } from '../useTrainingFlex'
import { TrainingFlexCard } from './TrainingFlexCard'

/**
 * TODAY'S TRAINING, PINNED.
 *
 * Round 24 (Q2, approved). On a day that plans a session this is the FIRST
 * card on Today, above the routine — because for a training app "what matters
 * most right now" is the training, and before 20:30 the gym item otherwise sat
 * under "Later today" behind up to eight rows.
 *
 * THIS IS NOT A DUPLICATE OF THE GYM ROW BELOW. They are two different facts.
 * This card starts and continues the WORKOUT — session truth, sets,
 * server-authoritative. The agenda row is the 20:30 slot in the day, and its
 * tick marks that ROUTINE slot done without logging a single set. The audit's
 * finding was that those two writes were presented as primary and secondary of
 * one card, so the more prominent button was the one that recorded nothing.
 *
 * ONE PRIMARY ACTION. Start / Continue is the only filled control on this card.
 * The flex decision — which used to be the FIRST card on the page, above the
 * item actually happening — sits underneath it, still directly operable.
 *
 * NOTHING HERE WRITES A WORKOUT. It links to the session, which owns Start.
 */

export type TodayTrainingHeroProps = {
  /** Session slug the day plans, e.g. `monday`. */
  sessionId: string
  focus: string
  intensity: SessionIntensity | null
  /** Null when the programme could not be read; counts are then not claimed. */
  plan: { exercises: number; sets: number } | null
  /** Server truth about whether this session is already under way. */
  scheduled: ScheduledStartedState
  flex: TrainingFlexState
}

export function TodayTrainingHero({
  sessionId,
  focus,
  intensity,
  plan,
  scheduled,
  flex,
}: TodayTrainingHeroProps) {
  const choice: TrainingFlexKind | null =
    flex.status === 'ready' ? flex.choice : null

  /*
   * A day resolved as Recovery or Fitness Boxing is a different day, and the
   * scheduled session is withdrawn while that choice stands.
   *
   * The flex card already states the choice and its consequence, so this
   * branch renders it and nothing else. Wrapping it in a heading that repeats
   * the choice's own label would say the same thing twice.
   */
  if (choice !== null) {
    return <TrainingFlexCard flex={flex} scheduledStarted={scheduled.started} />
  }

  const started = scheduled.status === 'ready' && scheduled.started
  const progress = scheduled.status === 'ready' ? scheduled.progress : null
  const percent =
    progress && progress.total > 0
      ? Math.round((progress.resolved / progress.total) * 100)
      : 0

  return (
    <HeroCard accent aria-labelledby="today-training">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="scheduled" icon={CalendarDays}>
            Scheduled
          </Badge>
          {intensity && <IntensityBadge intensity={intensity} />}
          {started && <Badge tone="current">In progress</Badge>}
        </div>
      </div>

      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
        Today&rsquo;s training
      </p>
      <h2
        id="today-training"
        className="text-[24px] font-bold leading-[1.16] tracking-[-0.015em] text-ink"
      >
        {focus}
      </h2>

      {/*
        Counts are claimed only when the programme was actually read. A
        session whose prescriptions could not be parsed says so rather than
        printing a number derived from nothing.
      */}
      {plan ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Badge tone="outline">{`${plan.exercises} exercises`}</Badge>
          <Badge tone="outline">{`${plan.sets} sets to log`}</Badge>
        </div>
      ) : (
        <p className="mt-1.5 text-[13.5px] text-ink-2">This session cannot be logged yet.</p>
      )}

      {started && progress && (
        <div className="mt-4">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.resolved}
            aria-label="Sets resolved"
            className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
          >
            <div className="h-full rounded-full bg-accent-edge" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-[13px] font-semibold text-ink-2">
            {progress.resolved} / {progress.total} sets resolved ·{' '}
            {progress.completed} completed · {progress.skipped} skipped
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2.5">
        {scheduled.status === 'loading' ? (
          /*
           * Not "Start workout" while the answer is unknown: a workout already
           * under way would briefly look unstarted, and the button would then
           * change meaning under the user's finger.
           */
          <Skeleton className="h-gym w-full rounded-control" />
        ) : (
          <ButtonLink
            to={`/training/${sessionId}`}
            variant="primary"
            size="lg"
            block
            aria-label={`${started ? 'Continue' : 'Start'} ${focus}`}
          >
            <Play className="size-[18px]" aria-hidden="true" />
            {started ? 'Continue workout' : 'Start workout'}
          </ButtonLink>
        )}

        {scheduled.status === 'error' && (
          <Banner
            tone="danger"
            live="alert"
            title="Could not check this workout"
            actions={
              <Button size="sm" onClick={scheduled.reload}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Try again
              </Button>
            }
          >
            Nothing has been lost. Opening the session will read it again.
          </Banner>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink to={`/training/${sessionId}`} variant="ghost" size="sm">
            <Dumbbell className="size-4" aria-hidden="true" />
            View session
          </ButtonLink>
        </div>

        {/*
          The alternative stays directly operable — not behind a disclosure.
          The audit's finding was that this card sat ABOVE the item actually
          happening, not that it existed; putting it below the one primary
          action fixes the hierarchy without hiding a control.
        */}
        <TrainingFlexCard flex={flex} scheduledStarted={scheduled.started} />
      </div>
    </HeroCard>
  )
}
