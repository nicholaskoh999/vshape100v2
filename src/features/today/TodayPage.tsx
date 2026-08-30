import { CalendarRange, Dumbbell, Loader2, Palmtree, RefreshCw, Scale } from 'lucide-react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { EmptyShell } from '@/components/ui/EmptyShell'
import { PageHeader } from '@/components/ui/PageHeader'
import type { HolidayStatus } from '@/features/calendar/useHolidays'
import { foundationStatus } from '@/features/progress/foundation'
import { localDateOf } from '@shared/localDate'
import { TodayHero } from './components/TodayHero'
import { TodaySection } from './components/TodaySection'
import { TodayStatusNotice } from './components/TodayStatusNotice'
import { useToday } from './useToday'

/**
 * The day's mode, for the header.
 *
 * Until the Holiday state is known the agenda is built from an empty Holiday
 * set, so `agenda.route.label` would read "Home Mode" on a day that may turn
 * out to be exempt. The body is already neutral while the mode is unknown; the
 * header has to be too, or it states a resolved mode we do not have.
 */
function dayModeLabel(status: HolidayStatus, routeLabel: string): string {
  if (status === 'loading') return 'Checking day mode'
  if (status === 'error') return 'Day mode unavailable'
  return routeLabel
}

/**
 * The Foundation eyebrow.
 *
 * Uses the one accepted Foundation calculation rather than a second copy:
 * this page previously divided a millisecond difference, which a daylight-
 * saving transition makes 23 or 25 hours and therefore off by a day. Holiday
 * changes nothing here — the day number follows the real calendar either way.
 */
function foundationEyebrow(now: Date): string {
  const status = foundationStatus(localDateOf(now))
  if (!status) return 'Foundation'
  if (status.phase === 'upcoming') {
    const days = status.daysUntilStart ?? 0
    return `Foundation starts in ${days} day${days === 1 ? '' : 's'}`
  }
  return `Foundation · Day ${status.day}`
}

/** Small live readout — also the visible proof the page follows the clock. */
function ClockChip({ now }: { now: Date }) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1.5">
      <span className="size-1.5 animate-pulse rounded-full bg-lime" aria-hidden="true" />
      <span className="text-sm font-bold tabular-nums text-ink-dim">
        {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

/**
 * Today.
 *
 * Layout follows priority, not the clock: what is happening leads, unfinished
 * overdue work sits right behind it, then the rest of the day, then what is
 * already done.
 *
 * - mobile: one column, sections ordered NOW → LATE → NEXT → LATER → DONE
 * - tablet: same column, wider rows and a two-up "Later today" grid
 * - desktop: schedule on the left, needs-attention + done in a lighter rail
 *
 * The mobile order is expressed with `order-*` on a `display: contents`
 * wrapper, so both layouts share one set of DOM nodes.
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

  // With nothing current, the closest upcoming item leads instead — and then
  // it must not appear a second time under "Up next".
  const hero = groups.NOW[0] ?? groups.NEXT[0] ?? null
  const alsoNow = groups.NOW.slice(1)
  const upNext = groups.NOW.length > 0 ? groups.NEXT : []

  return (
    <>
      <PageHeader
        eyebrow={foundationEyebrow(now)}
        title="Today"
        subline={`${dateLabel} · ${dayModeLabel(holidayStatus, agenda.route.label)}`}
        actions={<ClockChip now={now} />}
      />

      {/*
        Whether today is a Holiday is a fact we may not have yet. Until the
        answer is known the normal routine is NOT rendered: showing it would
        put the day's pressure on a day that may be exempt, and would expose
        completion controls for a routine that may not apply. "Unknown" is
        neither Home nor Holiday, and is shown as itself.
      */}
      {holidayStatus === 'loading' && <TodayChecking />}
      {holidayStatus === 'error' && <TodayHolidayError onRetry={retryHolidays} />}

      {holidayStatus === 'ready' && agenda.holiday && <HolidayToday />}

      {holidayStatus === 'ready' && !agenda.holiday && (
      <>
      <TodayStatusNotice
        hydration={hydration}
        failureMessage={failureMessage}
        onRetry={retryHydration}
        onDismiss={dismissFailure}
      />

      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:items-start xl:gap-6">
        {/* Schedule column */}
        <div className="contents xl:flex xl:flex-col xl:gap-5">
          <div className="order-1 flex flex-col gap-2.5 xl:order-none">
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

          <TodaySection
            title="Up next"
            entries={upNext}
            onToggle={toggle}
            pendingKeys={pending}
            disabled={controlsDisabled}
            className="order-3 xl:order-none"
          />

          <TodaySection
            title="Later today"
            entries={groups.LATER}
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
            entries={groups.LATE}
            onToggle={toggle}
            pendingKeys={pending}
            disabled={controlsDisabled}
            tone="alert"
            className="order-2 xl:order-none"
          />

          <TodaySection
            title="Done earlier"
            entries={groups.DONE_EARLIER}
            onToggle={toggle}
            pendingKeys={pending}
            disabled={controlsDisabled}
            className="order-5 xl:order-none"
          />

          <EmptyShell
            icon={Scale}
            title="Weight check-in"
            note="Optional daily weight check-in comes in a later round."
            className="order-6 xl:order-none"
          />
        </div>
      </div>
      </>
      )}
    </>
  )
}

/** The day's mode is not known yet, so neither mode is presented. */
function TodayChecking() {
  return (
    <Card className="p-5">
      {/* Card does not forward extra props, so the marker lives here. */}
      <div data-today-checking>
      <p
        role="status"
        className="flex items-center gap-2 text-[13px] font-semibold text-ink-dim"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
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
    <Card className="p-5">
      {/* Card does not forward extra props, so the marker lives here. */}
      <div data-today-holiday-error>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="alert" className="text-[13px] font-semibold text-coral">
          Could not check whether today is a Holiday. Nothing has been lost.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </button>
      </div>
      </div>
    </Card>
  )
}

/**
 * Today on a Holiday date.
 *
 * EXEMPT, not missed. The normal agenda is not rendered at all, so nothing can
 * read as late — and nothing is marked complete to achieve that. Training stays
 * reachable for anyone who genuinely wants it, but nothing here asks for it.
 */
function HolidayToday() {
  return (
    <Card className="p-5 md:p-6">
      {/* Card does not forward extra props, so the marker lives here. */}
      <div data-today-holiday>
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-2xl bg-holiday/15 text-holiday md:size-14"
        >
          <Palmtree className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-holiday">
            Holiday · Exempt
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-offwhite md:text-2xl">
            A planned pause from the normal routine.
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">
            Nothing is due today and nothing is counted as missed. Foundation Day keeps
            counting.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link
          to="/calendar"
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-control border border-edge-strong px-4 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:border-blue/60 hover:text-offwhite"
        >
          <CalendarRange className="size-4" aria-hidden="true" />
          Open Calendar
        </Link>
        <Link
          to="/training"
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-control border border-edge px-4 text-[13px] font-bold text-ink-faint transition-colors duration-150 hover:border-edge-strong hover:text-offwhite"
        >
          <Dumbbell className="size-4" aria-hidden="true" />
          Train anyway
        </Link>
      </div>
      </div>
    </Card>
  )
}
