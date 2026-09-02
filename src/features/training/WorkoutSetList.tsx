import { Check, Loader2, RotateCcw, SkipForward, Wand2 } from 'lucide-react'
import { useId, useState } from 'react'

import { cn } from '@/lib/utils'
import {
  isSetLoad,
  isSetResult,
  loadUnitLabel,
  resultLabel,
  type WorkoutLoadUnit,
} from '@shared/workoutLog'
import { parseBandCount, parseBandLabel } from '@shared/workoutInput'

import { parsePrescription } from './workoutPlan'
import type { WorkoutBand, WorkoutLoad, WorkoutSet } from './workoutApi'
import { setKey, type SetKey } from './useWorkoutLog'

/**
 * The expected sets of one exercise, inside its accordion panel.
 *
 * Every set exists from the moment the workout is started, so the list is the
 * workout's shape, not just what happened to be logged. A set is pending until
 * it is resolved either way:
 *
 *   pending   → editable, with Complete and Skip
 *   completed → success state showing exactly what was stored, with Undo
 *   skipped   → a distinct neutral/amber state that must never read as success
 *
 * Load is shown only where the snapshot says load applies, and always with its
 * stored meaning — "kg each" is per dumbbell, never a combined weight.
 *
 * Round 16 adds ONE thing to this: where derived guidance has a load to
 * suggest, a pending row offers "Use suggestion", which types that number into
 * the DRAFT load field. It is an explicit action and nothing more — the field
 * is still empty on render, the number is still editable, and only pressing
 * Complete records anything. A suggestion never becomes history on its own.
 */

export type WorkoutSetListProps = {
  sets: WorkoutSet[]
  busySet: SetKey | null
  /**
   * A load derived guidance can suggest for this exercise, or null.
   *
   * Offered, never applied: it reaches an input only through an explicit tap.
   */
  suggestedLoad?: WorkoutLoad | null
  /**
   * True while the guidance behind that suggestion has not been confirmed
   * against the workout as it now stands.
   *
   * The button stays on screen — removing it would move the controls under the
   * user's finger — but it cannot be used, because the history it was derived
   * from has changed and the answer is being recomputed.
   */
  suggestionLocked?: boolean
  onComplete: (
    exerciseOrder: number,
    setIndex: number,
    entry: { result: number; load: WorkoutLoad | null; band: WorkoutBand | null },
  ) => void
  onSkip: (exerciseOrder: number, setIndex: number) => void
  onUndo: (exerciseOrder: number, setIndex: number) => void
}

export function WorkoutSetList({
  sets,
  busySet,
  suggestedLoad = null,
  suggestionLocked = false,
  onComplete,
  onSkip,
  onUndo,
}: WorkoutSetListProps) {
  if (sets.length === 0) return null

  return (
    <ol className="mt-4 flex flex-col gap-2.5">
      {sets.map((set) => (
        <WorkoutSetRow
          key={setKey(set.exerciseOrder, set.setIndex)}
          set={set}
          busy={busySet === setKey(set.exerciseOrder, set.setIndex)}
          // Any mutation anywhere locks the others, so a second submit cannot
          // start while one is in flight.
          locked={busySet !== null}
          suggestedLoad={suggestedLoad}
          suggestionLocked={suggestionLocked}
          onComplete={onComplete}
          onSkip={onSkip}
          onUndo={onUndo}
        />
      ))}
    </ol>
  )
}

