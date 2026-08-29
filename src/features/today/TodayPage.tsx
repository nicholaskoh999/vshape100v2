import { Scale } from 'lucide-react'

import { EmptyShell } from '@/components/ui/EmptyShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { TodayHero } from './components/TodayHero'
import { TodaySection } from './components/TodaySection'
import { useToday } from './useToday'

const FOUNDATION_DAY_1 = new Date(2026, 7, 31) // 2026-08-31 local time
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Foundation day number by real calendar date. Day 100 is a milestone, not an end. */
function foundationDay(now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor((today.getTime() - FOUNDATION_DAY_1.getTime()) / MS_PER_DAY) + 1
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
  const { now, agenda, groups, toggle } = useToday()

  const day = foundationDay(now)
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
        eyebrow={
          day < 1
            ? `Foundation starts in ${1 - day} day${1 - day === 1 ? '' : 's'}`
            : `Foundation · Day ${day}`
        }
        title="Today"
        subline={`${dateLabel} · ${agenda.route.label}`}
        actions={<ClockChip now={now} />}
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
            />
            <TodaySection title="Also now" entries={alsoNow} onToggle={toggle} />
          </div>

          <TodaySection
            title="Up next"
            entries={upNext}
            onToggle={toggle}
            className="order-3 xl:order-none"
          />

          <TodaySection
            title="Later today"
            entries={groups.LATER}
            onToggle={toggle}
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
            tone="alert"
            className="order-2 xl:order-none"
          />

          <TodaySection
            title="Done earlier"
            entries={groups.DONE_EARLIER}
            onToggle={toggle}
            className="order-5 xl:order-none"
          />

          <EmptyShell
            icon={Scale}
            title="Weight check-in"
            note="Optional daily weight logging lands together with local data storage."
            className="order-6 xl:order-none"
          />
        </div>
      </div>
    </>
  )
}
