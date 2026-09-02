import { ChevronDown, Loader2, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import { cn } from '@/lib/utils'
import {
  cancelWorkoutStart,
  fetchWorkout,
  type WorkoutSet,
} from '@/features/training/workoutApi'
import { formatShortDate } from './formatDate'
import { RecordedSetEditor } from './RecordedSetEditor'

/**
 * The completed sets of one recorded workout, opened on demand.
 *
 * Collapsed by default and fetched only when opened, so the Recent Workouts
 * list still costs one request. Only COMPLETED sets are listed: a pending or
 * skipped set has no recorded performance to correct, and offering to edit one
 * would suggest a correction could turn it into training that did not happen.
 */

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; sets: WorkoutSet[]; cancelable: boolean }
  | { status: 'error' }

export function RecordedWorkoutSets({
  date,
  sessionId,
  onCancelled,
}: {
  date: string
  sessionId: string
  /** Called once an accidental Start has actually been removed. */
  onCancelled?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State>({ status: 'idle' })
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const log = await fetchWorkout(date, sessionId)
      setState({ status: 'ready', sets: log.sets, cancelable: log.cancelable })
    } catch (error: unknown) {
      console.error('Recorded sets could not be loaded', error)
      setState({ status: 'error' })
    }
  }, [date, sessionId])

  /** Replace one set with the corrected truth the server confirmed. */
  const adopt = useCallback((next: WorkoutSet) => {
    setState((current) =>
      current.status === 'ready'
        ? {
            ...current,
            sets: current.sets.map((row) =>
              row.exerciseOrder === next.exerciseOrder && row.setIndex === next.setIndex
                ? next
                : row,
            ),
          }
        : current,
    )
  }, [])

  const completed = state.status === 'ready' ? state.sets.filter((s) => s.status === 'completed') : []

  /**
   * Taking back an accidental Start on a PAST date.
   *
   * The Training page deliberately follows today's clock, so this is where a
   * mis-tap from an earlier day is actually met — the workout is sitting in the
   * history list with nothing recorded in it. Offered only while the server
   * says it was never worked in.
   */
  async function cancelStart() {
    setCancelling(true)
    setCancelError(null)
    try {
      await cancelWorkoutStart(date, sessionId)
      setConfirming(false)
      setOpen(false)
      setState({ status: 'idle' })
      onCancelled?.()
    } catch (error: unknown) {
      console.error('Workout start could not be cancelled', error)
      const conflict = (error as { status?: number }).status === 409
      setCancelError(
        conflict
          ? 'This workout has already been used, so its start can no longer be cancelled.'
          : 'Could not cancel this workout. Check your connection and try again.',
      )
      // Our picture is out of date either way; go and get the truthful one.
      void load()
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next && state.status === 'idle') void load()
        }}
        className="inline-flex items-center gap-1 rounded-control text-[12px] font-bold text-ink-faint transition-colors duration-150 hover:text-offwhite"
      >
        <ChevronDown
          className={cn('size-3.5 transition-transform duration-150', open && 'rotate-180')}
          aria-hidden="true"
        />
        {`Recorded sets · ${formatShortDate(date)}`}
      </button>

      {open && (
        <div className="mt-2">
          {state.status === 'loading' && (
            <p className="flex items-center gap-2 text-[12px] text-ink-faint">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Loading recorded sets
            </p>
          )}

          {state.status === 'error' && (
            <p className="flex flex-wrap items-center gap-2 text-[12px] text-coral">
              Recorded sets could not be loaded.
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-control font-bold text-blue underline-offset-2 hover:underline"
              >
                Retry
              </button>
            </p>
          )}

          {state.status === 'ready' && completed.length === 0 && (
            <p className="text-[12px] text-ink-faint">
              No completed sets in this workout.
            </p>
          )}

          {state.status === 'ready' && state.cancelable && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-2.5 py-1 text-[11px] font-bold text-ink-faint transition-colors duration-150 hover:text-offwhite"
            >
              <Trash2 className="size-3" aria-hidden="true" />
              Cancel workout start
            </button>
          )}

          {state.status === 'ready' && state.cancelable && confirming && (
            <div className="mt-2 rounded-control border border-edge-strong bg-surface-overlay/60 p-2.5">
              <p className="text-[12px] font-bold text-offwhite">Cancel this workout?</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                No sets have been recorded. This will return the workout to Not
                started, and remove it from this list.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void cancelStart()}
                  disabled={cancelling}
                  className="inline-flex items-center gap-1.5 rounded-control bg-coral px-2.5 py-1 text-[11px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {cancelling && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
                  Cancel workout
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={cancelling}
                  className="rounded-control px-2.5 py-1 text-[11px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Keep workout
                </button>
              </div>
            </div>
          )}

          {cancelError && (
            <p role="alert" className="mt-2 text-[11px] font-semibold text-coral">
              {cancelError}
            </p>
          )}

          {state.status === 'ready' && completed.length > 0 && (
            <ul className="flex flex-col gap-2">
              {completed.map((set) => (
                <li
                  key={`${set.exerciseOrder}:${set.setIndex}`}
                  className="rounded-control border border-edge bg-surface-overlay/40 p-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-bold text-offwhite">
                        {set.exerciseName}
                        <span className="ml-1.5 font-semibold text-ink-faint">
                          set {set.setIndex + 1}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink-dim">
                        {describeRecorded(set)}
                        {set.correctedAt !== null && (
                          <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                            Corrected
                          </span>
                        )}
                      </p>
                    </div>
                    <RecordedSetEditor
                      date={date}
                      sessionId={sessionId}
                      set={set}
                      onCorrected={adopt}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * What one recorded set says, in its own terms.
 *
 * A band is named and counted; it is never converted into kilograms, and no
 * unit is appended to a number that is not a weight.
 */
function describeRecorded(set: WorkoutSet): string {
  const unit = set.resultKind === 'seconds' ? 's' : ' reps'
  const perSide = set.resultKind === 'reps' && set.perSide ? ' / side' : ''
  const result = `${set.result ?? '—'}${unit}${perSide}`
  if (set.band) return `${set.band.label} ×${set.band.count} · ${result}`
  if (set.load) {
    return `${set.load.value} kg${set.load.unit === 'kg_each' ? ' each' : ''} × ${result}`
  }
  return result
}
