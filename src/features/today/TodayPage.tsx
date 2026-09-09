import {
  CalendarRange,
  Dumbbell,
  Flame,
  Palmtree,
  RefreshCw,
  Scale,
  Target,
} from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/Badge'
import { ButtonLink, Button } from '@/components/ui/Button'
import { Banner, Skeleton } from '@/components/ui/Feedback'
import {
  Card,
  HeroCard,
  ListRow,
  MetricCard,
  PageHeader,
  RowList,
} from '@/components/ui/Layout'
import type { HolidayStatus } from '@/features/calendar/useHolidays'
import { foundationStatus } from '@/features/progress/foundation'
import { useWorkoutHistory } from '@/features/progress/useWorkoutHistory'
import { useFoundationStart } from '@/features/settings/FoundationStartContext'
import { useProgramme } from '@/features/programme/programmeContext'
import { toTrainingSession } from '@/features/programme/programmeApi'
import { buildWorkoutPlan } from '@/features/training/workoutPlan'
import { addLocalDays, localDateOf } from '@shared/localDate'
import type { Route } from './model/types'
import { GYM_ITEM_ID } from '@shared/notifications/due'
import { PrepWeekNote } from './components/PrepWeekNote'
import { TodayHero } from './components/TodayHero'
import { TodaySection } from './components/TodaySection'
import { TodayStatusNotice } from './components/TodayStatusNotice'
import { TodayTrainingHero } from './components/TodayTrainingHero'
import { WeekStrip, type WeekDayMark } from './components/WeekStrip'
import { prepWeekDaysRemaining } from './prepWeek'
import { useScheduledStarted } from './useScheduledStarted'
import { useTrainingFlex } from './useTrainingFlex'
import { useTrainingFlexRange } from './useTrainingFlexRange'
import { useToday } from './useToday'

/**
 * The day's mode, for the header.
 *
 * Until the Holiday state is known the agenda is built from an empty Holiday
 * set, so `agenda.route.label` would read "Home Mode" on a day that may turn
 * out to be exempt. The body is already neutral while the mode is unknown; the
 * header has to be too, or it states a resolved mode we do not have.
 */
function dayModeLabel(status: HolidayStatus, route: Route): string {
  if (status === 'loading') return 'Checking day mode'
  if (status === 'error') return 'Day mode unavailable'
  // A Holiday names itself, but never renames the day: the weekday and date
  // in front of this stay exactly what the calendar says.
  if (route.id === 'holiday' && route.name) return `${route.name} · ${route.label}`
  return route.label
}

/**
 * The Foundation eyebrow.
 *
 * Uses the one accepted Foundation calculation rather than a second copy:
 * this page previously divided a millisecond difference, which a daylight-
 * saving transition makes 23 or 25 hours and therefore off by a day. Holiday
 * changes nothing here — the day number follows the real calendar either way.
 *
 * Round 18: the start date is the account's, and until it is known this says so
 * rather than naming a day derived from a guess. `now` is the live clock, so
 * the day number advances across local midnight without a reload.
 */
function foundationEyebrow(now: Date, startDate: string, ready: boolean): string {
  if (!ready) return 'Foundation'
  const status = foundationStatus(localDateOf(now), startDate)
  if (!status) return 'Foundation'
  /*
   * ROUND 27 (VT-02), as corrected.
   *
   * INSIDE Prep Week the eyebrow gives up its arithmetic: the note below is
   * printing the count in a card the reader actually looks at, and saying the
   * same number twice on one screen reads as noise rather than emphasis. The
   * eyebrow keeps its job — which phase Foundation is in — and stays parallel
   * with "Foundation · Day 7".
   *
   * OUTSIDE it, there is no note, so the eyebrow is the only thing that can
   * say anything, and it says the true thing: how many days out Day 1 is. It
   * must not say "Prep week" there. The start date is editable, so `upcoming`
   * is equally true a month out, and naming that a prep week would be wrong.
   *
   * The window is not re-decided here. `prepWeekDaysRemaining` owns it, and
   * this asks.
   */
  if (status.phase === 'upcoming') {
    if (prepWeekDaysRemaining(status) !== null) return 'Foundation · Prep week'
    const days = status.daysUntilStart
    /*
     * Unreachable while the phase is `upcoming` — `upcoming` means `day < 1`,
     * so this is at least 1. But "Foundation starts in 0 days" is precisely
     * the untruth this correction exists to remove, so it is never printed:
     * with no trustworthy count the eyebrow says only what it knows.
     */
    if (days === null || days < 1) return 'Foundation'
    return `Foundation starts in ${days} day${days === 1 ? '' : 's'}`
  }
  return `Foundation · Day ${status.day}`
}

