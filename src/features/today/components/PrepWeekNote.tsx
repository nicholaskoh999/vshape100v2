import { CalendarCheck } from 'lucide-react'

import { Card } from '@/components/ui/Layout'
import type { FoundationStatus } from '@/features/progress/foundation'

/**
 * ROUND 27 (VT-02). The days before Foundation Day 1, said out loud.
 *
 * Before this, the run-up to Day 1 was one small eyebrow — "Foundation starts
 * in 6 days" — above a page whose Foundation metric read `—`. Factually
 * correct, and quietly discouraging: it framed a week of real training as a
 * waiting room.
 *
 * It is not a waiting room. The Round 25 reset happened once and is finished;
 * every workout, set and completion logged before Day 1 is REAL RETAINED
 * HISTORY and nothing about Day 1 removes it. The third line says so, and it
 * is the reason this component exists at all.
 *
 * WHAT IT REFUSES TO INVENT.
 *
 *   - The count comes from `foundationStatus`, the one accepted Foundation
 *     calculation, via `daysUntilStart`. Nothing here re-derives a date, and
 *     no number is hard-coded to any particular day.
 *   - It renders ONLY in the `upcoming` phase. `upcoming` means `day < 1`, so
 *     `daysUntilStart` is at least 1 by construction: there is no Day 0 to
 *     show and no negative day to guard against after the fact.
 *   - On Day 1 the phase becomes `foundation` and this returns null. The
 *     normal Foundation state takes over with nothing to dismiss and nothing
 *     to unwind — the component simply stops existing.
 *   - It reads the phase rather than comparing dates itself, so a caller
 *     cannot get a prep note and a Day number on screen at the same time.
 *
 * It changes no completion, history or progression semantics. It is a
 * paragraph.
 */
export function PrepWeekNote({ status }: { status: FoundationStatus | null }) {
  if (!status || status.phase !== 'upcoming') return null

  // `upcoming` guarantees this, but a null here would print "null days".
  const days = status.daysUntilStart
  if (days === null || days < 1) return null

  return (
    <Card
      // ROUND 27 (VT-04) in use: `role` and `aria-labelledby` reach the card's
      // own element, so the eyebrow, the count and the reassurance are one
      // named unit rather than three loose paragraphs above the week strip.
      role="group"
      aria-labelledby="prep-week-title"
      className="mb-5 flex items-center gap-3.5 border-accent-edge/30 bg-linear-168 from-accent-soft to-surface to-72%"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-surface/70 text-accent-ink"
      >
        <CalendarCheck className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-accent-ink">
          Prep week
        </p>
        <p id="prep-week-title" className="mt-0.5 text-[15px] font-bold leading-[1.3] text-ink">
          {days} {days === 1 ? 'day' : 'days'} until Foundation Day 1
        </p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
          Your training still counts — everything you log now is kept.
        </p>
      </div>
    </Card>
  )
}
