import { ChevronLeft, ChevronRight, Loader2, Plane, RefreshCw, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useRef, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants, press } from '@/design/motion'
import { localWorkoutDate } from '@/features/training/workoutPlan'
import { cn } from '@/lib/utils'
import type { HolidayRecord } from '@shared/holiday'
import {
  buildMonthGrid,
  DAY_TYPE_LABEL,
  formatRange,
  gridSpan,
  monthLabel,
  monthOf,
  orderSelection,
  selectionLength,
  shiftMonth,
  WEEKDAY_LABELS,
  type CalendarDay,
  type DayType,
} from './calendarModel'
import { createHoliday, deleteHoliday, updateHoliday, HolidayApiError } from './holidayApi'
import { useHolidays } from './useHolidays'

/**
 * Calendar — the month view and the Holiday editor.
 *
 * Two modes only: Home (the absence of a Holiday) and Holiday. A Holiday is
 * EXEMPT, not missed — it suspends the routine's pressure on the days it
 * covers and changes nothing else. Foundation keeps counting through it.
 *
 * Ranges never merge, split or absorb one another. Saving something that
 * overlaps an existing Holiday is reported as a conflict, so an edit or a
 * delete always does exactly what it says.
 */

/** What the editor is doing. Drives the live status line. */
type Feedback =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'deleting' }
  | { state: 'deleted' }
  | { state: 'conflict'; range: string }
  | { state: 'error'; message: string }