function WorkoutSetRow({
  set,
  busy,
  locked,
  suggestedLoad,
  suggestionLocked,
  onComplete,
  onSkip,
  onUndo,
}: {
  set: WorkoutSet
  busy: boolean
  locked: boolean
  suggestedLoad: WorkoutLoad | null
  suggestionLocked: boolean
} & Pick<WorkoutSetListProps, 'onComplete' | 'onSkip' | 'onUndo'>) {
  const fieldId = useId()
  // Never prefilled: a default number would be a value the user did not do.
  const [loadInput, setLoadInput] = useState('')
  const [bandLabelInput, setBandLabelInput] = useState('')
  const [bandCountInput, setBandCountInput] = useState('')
  const [resultInput, setResultInput] = useState('')

  const label = `Set ${set.setIndex + 1}`
  // WHICH CONTROL THIS SET GETS IS DECIDED BY THE FROZEN SNAPSHOT.
  //
  // Not by the exercise's current setting, and not by its name. A workout begun
  // as kilograms keeps its kilogram field even if the user switches that
  // exercise to bands mid-session, because that is what they are actually doing
  // right now.
  const isBand = set.inputType === 'resistance_band'
  const isKilograms = set.inputType === 'weight_kg'
  // A modality the client cannot name. Logging is refused rather than guessed —
  // recording reps against the wrong kind of resistance is how the bad data
  // this round exists to fix got there in the first place.
  const unreadable = set.inputType === null
  const takesLoad = isKilograms && set.loadMode !== 'none'
  const unit = takesLoad ? (set.loadMode as WorkoutLoadUnit) : null
  const target = parsePrescription(set.prescription)?.target ?? ''

  const resultValue = Number(resultInput.trim())
  const resultValid = resultInput.trim() !== '' && isSetResult(resultValue)
  const loadTrimmed = loadInput.trim()
  const loadValue = Number(loadTrimmed)
  const loadValid = loadTrimmed === '' || isSetLoad(loadValue)

  const bandLabel = parseBandLabel(bandLabelInput)
  const bandCountTrimmed = bandCountInput.trim()
  const bandCount = parseBandCount(Number(bandCountTrimmed))
  const bandLabelValid = bandLabelInput.trim() === '' || bandLabel !== null
  const bandCountValid = bandCountTrimmed === '' || bandCount !== null
  // A completed band set must say WHICH band and how many. Half an answer is
  // not a smaller record, it is an unreadable one.
  const bandComplete = bandLabel !== null && bandCount !== null

  const canComplete =
    resultValid &&
    loadValid &&
    !locked &&
    !unreadable &&
    (!isBand || bandComplete)

  // Offered only where it means the same thing as this set's own load field.
  // A kg suggestion must never land in a per-dumbbell input, and never in a
  // band set at all.
  const offered =
    takesLoad && suggestedLoad && unit && suggestedLoad.unit === unit ? suggestedLoad : null

  function handleComplete() {
    if (!canComplete) return
    onComplete(set.exerciseOrder, set.setIndex, {
      result: resultValue,
      // Exactly one kind of resistance travels, chosen by the frozen modality.
      // A payload carrying both is refused by the server; it is not built here.
      load: unit && loadTrimmed !== '' ? { value: loadValue, unit } : null,
      band: isBand && bandLabel !== null && bandCount !== null
        ? { label: bandLabel, count: bandCount }
        : null,
    })
  }

  if (set.status !== 'pending') {
    return (
      <ResolvedSetRow
        set={set}
        label={label}
        busy={busy}
        locked={locked}
        onUndo={onUndo}
      />
    )
  }

  return (
    <li
      className={cn(
        'rounded-control border border-edge bg-surface-overlay/60 p-3',
        busy && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <p className="min-w-14 text-[13px] font-bold text-ink-dim">{label}</p>

        {isBand && (
          <>
            <div className="min-w-0">
              <Field
                id={`${fieldId}-band-label`}
                label="Band"
                value={bandLabelInput}
                onChange={setBandLabelInput}
                placeholder="e.g. Black"
                invalid={!bandLabelValid}
                wide
              />
            </div>
            <div className="min-w-0">
              <Field
                id={`${fieldId}-band-count`}
                label="How many"
                value={bandCountInput}
                onChange={setBandCountInput}
                inputMode="numeric"
                placeholder="—"
                invalid={!bandCountValid}
              />
            </div>
          </>
        )}

        {takesLoad && unit && (
          <div className="min-w-0">
            <Field
              id={`${fieldId}-load`}
              label={`Load (${loadUnitLabel(unit)})`}
              value={loadInput}
              onChange={setLoadInput}
              inputMode="decimal"
              placeholder="—"
              invalid={!loadValid}
            />
            {offered && (
              <button
                type="button"
                onClick={() => setLoadInput(String(offered.value))}
                disabled={locked || suggestionLocked}
                className="mt-1.5 inline-flex items-center gap-1 rounded-control border border-edge-strong px-2 py-1 text-[11px] font-bold text-ink-faint transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Wand2 className="size-3" aria-hidden="true" />
                {`Use ${offered.value}${loadUnitLabel(offered.unit)}`}
              </button>
            )}
          </div>
        )}

        <Field
          id={`${fieldId}-result`}
          label={resultLabel(set.resultKind, set.perSide)}
          value={resultInput}
          onChange={setResultInput}
          inputMode="numeric"
          placeholder={target || '—'}
          invalid={resultInput.trim() !== '' && !resultValid}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleComplete}
            disabled={!canComplete}
            className="inline-flex items-center gap-1.5 rounded-control bg-blue px-3.5 py-2 text-[13px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            Complete
          </button>

          <button
            type="button"
            onClick={() => onSkip(set.exerciseOrder, set.setIndex)}
            disabled={locked}
            className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SkipForward className="size-4" aria-hidden="true" />
            Skip
          </button>
        </div>
      </div>

      {unreadable && (
        <p className="mt-2 text-[12px] font-semibold text-late">
          This set’s input type could not be read, so it cannot be logged. Nothing
          is assumed about how it was loaded.
        </p>
      )}

      {busy && (
        <p role="status" className="mt-2 text-[12px] font-semibold text-ink-faint">
          Saving…
        </p>
      )}
    </li>
  )
}

/** A completed or skipped set: what was stored, plus a way back to pending. */
function ResolvedSetRow({
  set,
  label,
  busy,
  locked,
  onUndo,
}: {
  set: WorkoutSet
  label: string
  busy: boolean
  locked: boolean
  onUndo: (exerciseOrder: number, setIndex: number) => void
}) {
  const completed = set.status === 'completed'

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border p-3',
        completed
          ? 'border-completed/40 bg-completed/10'
          : 'border-late/40 bg-late/10',
        busy && 'opacity-70',
      )}
    >
      <p className="min-w-14 text-[13px] font-bold text-ink-dim">{label}</p>

      <p
        className={cn(
          'min-w-0 flex-1 text-[13px] font-bold',
          completed ? 'text-completed' : 'text-late',
        )}
      >
        {completed ? `Completed · ${describeResult(set)}` : 'Skipped'}
      </p>

      <button
        type="button"
        onClick={() => onUndo(set.exerciseOrder, set.setIndex)}
        disabled={locked}
        aria-label={`Undo ${label}`}
        className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3 py-1.5 text-[12px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="size-3.5" aria-hidden="true" />
        )}
        Undo
      </button>
    </li>
  )
}

