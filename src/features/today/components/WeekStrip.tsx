import { Card } from '@/components/ui/Layout'
import { cn } from '@/lib/utils'
import { addLocalDays } from '@shared/localDate'

/**
 * The rolling seven days ending today.
 *
 * WHAT A MARK IS ALLOWED TO MEAN.
 *
 * Only three facts are marked, and each is read from real persisted truth:
 *
 *   completed  a scheduled workout was recorded on that date
 *   extra      a voluntary Extra was recorded on that date
 *   resolved   the day was explicitly resolved as Recovery / Fitness Boxing
 *
 * A day with NO mark is a day with nothing to say — never "you missed it".
 * Absence of evidence is not evidence here: `complete` on the history read is
 * the server's own statement that it returned every workout it was asked
 * about, and while that is false no completed mark is drawn at all, because a
 * missing row would then only mean "outside what was returned".
 *
 * NO STATUS BY COLOUR ALONE. Every mark carries a visually hidden sentence
 * naming what it is, so the strip is legible to a screen reader and in
 * forced-colors mode.
 */

export type WeekDayMark = 'completed' | 'extra' | 'resolved' | null

export type WeekStripProps = {
  /** Local date of the last (right-most) cell — today. */
  today: string
  /** What each date is known to be. Absent means "nothing to say". */
  marks: ReadonlyMap<string, WeekDayMark>
  /** True while any source is still loading; no marks are drawn. */
  pending?: boolean
}

const MARK_TONE: Record<Exclude<WeekDayMark, null>, string> = {
  completed: 'bg-success-mark',
  extra: 'bg-accent-edge',
  resolved: 'bg-recovery-ink',
}

const MARK_LABEL: Record<Exclude<WeekDayMark, null>, string> = {
  completed: 'workout completed',
  extra: 'extra workout',
  resolved: 'resolved as recovery',
}

function weekdayName(date: string): string {
  // Parsed as a plain calendar date, in UTC, so the label never shifts by one
  // day for a user east or west of the machine's own zone.
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  })
}

function dayNumber(date: string): string {
  return String(Number(date.slice(8, 10)))
}

export function WeekStrip({ today, marks, pending = false }: WeekStripProps) {
  const days: string[] = []
  for (let offset = -6; offset <= 0; offset += 1) {
    const date = addLocalDays(today, offset)
    if (date === null) return null
    days.push(date)
  }

  return (
    <Card className="px-2.5 py-3">
      <ol aria-label="The last seven days" className="grid grid-cols-7 gap-1.5">
        {days.map((date) => {
          const isToday = date === today
          const mark = pending ? null : (marks.get(date) ?? null)
          return (
            <li key={date}>
              <div
                aria-current={isToday ? 'date' : undefined}
                className={cn(
                  'flex min-h-tap flex-col items-center justify-center gap-1.5 rounded-control border px-0 py-2',
                  isToday ? 'border-ink bg-ink' : 'border-transparent',
                )}
              >
                <span
                  className={cn(
                    'text-[10.5px] font-bold uppercase tracking-[0.06em]',
                    isToday ? 'text-ink-on-dark' : 'text-ink-3',
                  )}
                >
                  {weekdayName(date)}
                </span>
                <span
                  className={cn(
                    'text-[15px] font-bold',
                    isToday ? 'text-ink-on-dark' : 'text-ink',
                  )}
                >
                  {dayNumber(date)}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    mark
                      ? isToday && mark === 'completed'
                        ? 'bg-accent'
                        : MARK_TONE[mark]
                      : 'bg-transparent',
                  )}
                />
                <span className="sr-only">
                  {isToday ? 'Today. ' : ''}
                  {mark ? MARK_LABEL[mark] : 'nothing recorded'}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