/** Small live readout — also the visible proof the page follows the clock. */
function ClockChip({ now }: { now: Date }) {
  return (
    <Badge tone="neutral" className="shrink-0 px-3 py-2">
      <span
        className="size-1.5 animate-pulse rounded-full bg-accent-edge"
        aria-hidden="true"
      />
      <span className="text-[13px] font-bold tabular-nums">
        {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </Badge>
  )
}

/**
 * Today.
 *
 * ROUND 24. On a day that plans training, the training hero leads — above the
 * routine — because for a training app that is what "what matters most right
 * now" means, and the gym item otherwise sat in "Later today" behind up to
 * eight rows until 20:30.
 *
 * The gym item is PROMOTED, NOT DUPLICATED: it is withdrawn from the agenda
 * below while the hero is shown, exactly as the existing Recovery path already
 * withdraws it. Nothing is completed, nothing is written, and the hero carries
 * the item's own window so no fact is lost.
 *
 * Below the hero the day is still ordered by priority, not by the clock: what
 * is happening leads, unfinished overdue work sits right behind it, then the
 * rest of the day, then what is already done.
 *
 * - mobile: one column
 * - desktop: schedule on the left, needs-attention + done in a lighter rail
 */
export function TodayPage() {
  const {
    now,
    agenda,
    groups,
    toggle,
    hydration,
    pending,
    failure,
    retryHydration,
    dismissFailure,
    holidayStatus,
    retryHolidays,
  } = useToday()

  // The one shared Foundation start contract. Read here rather than derived
  // locally, so this page cannot disagree with Progress or Achievements.
  const foundationStart = useFoundationStart()

  // Today's explicit training choice. Read here so the card and the schedule
  // below cannot disagree about what today was resolved as.
  const flex = useTrainingFlex()

  /**
   * Does today actually plan a strength session?
   *
   * Read from the agenda the engine already built rather than re-derived from
   * the weekday, so Holiday Training Off/On stays the authority: a day with no
   * gym item has nothing to flex away from, and offering the choice there would
   * imply a session that does not exist.
   */
  const gymEntry = agenda.entries.find((entry) => entry.item.id === GYM_ITEM_ID) ?? null
  const plansGym = gymEntry !== null

  /**
   * The session today plans, read back out of the gym item's own link rather
   * than re-derived from the weekday, so there is no second copy of the
   * mapping. Null when the day plans none.
   */
  const gymSessionId = useMemo(() => {
    const match = /^\/training\/([a-z]+)$/.exec(gymEntry?.item.to ?? '')
    return match ? match[1] : null
  }, [gymEntry])

  // Whether that session has already been started, and how far in it is.
  const scheduled = useScheduledStarted(flex.today, gymSessionId)

  // The account's own programme, for the hero's session identity and counts.
  const { programme } = useProgramme()
  const heroSession = useMemo(
    () => (programme && gymSessionId ? toTrainingSession(programme, gymSessionId) : undefined),
    [programme, gymSessionId],
  )
  const heroPlan = useMemo(() => {
    if (!heroSession) return null
    const plan = buildWorkoutPlan(heroSession)
    if (!plan) return null
    return {
      exercises: heroSession.exercises.length,
      sets: plan.reduce((sum, exercise) => sum + exercise.setCount, 0),
    }
  }, [heroSession])

  // Completing something before saved progress has loaded would be acting on
  // state we have not read yet, so the controls wait for hydration.
  const controlsDisabled = hydration !== 'ready'

  const failureMessage = failure
    ? `Couldn’t ${failure.action === 'complete' ? 'save' : 'undo'} “${
        agenda.entries.find((entry) => entry.key === failure.key)?.item.title ??
        'that item'
      }”. Please try again.`
    : null

  const dateLabel = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  /**
   * The day's items, with the gym session withdrawn while a flex choice stands.
   *
   * Round 19 Correction 1. A day resolved as Recovery must not simultaneously
   * present the strength session as an immediately actionable obligation — that
   * is the same day telling the user two different things, and it is the state
   * the server now refuses to let them act on anyway.
   *
   * Withdrawn from view only. Nothing is completed, nothing is written, the
   * programme is unchanged, and choosing "Do scheduled workout" in the hero
   * above brings it straight back.
   *
   * ROUND 24 DELIBERATELY DOES NOT WITHDRAW IT FOR THE HERO. The hero and this
   * row are two different facts: the hero starts and continues the WORKOUT —
   * session truth, sets, server-authoritative — while the row is the 20:30
   * slot in the day, and its tick marks that ROUTINE slot done without logging
   * a single set. The audit's finding was that those two writes were presented
   * as primary and secondary of one card, which made the more prominent button
   * the one that records nothing. Separating them is the fix. Removing one of
   * them would take away a write the user still has.
   */
  const heroOwnsGym = plansGym && gymSessionId !== null
  const shown = useMemo(() => {
    if (flex.status !== 'ready' || flex.choice === null) return groups
    const withoutGym = (entries: typeof groups.NOW) =>
      entries.filter((entry) => entry.item.id !== GYM_ITEM_ID)
    return {
      NOW: withoutGym(groups.NOW),
      NEXT: withoutGym(groups.NEXT),
      LATER: withoutGym(groups.LATER),
      LATE: withoutGym(groups.LATE),
      DONE_EARLIER: withoutGym(groups.DONE_EARLIER),
    }
  }, [groups, flex.status, flex.choice])

  // With nothing current, the closest upcoming item leads instead — and then
  // it must not appear a second time under "Up next".
  const hero = shown.NOW[0] ?? shown.NEXT[0] ?? null
  const alsoNow = shown.NOW.slice(1)
  const upNext = shown.NOW.length > 0 ? shown.NEXT : []

  const week = useWeekMarks(flex.today)

  /*
   * Two metrics, and only two, because these are the only ones this page can
   * state without making a request it does not already make. A body-weight
   * tile would need a read Today does not perform, and a number on the landing
   * screen that is sometimes a skeleton is worse than no tile.
   */
  const foundationDay = foundationStatus(localDateOf(now), foundationStart.startDate)
  const trainedThisWeek = useMemo(
    () =>
      [...week.marks.values()].filter(
        (mark) => mark === 'completed' || mark === 'extra',
      ).length,
    [week.marks],
  )

  return (
    <>
      <PageHeader
        eyebrow={foundationEyebrow(
          now,
          foundationStart.startDate,
          foundationStart.status === 'ready',
        )}
        title="Today"
        subline={`${dateLabel} · ${dayModeLabel(holidayStatus, agenda.route)}`}
        actions={<ClockChip now={now} />}
      />

      {/*
        ROUND 27 (VT-02). Rendered OUTSIDE the holiday branches on purpose.

        Whether today is a company Holiday is a fact this page may still be
        waiting for; how many days remain until Day 1 is not. The prep note is
        a pure function of the account's Foundation date, so gating it on an
        unrelated request would blank it for no reason — and would make it
        flicker in once the holidays resolved.

        `foundationStart.status` is still checked: until the account's date has
        actually loaded there is no date to count from, and a count derived
        from the default while the real one is in flight is a number that can
        change under the reader.
      */}
      {foundationStart.status === 'ready' && <PrepWeekNote status={foundationDay} />}

      {/*
        Whether today is a Holiday is a fact we may not have yet. Until the
        answer is known the normal routine is NOT rendered: showing it would
        put the day's pressure on a day that may be exempt, and would expose
        completion controls for a routine that may not apply. "Unknown" is
        neither Home nor Holiday, and is shown as itself.
      */}
      {holidayStatus === 'loading' && <TodayChecking />}
      {holidayStatus === 'error' && <TodayHolidayError onRetry={retryHolidays} />}

      {holidayStatus === 'ready' && agenda.holiday && <HolidayToday route={agenda.route} />}

      {holidayStatus === 'ready' && (
        <>
          <TodayStatusNotice
            hydration={hydration}
            failureMessage={failureMessage}
            onRetry={retryHydration}
            onDismiss={dismissFailure}
          />

          <div className="mb-5">
            <WeekStrip today={flex.today} marks={week.marks} pending={week.pending} />
          </div>

          <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:items-start xl:gap-6">
            {/* Schedule column */}
            <div className="contents xl:flex xl:flex-col xl:gap-5">
              <div className="order-1 flex flex-col gap-4 xl:order-none">
                {heroOwnsGym && gymSessionId && (
                  <TodayTrainingHero
                    sessionId={gymSessionId}
                    focus={heroSession?.focus ?? 'Today’s training'}
                    intensity={heroSession?.intensity ?? null}
                    plan={heroPlan}
                    scheduled={scheduled}
                    flex={flex}
                  />
                )}

                <TodayHero
                  entry={hero}
                  nowMinutes={agenda.nowMinutes}
                  onToggle={toggle}
                  routeSummary={agenda.route.summary}
                  pending={hero ? pending.has(hero.key) : false}
                  disabled={controlsDisabled}
                />
                <TodaySection
                  title="Also now"
                  entries={alsoNow}
                  onToggle={toggle}
                  pendingKeys={pending}
                  disabled={controlsDisabled}
                />
              </div>

              {/*
                Both tiles are derived from reads this page already performs,
                and both say plainly when they do not know. `—` is not a zero.
              */}
              <div className="order-2 grid grid-cols-2 gap-3 xl:order-none">
                <MetricCard
                  icon={Target}
                  tone="accent"
                  value={week.pending ? '—' : trainedThisWeek}
                  label={week.pending ? 'Sessions this week' : 'Trained in the last 7 days'}
                />
                <MetricCard
                  icon={Flame}
                  tone="warn"
                  value={
                    foundationStart.status === 'ready' && foundationDay?.day !== null
                      ? (foundationDay?.day ?? '—')
                      : '—'
                  }
                  label="Foundation day"
                />
              </div>

              <TodaySection
                title="Up next"
                entries={upNext}
                onToggle={toggle}
                pendingKeys={pending}
                disabled={controlsDisabled}
                className="order-4 xl:order-none"
              />

              <TodaySection
                title="Later today"
                entries={shown.LATER}
                onToggle={toggle}
                pendingKeys={pending}
                disabled={controlsDisabled}
                className="order-4 xl:order-none"
                listClassName="md:grid md:grid-cols-2 md:items-start xl:grid-cols-1"
              />
            </div>

            {/* Attention + archive rail */}
            <div className="contents xl:flex xl:flex-col xl:gap-5">
              <TodaySection
                title="Needs attention"
                entries={shown.LATE}
                onToggle={toggle}
                pendingKeys={pending}
                disabled={controlsDisabled}
                tone="alert"
                className="order-2 xl:order-none"
              />

              <TodaySection
                title="Done earlier"
                entries={shown.DONE_EARLIER}
                onToggle={toggle}
                pendingKeys={pending}
                disabled={controlsDisabled}
                className="order-5 xl:order-none"
              />

              {/*
                ROUND 24. This was an EmptyShell reading "Optional daily weight
                check-in comes in a later round" — for a feature that shipped in
                Round 15. A shipped screen said a feature did not exist, in
                roadmap language, on the app's landing page. It is now a real
                link to the screen that owns weight.
              */}
              <RowList className="order-6 xl:order-none" label="Progress">
                <li>
                  <ListRow
                    to="/progress"
                    linkLabel="Log today’s weight"
                    icon={Scale}
                    title="Log today's weight"
                    subtitle="Body weight, personal bests and your training history"
                  />
                </li>
              </RowList>
            </div>
          </div>
        </>
      )}
    </>
  )
}

/**
 * What the last seven days are known to be.
 *
 * Built from reads that already exist elsewhere in the app — the account's
 * workout history and its explicit training choices — so the strip adds no new
 * API surface. While either is loading nothing is marked, and a failed read
 * marks nothing rather than marking a day as untouched.
 */
function useWeekMarks(today: string): {
  marks: ReadonlyMap<string, WeekDayMark>
  pending: boolean
} {
  const from = addLocalDays(today, -6)
  const history = useWorkoutHistory()
  const flexRange = useTrainingFlexRange(from ? { from, to: today } : null)

  return useMemo(() => {
    const marks = new Map<string, WeekDayMark>()

    // A resolved day is a fact about the day itself, and survives whatever the
    // workout history says.
    if (flexRange.status === 'ready') {
      for (const [date, _kind] of flexRange.flex) {
        void _kind
        marks.set(date, 'resolved')
      }
    }

    /*
     * `complete` is the server's own statement that the read covered every
     * workout it was asked about. While it is false a missing row proves
     * nothing, so no workout mark is drawn at all rather than drawing a
     * partial picture that reads as a full one.
     */
    if (history.status === 'ready' && history.history?.complete) {
      for (const workout of history.history.workouts) {
        if (workout.progress.completed === 0) continue
        marks.set(workout.date, workout.kind === 'extra' ? 'extra' : 'completed')
      }
    }

    return {
      marks,
      pending: history.status === 'loading' || flexRange.status === 'loading',
    }
  }, [history.status, history.history, flexRange.status, flexRange.flex])
}

/** The day's mode is not known yet, so neither mode is presented. */
function TodayChecking() {
  return (
    <Card>
      {/* Card does not forward extra props, so the marker lives here. */}
      <div data-today-checking>
        <div className="flex items-center gap-4">
          <Skeleton className="size-10 rounded-[13px]" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="mt-2 h-3 w-2/5" />
          </div>
        </div>
        {/*
          The signal is the solid skeleton ground and this sentence, not the
          pulse: the app's reduced-motion rule freezes every animation, and a
          loading state carried only by movement disappears for the users most
          likely to have that setting on.
        */}
        <p role="status" className="mt-4 text-[13px] font-semibold text-ink-2">
          Checking whether today is a Holiday…
        </p>
      </div>
    </Card>
  )
}

/**
 * The day's mode could not be read.
 *
 * Falling back to the normal routine would be a guess that puts real pressure
 * on a day that may be exempt, so the routine stays hidden and the failure is
 * shown instead.
 */
function TodayHolidayError({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-today-holiday-error>
      <Banner
        tone="danger"
        live="alert"
        title="Could not check whether today is a Holiday"
        actions={
          <Button size="sm" onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        }
      >
        Your routine is not being guessed at, and nothing has been lost.
      </Banner>
    </div>
  )
}

/**
 * The Holiday banner.
 *
 * A Holiday suspends the WORK day, not the day itself, so this sits above a
 * real agenda rather than replacing it: the recovery template still applies,
 * and with Training On the weekday's own session is part of it.
 *
 * Which it is has to be visible. "Exempt" and "Training on" are genuinely
 * different days, and the difference decides whether a streak moves.
 */
function HolidayToday({ route }: { route: Route }) {
  const trainingOn = route.trainingOn === true
  return (
    <HeroCard tone="holiday" className="mb-5">
      {/* HeroCard does not forward extra props, so the marker lives here. */}
      <div data-today-holiday data-today-training={trainingOn ? 'on' : 'off'}>
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface text-holiday-ink md:size-14"
          >
            <Palmtree className="size-6" />
          </span>
          <div className="min-w-0">
            {/*
              The accepted wording, unchanged. "Exempt" and "Training on" are
              genuinely different days and the difference decides whether a
              streak moves, so the mode is stated in one unambiguous line
              rather than split across two chips a reader has to combine.
            */}
            <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-holiday-ink">
              Holiday · {trainingOn ? 'Training on' : 'Exempt'}
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-[-0.015em] text-ink md:text-2xl">
              {route.name || 'A planned pause from the normal routine.'}
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
              {trainingOn
                ? 'Your work routine stays paused, and the recovery-day schedule stays in place with today’s training session added. Foundation Day keeps counting.'
                : 'Your work routine is paused and today follows the recovery-day schedule. No training is required, and nothing is counted as missed. Foundation Day keeps counting.'}
            </p>
            <p className="mt-2 inline-flex items-center rounded-control border border-line px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
              {trainingOn ? 'Training on' : 'Training off'}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <ButtonLink to="/calendar">
            <CalendarRange className="size-4" aria-hidden="true" />
            Open Calendar
          </ButtonLink>
          {!trainingOn && (
            <Link
              to="/training"
              className="inline-flex min-h-tap items-center gap-1.5 rounded-control px-4 text-sm font-bold text-ink-2 no-underline transition-colors duration-fast hover:text-ink"
            >
              <Dumbbell className="size-4" aria-hidden="true" />
              Train anyway
            </Link>
          )}
        </div>
      </div>
    </HeroCard>
  )
}
