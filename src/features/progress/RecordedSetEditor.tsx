import { Loader2, PencilLine } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import {
  correctRecordedSet,
  fetchWorkout,
  type WorkoutSet,
} from '@/features/training/workoutApi'
import {
  WORKOUT_INPUT_TYPE_LABELS,
  WORKOUT_INPUT_TYPES,
  parseBandCount,
  parseBandLabel,
  type WorkoutInputType,
} from '@shared/workoutInput'
import { isSetLoad, isSetResult } from '@shared/workoutLog'

/**
 * Progress → Recent Workouts → a recorded workout → correcting one set.
 *
 * WHY THIS EXISTS.
 *
 * Recorded history can be factually wrong. The user's own Triceps Pushdown
 * sets say "3 kg × 12" because kilograms were the only resistance the app could
 * store; they were three black bands. Round 20 rightly refused to guess which
 * old rows to reinterpret, so this is the explicit path by which the user says
 * what that set actually was.
 *
 * WHAT IT CORRECTS: the measurement. The modality, the load, the band, the
 * result.
 *
 * WHAT IT NEVER TOUCHES: whether the training happened. A corrected set stays
 * completed, so completion counts, the streak and Achievements do not move.
 * The date, the session, the exercise and the set's place in it are not
 * editable here at all.
 *
 * It also submits the VERSION it read. If anything changed the set in between,
 * the server refuses rather than overwriting a change the user cannot see.
 */

type Feedback =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'unchanged' }
  | { state: 'stale' }
  | { state: 'error'; message: string }

/** The editable facts, as strings while the user is typing them. */
type Draft = {
  inputType: WorkoutInputType
  load: string
  unit: 'kg' | 'kg_each'
  bandLabel: string
  bandCount: string
  result: string
}

function draftFrom(set: WorkoutSet): Draft {
  return {
    // Prefilled from CURRENT persisted truth. An unreadable modality starts at
    // kilograms only as a starting point for the form; nothing is saved until
    // the user presses Save.
    inputType: set.inputType ?? 'weight_kg',
    load: set.load ? String(set.load.value) : '',
    unit: set.load?.unit === 'kg_each' ? 'kg_each' : 'kg',
    bandLabel: set.band?.label ?? '',
    bandCount: set.band ? String(set.band.count) : '',
    result: set.result === null ? '' : String(set.result),
  }
}

