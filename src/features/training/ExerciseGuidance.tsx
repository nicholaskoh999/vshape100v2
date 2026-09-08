import { Check, Loader2 } from 'lucide-react'
import { useId, useState } from 'react'

import { cn } from '@/lib/utils'
import { isSetLoad, loadUnitLabel } from '@shared/workoutLog'
import type { CalibrationFeedback } from '@shared/progression/lane'
import type { LaneRecommendation, ProgressionLoad } from './progressionApi'

/**
 * Next-session guidance for ONE exercise, inside the active workout.
 *
 * Deliberately SUBORDINATE to logging. It sits above the set rows in a quieter
 * surface, in smaller type, and it never takes an action on its own: no input
 * is pre-filled from it, and nothing here writes a result. The only thing that
 * records training is pressing Complete on a set.
 *
 * Everything shown is either a recorded fact ("last time 12 / 12 / 11 / 10 at
 * 20kg") or a direction the person still has to act on ("increase one available
 * step"). Where V2 cannot name the next real load — it models no equipment
 * ladder — it says so and offers the person the field to name it instead of
 * inventing a number.
 */

const STATE_LABEL: Record<LaneRecommendation['state'], string> = {
  calibrate: 'Find your load',
  build_reps: 'Build reps',
  increase_load: 'Increase load',
  hold: 'Hold',
  reduce_load: 'Reduce load',
  quality: 'Quality',
  unavailable: 'No guidance',
}

/**
 * Colour carries meaning, not decoration.
 *
 * Movement states are the ones that ask something new of the person, so they
 * take the accent; holding, quality work and an honest "cannot say" stay
 * neutral so they never read as an instruction.
 */
const STATE_TONE: Record<LaneRecommendation['state'], string> = {
  calibrate: 'border-cyan/40 bg-cyan/10 text-cyan',
  build_reps: 'border-blue/40 bg-accent/10 text-info-ink',
  increase_load: 'border-energy/40 bg-energy/10 text-energy',
  hold: 'border-line-strong bg-surface-soft text-ink-2',
  reduce_load: 'border-warn-ink/40 bg-warn-soft/10 text-warn-ink',
  quality: 'border-line-strong bg-surface-soft text-ink-2',
  unavailable: 'border-line-strong bg-surface-soft text-ink-3',
}

const FEEDBACK_LABEL: Record<CalibrationFeedback, string> = {
  too_light: 'Too light',
  good: 'Good',
  too_heavy: 'Too heavy',
}

const FEEDBACKS: readonly CalibrationFeedback[] = ['too_light', 'good', 'too_heavy']

/** What a persisted calibration currently says, as a remount key. */
function calibrationKey(lane: LaneRecommendation): string {
  const chosen = lane.calibration?.chosenLoad
  return [
    lane.calibration?.feedback ?? 'none',
    chosen ? `${chosen.value}|${chosen.unit}` : 'none',
  ].join('#')
}

export type ExerciseGuidanceProps = {
  lane: LaneRecommendation
  /**
   * False while a re-read triggered by a change to the workout is in flight.
   *
   * The panel keeps its place and stays readable, but everything it OFFERS is
   * withheld: what is on screen was derived from a workout that has already
   * moved, and a judgement or a suggestion taken from it would be about a set
   * the person may have just taken back.
   */
  confirmed: boolean
  busy: boolean
  error: string | null
  onFeedback: (
    exerciseOrder: number,
    feedback: CalibrationFeedback,
    chosenLoad: ProgressionLoad | null,
  ) => void
}

export function ExerciseGuidance({
  lane,
  confirmed,
  busy,
  error,
  onFeedback,
}: ExerciseGuidanceProps) {
  return (
    <section
      aria-label={`Guidance for ${lane.exerciseName}`}
      aria-busy={!confirmed || undefined}
      className={cn(
        'mt-3.5 rounded-control border border-line bg-surface-soft/40 p-3',
        !confirmed && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
          Guidance
        </p>
        <span
          data-testid={`guidance-state-${lane.exerciseOrder}`}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em]',
            STATE_TONE[lane.state],
          )}
        >
          {STATE_LABEL[lane.state]}
        </span>
        {(busy || !confirmed) && (
          <Loader2 className="size-3.5 animate-spin text-ink-3" aria-hidden="true" />
        )}
      </div>

      <p className="mt-2 text-[13px] leading-snug text-ink-2">{lane.reason}</p>

      {!confirmed && (
        <p
          role="status"
          data-testid={`guidance-refreshing-${lane.exerciseOrder}`}
          className="mt-2 text-[12px] font-semibold text-ink-3"
        >
          Rechecking against your logged sets…
        </p>
      )}

      <LastResult lane={lane} />

      {lane.calibration && lane.calibration.stage !== 'awaiting_first_set' && (
        <Calibration
          // Keyed on what is PERSISTED, so a saved choice re-seeds the field
          // after a reload or a resume, while typing into it is never
          // interrupted — the key only moves when the stored answer does.
          key={calibrationKey(lane)}
          lane={lane}
          // Locked while busy AND while unconfirmed: a judgement is about the
          // first completed set, and that set may be exactly what changed.
          locked={busy || !confirmed}
          onFeedback={onFeedback}
        />
      )}

      {error && (
        <p role="alert" className="mt-2 text-[12px] font-semibold text-danger-ink">
          {error}
        </p>
      )}
    </section>
  )
}