/**
 * "12 reps · 20kg each", or "12 reps · Black ×3" — exactly what was stored.
 *
 * The band is named and counted, never converted. This is the line that used to
 * read "12 reps · 3kg" for three black bands, because the count had been stored
 * in the weight column and the unit was appended unconditionally.
 */
function describeResult(set: WorkoutSet): string {
  if (set.result === null) return '—'
  const unitWord = set.resultKind === 'seconds' ? 's' : ' reps'
  const perSide = set.resultKind === 'reps' && set.perSide ? ' / side' : ''
  const result = `${set.result}${unitWord}${perSide}`
  if (set.band) return `${result} · ${set.band.label} ×${set.band.count}`
  if (!set.load) return result
  return `${result} · ${set.load.value}${loadUnitLabel(set.load.unit)}`
}

function Field({
  id,
  label,
  value,
  onChange,
  // Text by default: a band is named, not measured, so it is the one field
  // here that does not want a numeric keypad.
  inputMode = 'text',
  placeholder,
  invalid,
  wide = false,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  inputMode?: 'numeric' | 'decimal' | 'text'
  placeholder: string
  invalid: boolean
  wide?: boolean
}) {
  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="block text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint"
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        className={cn(
          'mt-1 rounded-control border bg-surface px-2.5 py-1.5 text-[15px] font-bold text-offwhite outline-offset-[-2px]',
          // A band label is a word, not a two-digit number.
          wide ? 'w-32' : 'w-20',
          invalid ? 'border-coral' : 'border-edge-strong',
        )}
      />
    </div>
  )
}
