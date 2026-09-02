import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Card } from '@/components/ui/Card'
import { useProgramme } from '@/features/programme/programmeContext'
import {
  ProgrammeConflictError,
  createCustomExercise,
} from '@/features/programme/programmeApi'
import { cn } from '@/lib/utils'
import {
  WORKOUT_INPUT_TYPES,
  WORKOUT_INPUT_TYPE_LABELS,
  type WorkoutInputType,
} from '@shared/workoutInput'
import { MAX_EXERCISE_NAME_LENGTH } from '@shared/workoutLog'

/**
 * Adding an exercise of your own.
 *
 * TWO THINGS ARE REQUIRED, AND BOTH FOR THE SAME REASON.
 *
 * A name, obviously. And an input type — because an exercise with no stated
 * modality cannot be started, and creating one would hand the user a library
 * entry that quietly fails later. The server writes both in ONE transaction,
 * so a created exercise always has the modality it needs.
 *
 * The id is minted by the server and never chosen here. An id is identity: it
 * keys media, input type and every workout row that will ever mention this
 * exercise, and a client that could pick one could collide with a Foundation
 * exercise and inherit its history.
 *
 * A new exercise joins the library with NO weekday. That is a normal state,
 * not an unfinished one — the user puts it on the days they want from its own
 * settings page, which is where weekdays are chosen for every other exercise
 * too.
 */
export function AddExerciseCard() {
  const { programme, adopt, reload } = useProgramme()
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [inputType, setInputType] = useState<WorkoutInputType | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  const trimmed = name.trim()
  const canSave =
    !busy && trimmed.length > 0 && trimmed.length <= MAX_EXERCISE_NAME_LENGTH && inputType !== null

  function close() {
    setOpen(false)
    setName('')
    setInputType(null)
    setError(null)
    setConflict(false)
  }

  async function save() {
    if (!canSave || !programme || !inputType) return
    setBusy(true)
    setError(null)
    setConflict(false)
    try {
      const outcome = await createCustomExercise({
        name: trimmed,
        inputType,
        expectedRevision: programme.revision,
      })
      adopt(outcome.programme)
      close()
      // Straight to its settings, which is where weekdays and prescriptions
      // are chosen. Creating an exercise and then having to find it again
      // would be a worse ending than the one this flow can give.
      void navigate(`/settings/exercises/${outcome.exerciseId}`)
    } catch (failure: unknown) {
      if (failure instanceof ProgrammeConflictError) {
        setConflict(true)
        return
      }
      console.error('Custom exercise could not be created', failure)
      setError('Could not add this exercise. Nothing was created.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-add-exercise="closed"
        className="mt-4 flex w-full items-center gap-3 rounded-card border border-dashed border-edge px-4.5 py-4 text-left transition-colors duration-150 hover:border-edge-strong"
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-overlay text-ink-dim"
        >
          <Plus className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold tracking-tight text-offwhite">
            Add exercise
          </span>
          <span className="mt-0.5 block text-[13px] text-ink-faint">
            One of your own, with its own name and input type
          </span>
        </span>
      </button>
    )
  }

  return (
    <Card className="mt-4 p-4.5" data-add-exercise="open">
      <h2 className="text-sm font-extrabold tracking-tight text-offwhite">Add exercise</h2>
      <p className="mt-0.5 text-[13px] text-ink-faint">
        It joins your library straight away. You choose which weekdays it belongs
        to next.
      </p>

      <div className="mt-3.5">
        <label
          htmlFor="new-exercise-name"
          className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint"
        >
          Name
        </label>
        <input
          id="new-exercise-name"
          type="text"
          value={name}
          maxLength={MAX_EXERCISE_NAME_LENGTH}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Cable Crossover"
          className="mt-1 w-full rounded-control border border-edge bg-surface-overlay px-3 py-2 text-sm font-bold text-offwhite outline-none focus-visible:border-blue"
        />
      </div>

      <fieldset className="mt-3.5">
        <legend className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
          Input type
        </legend>
        <div role="radiogroup" aria-label="Input type" className="mt-1 flex flex-wrap gap-1.5">
          {WORKOUT_INPUT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={inputType === type}
              disabled={busy}
              onClick={() => setInputType(type)}
              className={cn(
                'rounded-control border px-2.5 py-1 text-[12px] font-bold transition-colors duration-150',
                inputType === type
                  ? 'border-blue bg-blue/15 text-offwhite'
                  : 'border-edge-strong text-ink-dim hover:text-offwhite',
              )}
            >
              {WORKOUT_INPUT_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-ink-faint">
          Required: it decides what this exercise records, and it is frozen into
          every workout you start with it.
        </p>
      </fieldset>

      {conflict && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-coral">
          Your programme changed in another tab. Nothing was created.{' '}
          <button
            type="button"
            onClick={reload}
            className="rounded-control font-bold text-blue underline-offset-2 hover:underline"
          >
            Reload latest
          </button>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-coral">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded-control bg-blue px-3 py-1.5 text-[12px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          Add exercise
        </button>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="rounded-control px-3 py-1.5 text-[12px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </Card>
  )
}
