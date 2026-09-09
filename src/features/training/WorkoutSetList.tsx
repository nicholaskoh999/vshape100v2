import { Check, Loader2, RotateCcw, SkipForward, Wand2 } from 'lucide-react'
import { useId, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Banner } from '@/components/ui/Feedback'
import { Field, Stepper } from '@/components/ui/Field'
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
 *
 * ROUND 24 — WHAT CHANGED, AND WHAT DID NOT.
 *
 * What changed is the ergonomics. This used to be a `flex-wrap` row of ~30px
 * text inputs with a ~34px Complete beside them, repeated identically for every
 * set — pressed one-handed, standing, in a gym. Now:
 *
 *   - the FIRST unresolved set is promoted to a current-set card, so "which set
 *     am I on" is answered by the layout rather than by scanning colours
 *   - every numeric value gets a 56px stepper beside a 56px field
 *   - Complete is a full-width 56px primary; Skip is plainly secondary
 *   - a refused set states its refusal in a banner, not in a caption
 *
 * What did NOT change is the contract. Every pending set still owns its own
 * labelled inputs and its own Complete, because logging out of order is
 * legitimate; the field is still never prefilled; and the modality still comes
 * from the frozen snapshot.
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

  // The set the user is on: the first one still unresolved. Nothing else about
  // it is special — it is promoted visually, not privileged functionally.
  const currentIndex = sets.findIndex((set) => set.status === 'pending')

  return (
    <ol className="mt-4 flex flex-col gap-2.5">
      {sets.map((set, index) => (
        <WorkoutSetRow
          key={setKey(set.exerciseOrder, set.setIndex)}
          set={set}
          current={index === currentIndex}
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
  current,
  busy,
  locked,
  suggestedLoad,
  suggestionLocked,
  onComplete,
  onSkip,
  onUndo,
}: {
  set: WorkoutSet
  current: boolean
  busy: boolean
  locked: boolean
  suggestedLoad: WorkoutLoad | null
  suggestionLocked: boolean
} & Pick<WorkoutSetListProps, 'onComplete' | 'onSkip' | 'onUndo'>) {
  const label = `Set ${set.setIndex + 1}`

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
        'vs-bordered rounded-control border bg-surface p-4',
        current ? 'border-2 border-accent-edge' : 'border-line',
        busy && 'opacity-70',
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-bold text-ink">{label}</p>
        {current && <Badge tone="current">Current set</Badge>}
      </div>

      <PendingSetControls
        set={set}
        busy={busy}
        locked={locked}
        suggestedLoad={suggestedLoad}
        suggestionLocked={suggestionLocked}
        onComplete={onComplete}
        onSkip={onSkip}
      />

      {busy && (
        <p role="status" className="mt-2.5 text-xs font-semibold text-ink-2">
          Saving…
        </p>
      )}
    </li>
  )
}

/**
 * THE CONTROLS ONE PENDING SET GETS — the single implementation.
 *
 * Round 24 correction. Focused workout mode needs exactly these controls, and
 * a second copy of them would be a second answer to the only question that
 * actually matters here: what does this set's FROZEN modality allow to be
 * recorded? A drifted copy is how "12 reps · 3kg" got written for three black
 * bands. So both surfaces render this, and neither can decide differently:
 *
 *   - which control appears is read from `set.inputType` / `set.loadMode`,
 *     which come from the snapshot the workout was started with
 *   - a band set has NO kilogram field, and its band is a label and a count
 *   - a bodyweight set has no load field at all
 *   - "kg each" says per dumbbell, in the label and again in the hint
 *   - nothing is ever prefilled, and exactly one kind of resistance travels
 *   - an unreadable modality refuses to log rather than guessing
 *
 * The two surfaces differ only in the wrapper: the accordion lays the actions
 * out inline, focused mode pins them to the bottom of the phone.
 */
export function PendingSetControls({
  set,
  busy,
  locked,
  suggestedLoad = null,
  suggestionLocked = false,
  completeLabel = 'Complete',
  actionsClassName,
  onComplete,
  onSkip,
}: {
  set: WorkoutSet
  busy: boolean
  locked: boolean
  suggestedLoad?: WorkoutLoad | null
  suggestionLocked?: boolean
  /** Focused mode names the action in full; the accordion keeps it short. */
  completeLabel?: string
  /** Lets focused mode pin the action row to the bottom of the viewport. */
  actionsClassName?: string
  onComplete: WorkoutSetListProps['onComplete']
  onSkip: WorkoutSetListProps['onSkip']
}) {
  const fieldId = useId()
  // Never prefilled: a default number would be a value the user did not do.
  const [loadInput, setLoadInput] = useState('')
  const [bandLabelInput, setBandLabelInput] = useState('')
  const [bandCountInput, setBandCountInput] = useState('')
  const [resultInput, setResultInput] = useState('')

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

  const resultIsTime = set.resultKind === 'seconds'

  return (
    <>
      {unreadable && (
        <Banner tone="warn" live="alert" className="mb-3" title="This set cannot be logged">
          This set’s input type could not be read, so it cannot be logged. Nothing is assumed
          about how it was loaded.
        </Banner>
      )}

      <div className="flex flex-col gap-3.5">
        {isBand && (
          <div className="grid grid-cols-2 gap-3">
            <Field
              id={`${fieldId}-band-label`}
              label="Band"
              value={bandLabelInput}
              onChange={setBandLabelInput}
              placeholder="e.g. Black"
              invalid={!bandLabelValid}
              disabled={unreadable}
            />
            <Field
              id={`${fieldId}-band-count`}
              label="How many"
              value={bandCountInput}
              onChange={setBandCountInput}
              inputMode="numeric"
              placeholder="—"
              invalid={!bandCountValid}
              disabled={unreadable}
            />
          </div>
        )}

        {takesLoad && unit && (
          <div>
            <Stepper
              id={`${fieldId}-load`}
              label={`Load (${loadUnitLabel(unit)})`}
              value={loadInput}
              onChange={setLoadInput}
              inputMode="decimal"
              placeholder="—"
              // 2.5 kg is the smallest plate step most home setups have. The
              // typed value remains the authority; this is only an input aid.
              step={2.5}
              from={2.5}
              decimals={1}
              invalid={!loadValid}
              error="Enter a load between 0 and 1000."
              disabled={unreadable}
              hint={
                unit === 'kg_each'
                  ? 'Per dumbbell — never a combined weight.'
                  : undefined
              }
            />
            {offered && (
              <Button
                size="sm"
                onClick={() => setLoadInput(String(offered.value))}
                disabled={locked || suggestionLocked}
                className="mt-2"
              >
                <Wand2 className="size-3.5" aria-hidden="true" />
                {`Use ${offered.value}${loadUnitLabel(offered.unit)}`}
              </Button>
            )}
          </div>
        )}

        <Stepper
          id={`${fieldId}-result`}
          label={resultLabel(set.resultKind, set.perSide)}
          value={resultInput}
          onChange={setResultInput}
          inputMode="numeric"
          placeholder={target || '—'}
          step={resultIsTime ? 5 : 1}
          from={resultIsTime ? 30 : 8}
          invalid={resultInput.trim() !== '' && !resultValid}
          error="Enter a whole number above zero."
          disabled={unreadable}
        />

        <div className={cn('flex items-center gap-2.5', actionsClassName)}>
          <Button
            variant="primary"
            size="lg"
            onClick={handleComplete}
            disabled={!canComplete}
            aria-busy={busy}
            className="flex-1"
          >
            {busy ? (
              <Loader2 className="size-[18px] animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-[18px]" aria-hidden="true" />
            )}
            {completeLabel}
          </Button>

          <Button size="lg" onClick={() => onSkip(set.exerciseOrder, set.setIndex)} disabled={locked}>
            <SkipForward className="size-[18px]" aria-hidden="true" />
            Skip
          </Button>
        </div>
      </div>
    </>
  )
}

/** A completed or skipped set: what was stored, plus a way back to pending. */
export function ResolvedSetRow({
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
        'vs-bordered flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border p-3.5',
        completed
          ? 'border-success-ink/30 bg-success-soft'
          : 'border-warn-ink/30 bg-warn-soft',
        busy && 'opacity-70',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-[10px] text-xs font-bold text-white',
          completed ? 'bg-success-ink' : 'bg-warn-ink',
        )}
      >
        {set.setIndex + 1}
      </span>

      <p className="min-w-14 text-[13px] font-bold text-ink-2">{label}</p>

      <p
        className={cn(
          'min-w-0 flex-1 text-[13.5px] font-bold',
          completed ? 'text-success-ink' : 'text-warn-ink',
        )}
      >
        {completed ? `Completed · ${describeResult(set)}` : 'Skipped'}
        {/* A skip is never a smaller success. It says what it is. */}
        {!completed && (
          <span className="block text-xs font-semibold">Not a completed set</span>
        )}
      </p>

      <Button
        size="sm"
        onClick={() => onUndo(set.exerciseOrder, set.setIndex)}
        disabled={locked}
        aria-label={`Undo ${label}`}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="size-3.5" aria-hidden="true" />
        )}
        Undo
      </Button>
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