/** What was actually recorded last time. A fact, never a prediction. */
function LastResult({ lane }: { lane: LaneRecommendation }) {
  const last = lane.lastResult
  if (!last || last.results.length === 0) return null

  const unitWord = lane.target?.resultKind === 'seconds' ? 's' : ''
  const perSide = lane.target?.resultKind === 'reps' && lane.target.perSide ? ' / side' : ''
  const unresolved = last.skipped + last.pending

  return (
    <dl className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px]">
      <dt className="font-bold uppercase tracking-[0.1em] text-ink-3">Last</dt>
      <dd className="font-semibold text-ink-2">
        {last.date} · {last.results.join(' / ')}
        {unitWord}
        {perSide}
        {last.load ? ` · ${last.load.value}${loadUnitLabel(last.load.unit)}` : ''}
        {unresolved > 0 ? ` · ${last.completed}/${last.prescribed} sets` : ''}
      </dd>
    </dl>
  )
}

/**
 * The starting-load conversation.
 *
 * It only ever appears once a first working set has genuinely been COMPLETED
 * with a recorded load — the judgement is about something that happened. The
 * completed set is never rewritten by it; "too light" changes the suggestion
 * for the sets still to come and nothing else.
 */
function Calibration({
  lane,
  locked,
  onFeedback,
}: {
  lane: LaneRecommendation
  locked: boolean
  onFeedback: ExerciseGuidanceProps['onFeedback']
}) {
  const fieldId = useId()
  const calibration = lane.calibration
  const chosen = calibration?.chosenLoad ?? null
  const unit = calibration?.observedLoad?.unit ?? null

  // Seeded from what was SAVED, so a reload shows the number the person chose
  // rather than an empty box, and editing it is still entirely theirs.
  const [loadInput, setLoadInput] = useState(chosen ? String(chosen.value) : '')

  if (!calibration) return null

  const trimmed = loadInput.trim()
  const parsed = Number(trimmed)
  const loadValid = trimmed === '' || isSetLoad(parsed)

  function submit(feedback: CalibrationFeedback) {
    if (locked || !loadValid || !unit) return
    // "Good" means the load that was actually lifted was right, so it never
    // carries a different number — the baseline is the completed set itself.
    const chosenLoad =
      feedback === 'good' || trimmed === '' ? null : { value: parsed, unit }
    onFeedback(lane.exerciseOrder, feedback, chosenLoad)
  }

  const showLoadField =
    calibration.stage === 'settled' && calibration.feedback !== 'good' && unit !== null

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
        How did that set feel?
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {FEEDBACKS.map((feedback) => {
          const active = calibration.feedback === feedback
          return (
            <button
              key={feedback}
              type="button"
              aria-pressed={active}
              disabled={locked}
              onClick={() => submit(feedback)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-[12px] font-bold transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-40',
                active
                  ? 'border-cyan/60 bg-cyan/15 text-cyan'
                  : 'border-line-strong text-ink-2 hover:text-ink',
              )}
            >
              {active && <Check className="size-3.5" aria-hidden="true" />}
              {FEEDBACK_LABEL[feedback]}
            </button>
          )
        })}
      </div>

      {showLoadField && unit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0">
            <label
              htmlFor={fieldId}
              className="block text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3"
            >
              {`Load you moved to (${loadUnitLabel(unit)})`}
            </label>
            <input
              id={fieldId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={loadInput}
              placeholder="—"
              onChange={(event) => setLoadInput(event.target.value)}
              aria-invalid={!loadValid || undefined}
              className={cn(
                'mt-1 w-24 rounded-control border bg-surface px-2.5 py-1.5 text-[15px] font-bold text-ink outline-offset-[-2px]',
                loadValid ? 'border-line-strong' : 'border-danger-ink',
              )}
            />
          </div>
          <button
            type="button"
            disabled={locked || !loadValid || calibration.feedback === null}
            onClick={() => calibration.feedback && submit(calibration.feedback)}
            className="rounded-control border border-line-strong px-3 py-2 text-[12px] font-bold text-ink-2 transition-colors duration-fast hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save load
          </button>
        </div>
      )}
    </div>
  )
}