export function CalendarPage() {
  const [today] = useState(() => localWorkoutDate())
  const [view, setView] = useState(() => monthOf(today))

  // Selection is a pair of local dates. `anchor` is set by the first click of
  // a range and cleared by the second.
  const [anchor, setAnchor] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ start: string; end: string } | null>(null)
  const [editing, setEditing] = useState<HolidayRecord | null>(null)
  const [feedback, setFeedback] = useState<Feedback>({ state: 'idle' })

  // A mutation in flight. A ref so the double-submit guard is decided
  // synchronously, the same rule the rest of the app uses.
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)

  // The grid drives the read span, so a month change refetches exactly what
  // the month can display — including the padding days.
  const emptyGrid = useMemo(
    () => buildMonthGrid(view.year, view.month, []),
    [view.year, view.month],
  )
  const span = useMemo(() => gridSpan(emptyGrid), [emptyGrid])
  const { status, holidays, reload } = useHolidays(span)

  const days = useMemo(
    () => buildMonthGrid(view.year, view.month, holidays),
    [view.year, view.month, holidays],
  )

  function goMonth(delta: number) {
    setView((current) => shiftMonth(current.year, current.month, delta))
    // A selection belongs to the month it was made in.
    setAnchor(null)
    setSelection(null)
    setEditing(null)
    setFeedback({ state: 'idle' })
  }

  /**
   * Interaction state once a mutation has landed.
   *
   * A range is drawn with two clicks, but a single day is drawn with ONE, so
   * `anchor` is still set when the save succeeds. Left behind, it makes the
   * NEXT click read as the second click of a range: the branch that opens a
   * saved Holiday for editing is gated on `anchor === null`, so that click
   * silently redraws a stale selection instead of opening the record, and
   * saving from there writes a second Holiday or collides with the first.
   *
   * Clearing all three is what "the action is finished" means here. Only the
   * success path resets — a refused or failed write leaves the drawing alone
   * so the user can adjust it and try again.
   */
  function resetInteraction() {
    setAnchor(null)
    setSelection(null)
    setEditing(null)
  }

  function handleDayClick(day: CalendarDay) {
    setFeedback({ state: 'idle' })

    // Clicking inside an existing Holiday opens it for editing rather than
    // starting a selection that would immediately conflict with it — unless it
    // is already the one being edited, in which case the click is the user
    // re-drawing its range. Without that exception a saved Holiday could never
    // be shortened, because every click inside it would just reopen it whole.
    const covering = day.holiday
    if (covering !== null && covering.id !== editing?.id && anchor === null) {
      setEditing(covering)
      setSelection({ start: covering.startDate, end: covering.endDate })
      return
    }

    if (anchor === null) {
      // Re-drawing inside the open record stays an edit of it; starting
      // anywhere else is a new Holiday.
      setEditing(day.holiday?.id === editing?.id ? editing : null)
      setAnchor(day.date)
      setSelection({ start: day.date, end: day.date })
      return
    }

    // Second click closes the range, in either direction.
    setSelection(orderSelection(anchor, day.date))
    setAnchor(null)
  }

  async function runMutation(
    action: () => Promise<void>,
    working: Feedback,
    done: Feedback,
  ) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setFeedback(working)
    try {
      await action()
      resetInteraction()
      setFeedback(done)
      reload()
    } catch (error: unknown) {
      if (error instanceof HolidayApiError && error.status === 409) {
        setFeedback({
          state: 'conflict',
          range: error.conflict
            ? formatRange(error.conflict.startDate, error.conflict.endDate)
            : 'an existing Holiday',
        })
      } else {
        console.error('Holiday could not be saved', error)
        setFeedback({
          state: 'error',
          message: 'Could not save that change. Nothing has been altered — try again.',
        })
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function handleSave() {
    if (!selection) return
    const input = { startDate: selection.start, endDate: selection.end }
    const target = editing
    void runMutation(
      async () => {
        if (target) await updateHoliday(target.id, input)
        else await createHoliday(input)
      },
      { state: 'saving' },
      { state: 'saved' },
    )
  }

  function handleDelete() {
    if (!editing) return
    const target = editing
    void runMutation(
      async () => {
        await deleteHoliday(target.id)
      },
      { state: 'deleting' },
      { state: 'deleted' },
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Home Mode"
        title="Calendar"
        subline="Mark a day or a range as Holiday — exempt, not missed."
      />

      <motion.div
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-4"
      >
        <motion.div variants={listItemVariants}>
          <Card className="p-4 md:p-5">
            <MonthHeader
              label={monthLabel(view.year, view.month)}
              onPrev={() => goMonth(-1)}
              onNext={() => goMonth(1)}
            />

            {status === 'error' ? (
              <LoadError onRetry={reload} />
            ) : (
              <MonthGrid
                days={days}
                today={today}
                selection={selection}
                // Until the read lands, the month's Holiday state is unknown.
                // The cells are shown as unknown and are not actionable, so a
                // day is never presented as confirmed Training/Chill/Recovery
                // and no Holiday can be drawn against a month we cannot see.
                resolved={status === 'ready'}
                onDayClick={handleDayClick}
              />
            )}

            <Legend />
          </Card>
        </motion.div>

        <motion.div variants={listItemVariants}>
          <HolidayEditor
            selection={selection}
            editing={editing}
            anchorPending={anchor !== null}
            // Saving against a month we cannot see could silently overlap a
            // Holiday that is already there.
            busy={busy || status !== 'ready'}
            feedback={feedback}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        </motion.div>
      </motion.div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Month                                                               */
/* ------------------------------------------------------------------ */

function MonthHeader({
  label,
  onPrev,
  onNext,
}: {
  label: string
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <MonthButton label="Previous month" onClick={onPrev}>
        <ChevronLeft className="size-5" aria-hidden="true" />
      </MonthButton>
      <h2 className="text-[17px] font-extrabold tracking-tight text-offwhite md:text-xl">
        {label}
      </h2>
      <MonthButton label="Next month" onClick={onNext}>
        <ChevronRight className="size-5" aria-hidden="true" />
      </MonthButton>
    </div>
  )
}

function MonthButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-10 shrink-0 place-items-center rounded-control border border-edge text-ink-dim transition-colors duration-150 hover:border-edge-strong hover:text-offwhite"
    >
      {children}
    </button>
  )
}

const TYPE_STYLES: Record<DayType | 'unknown', string> = {
  training: 'text-ink-dim',
  saturday: 'text-cyan',
  sunday: 'text-purple',
  // Holiday is the override, so it is the only one with a filled surface.
  holiday: 'bg-holiday/20 text-holiday',
  // Not a day type — the state before we know one.
  unknown: 'text-ink-faint',
}

function MonthGrid({
  days,
  today,
  selection,
  resolved,
  onDayClick,
}: {
  days: CalendarDay[]
  today: string
  selection: { start: string; end: string } | null
  resolved: boolean
  onDayClick: (day: CalendarDay) => void
}) {
  return (
    <div data-calendar-grid data-resolved={resolved} className={cn(!resolved && 'opacity-60')}>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-1 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint"
          >
            {label}
          </div>
        ))}
      </div>

      <div role="grid" aria-label="Month" className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const selected =
            selection !== null && day.date >= selection.start && day.date <= selection.end
          const shown = resolved ? day.type : 'unknown'
          return (
            <motion.button
              key={day.date}
              type="button"
              role="gridcell"
              onClick={() => onDayClick(day)}
              disabled={!resolved}
              aria-label={
                resolved ? `${day.date} · ${DAY_TYPE_LABEL[day.type]}` : `${day.date} · Checking`
              }
              aria-selected={selected}
              data-day={day.date}
              data-day-type={shown}
              whileTap={press.whileTap}
              transition={press.transition}
              className={cn(
                'flex aspect-square min-w-0 flex-col items-center justify-center rounded-control border text-[13px] font-bold transition-colors duration-150',
                day.inMonth ? 'border-edge' : 'border-transparent opacity-40',
                TYPE_STYLES[shown],
                selected && 'border-blue bg-blue/15 text-offwhite',
                day.date === today && !selected && 'border-blue/60',
                !resolved && 'cursor-progress',
              )}
            >
              <span className="tabular-nums">{day.dayOfMonth}</span>
              {shown === 'holiday' && (
                <span aria-hidden="true" className="mt-0.5 text-[9px] font-extrabold uppercase">
                  Hol
                </span>
              )}
            </motion.button>
          )
        })}
      </div>

      {!resolved && (
        <p role="status" className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-ink-faint">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Loading your calendar…
        </p>
      )}
    </div>
  )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-6">
      <p role="alert" className="text-[13px] font-semibold text-coral">
        Could not load your calendar. Nothing has been changed.
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
  )
}