export function RecordedSetEditor({
  date,
  sessionId,
  set,
  onCorrected,
}: {
  date: string
  sessionId: string
  set: WorkoutSet
  /** Called with the corrected set so the list can show the new truth. */
  onCorrected: (next: WorkoutSet) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => draftFrom(set))
  const [feedback, setFeedback] = useState<Feedback>({ state: 'idle' })
  const [busy, setBusy] = useState(false)

  const isBand = draft.inputType === 'resistance_band'
  const isWeight = draft.inputType === 'weight_kg'

  const result = Number(draft.result.trim())
  const resultValid = draft.result.trim() !== '' && isSetResult(result)
  const load = Number(draft.load.trim())
  const loadValid = draft.load.trim() !== '' && isSetLoad(load)
  const bandLabel = parseBandLabel(draft.bandLabel)
  const bandCount = parseBandCount(Number(draft.bandCount.trim()))

  const canSave =
    !busy &&
    resultValid &&
    (isWeight ? loadValid : true) &&
    (isBand ? bandLabel !== null && bandCount !== null : true)

  function edit(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setFeedback({ state: 'idle' })
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setFeedback({ state: 'saving' })
    try {
      const outcome = await correctRecordedSet(date, sessionId, set.exerciseOrder, set.setIndex, {
        inputType: draft.inputType,
        load: isWeight ? { value: load, unit: draft.unit } : null,
        band: isBand && bandLabel !== null && bandCount !== null
          ? { label: bandLabel, count: bandCount }
          : null,
        result,
        // The version this editor actually read.
        expectedUpdatedAt: set.updatedAt,
      })

      if (!outcome.corrected) {
        // Nothing was written, because nothing differed. Saying so is more
        // honest than claiming a correction that did not happen.
        setFeedback({ state: 'unchanged' })
        return
      }
      if (outcome.set) {
        onCorrected(outcome.set)
        setDraft(draftFrom(outcome.set))
      }
      setFeedback({ state: 'saved' })
      setOpen(false)
    } catch (error: unknown) {
      console.error('Recorded set could not be corrected', error)
      const status = (error as { status?: number }).status
      if (status === 409) {
        // Somebody changed the set since this editor read it. Refuse, and go
        // and fetch the truth rather than overwriting it.
        setFeedback({ state: 'stale' })
        try {
          const log = await fetchWorkout(date, sessionId)
          const fresh = log.sets.find(
            (row) => row.exerciseOrder === set.exerciseOrder && row.setIndex === set.setIndex,
          )
          if (fresh) {
            onCorrected(fresh)
            setDraft(draftFrom(fresh))
          }
        } catch {
          // The refresh is a courtesy; the refusal above is the important part.
        }
        return
      }
      setFeedback({
        state: 'error',
        message: 'Could not save the correction. Nothing was changed.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(draftFrom(set))
          setFeedback({ state: 'idle' })
          setOpen(true)
        }}
        className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-2.5 py-1 text-[11px] font-bold text-ink-faint transition-colors duration-150 hover:text-offwhite"
      >
        <PencilLine className="size-3" aria-hidden="true" />
        Edit recorded set
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-control border border-edge-strong bg-surface-overlay/60 p-3">
      <p className="text-[12px] font-bold text-offwhite">
        Correct {set.exerciseName} · set {set.setIndex + 1}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        This corrects recorded performance. It does not change workout
        completion.
      </p>

      <fieldset className="mt-2.5" disabled={busy}>
        <legend className="sr-only">How this set was loaded</legend>
        <div role="radiogroup" aria-label="Recorded input type" className="flex flex-wrap gap-1.5">
          {WORKOUT_INPUT_TYPES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={draft.inputType === option}
              onClick={() => edit({ inputType: option })}
              className={cn(
                'rounded-control border px-2.5 py-1 text-[11px] font-bold transition-colors duration-150',
                draft.inputType === option
                  ? 'border-blue bg-blue/15 text-offwhite'
                  : 'border-edge bg-surface text-ink-dim hover:border-edge-strong',
              )}
            >
              {WORKOUT_INPUT_TYPE_LABELS[option]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
        {isWeight && (
          <>
            <Field
              label="Load"
              value={draft.load}
              onChange={(load) => edit({ load })}
              invalid={draft.load.trim() !== '' && !loadValid}
              disabled={busy}
            />
            <div className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                Unit
              </span>
              <div role="radiogroup" aria-label="Load unit" className="mt-1 flex gap-1.5">
                {(['kg', 'kg_each'] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    role="radio"
                    aria-checked={draft.unit === unit}
                    disabled={busy}
                    onClick={() => edit({ unit })}
                    className={cn(
                      'rounded-control border px-2 py-1 text-[11px] font-bold transition-colors duration-150',
                      draft.unit === unit
                        ? 'border-blue bg-blue/15 text-offwhite'
                        : 'border-edge bg-surface text-ink-dim',
                    )}
                  >
                    {/* kg_each is PER DUMBBELL and is written that way. */}
                    {unit === 'kg' ? 'kg' : 'kg each'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {isBand && (
          <>
            <Field
              label="Band"
              value={draft.bandLabel}
              onChange={(bandLabel) => edit({ bandLabel })}
              invalid={draft.bandLabel.trim() !== '' && bandLabel === null}
              disabled={busy}
              wide
            />
            <Field
              label="How many"
              value={draft.bandCount}
              onChange={(bandCount) => edit({ bandCount })}
              invalid={draft.bandCount.trim() !== '' && bandCount === null}
              disabled={busy}
            />
          </>
        )}

        <Field
          label={set.resultKind === 'seconds' ? 'Seconds' : 'Reps'}
          value={draft.result}
          onChange={(result) => edit({ result })}
          invalid={draft.result.trim() !== '' && !resultValid}
          disabled={busy}
        />
      </div>

      <div role="status" aria-live="polite" className="mt-2 min-h-4 text-[11px]">
        {feedback.state === 'saving' && <span className="text-ink-faint">Saving…</span>}
        {feedback.state === 'saved' && (
          <span className="font-semibold text-completed">Corrected.</span>
        )}
        {feedback.state === 'unchanged' && (
          <span className="text-ink-faint">
            That is already what this set records — nothing was changed.
          </span>
        )}
        {feedback.state === 'stale' && (
          <span className="text-coral">
            This set changed while you were editing. Nothing was overwritten —
            the current values are shown.
          </span>
        )}
        {feedback.state === 'error' && <span className="text-coral">{feedback.message}</span>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded-control bg-blue px-3 py-1.5 text-[12px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          Save correction
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-control px-3 py-1.5 text-[12px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  invalid,
  disabled,
  wide = false,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  invalid: boolean
  disabled: boolean
  wide?: boolean
}) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
        {label}
        <input
          type="text"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          className={cn(
            'mt-1 block rounded-control border bg-surface px-2 py-1 text-[13px] font-bold normal-case tracking-normal text-offwhite',
            wide ? 'w-28' : 'w-20',
            invalid ? 'border-coral' : 'border-edge-strong',
          )}
        />
      </label>
    </div>
  )
}