function Legend() {
  const entries: { type: DayType; label: string }[] = [
    { type: 'training', label: 'Training' },
    { type: 'saturday', label: 'Chill' },
    { type: 'sunday', label: 'Recovery' },
    { type: 'holiday', label: 'Holiday' },
  ]
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
      {entries.map((entry) => (
        <li key={entry.type} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn('size-2.5 rounded-full', {
              training: 'bg-ink-faint',
              saturday: 'bg-cyan',
              sunday: 'bg-purple',
              holiday: 'bg-holiday',
            }[entry.type])}
          />
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
            {entry.label}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

function HolidayEditor({
  selection,
  editing,
  anchorPending,
  busy,
  feedback,
  onSave,
  onDelete,
}: {
  selection: { start: string; end: string } | null
  editing: HolidayRecord | null
  anchorPending: boolean
  busy: boolean
  feedback: Feedback
  onSave: () => void
  onDelete: () => void
}) {
  return (
    <Card className="p-5">
      {/* Card does not forward extra props, so the marker lives here. */}
      <div data-holiday-editor>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-overlay text-holiday"
        >
          <Plane className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
            Holiday Mode
          </p>

          {!selection ? (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
              Pick a day to mark it Holiday, or pick two to cover a range. Holiday is
              exempt — the routine pauses and Foundation keeps counting.
            </p>
          ) : (
            <>
              <p className="mt-1 text-[17px] font-extrabold tracking-tight text-offwhite">
                {formatRange(selection.start, selection.end)}
              </p>
              <p className="mt-0.5 text-[12px] font-semibold text-ink-faint">
                {selectionLength(selection.start, selection.end)}{' '}
                {selectionLength(selection.start, selection.end) === 1 ? 'day' : 'days'}
                {anchorPending
                  ? ' · pick a second day to finish the range'
                  : editing
                    ? ' · editing a saved Holiday'
                    : ''}
              </p>
            </>
          )}
        </div>
      </div>

      {selection && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-control bg-blue px-4 py-2.5 text-[13px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && feedback.state === 'saving' && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {editing ? 'Update Holiday' : 'Save Holiday'}
          </button>

          {editing && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2.5 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy && feedback.state === 'deleting' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Delete
            </button>
          )}
        </div>
      )}

      <EditorFeedback feedback={feedback} />
      </div>
    </Card>
  )
}

function EditorFeedback({ feedback }: { feedback: Feedback }) {
  if (feedback.state === 'idle') return null

  if (feedback.state === 'conflict') {
    return (
      <p role="alert" className="mt-3 text-[13px] font-semibold text-late">
        That overlaps an existing Holiday ({feedback.range}). Edit that one instead, or
        pick dates outside it.
      </p>
    )
  }

  if (feedback.state === 'error') {
    return (
      <p role="alert" className="mt-3 text-[13px] font-semibold text-coral">
        {feedback.message}
      </p>
    )
  }

  const label = {
    saving: 'Saving…',
    saved: 'Saved',
    deleting: 'Removing…',
    deleted: 'Removed',
  }[feedback.state]

  return (
    <p role="status" className="mt-3 text-[13px] font-semibold text-ink-faint">
      {label}
    </p>
  )
}
