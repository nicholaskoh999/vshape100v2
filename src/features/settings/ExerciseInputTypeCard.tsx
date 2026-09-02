import { Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { press } from '@/design/motion'
import { saveExerciseInputType } from '@/features/training/exerciseInputTypeApi'
import { useExerciseInputType } from '@/features/training/useExerciseInputType'
import { suggestedInputType } from '@/features/training/workoutPlan'
import { cn } from '@/lib/utils'
import {
  WORKOUT_INPUT_TYPE_DESCRIPTIONS,
  WORKOUT_INPUT_TYPE_LABELS,
  WORKOUT_INPUT_TYPES,
  type WorkoutInputType,
} from '@shared/workoutInput'

/**
 * Settings → Exercise Library → editor: how this exercise is loaded.
 *
 * THE ONE PLACE THIS IS DECIDED, AND THE USER DECIDES IT.
 *
 * The app used to answer it itself, from the exercise's name and equipment
 * text, and every answer it could give was kilograms. So a Triceps Pushdown
 * performed with three black bands was stored and displayed as "3 kg × 12
 * reps" — the count of bands written into the weight column. Triceps Pushdown
 * carries no equipment text at all, so no amount of better pattern-matching
 * would have caught it: text describes a plan, and it does not know what is in
 * somebody's gym. So the question is asked, once, per exercise.
 *
 * IT IS CANONICAL. One answer covers every day the exercise is trained, and
 * every Extra copied from any of them.
 *
 * IT IS A SETTING, NOT HISTORY. Saving it changes what the NEXT Start freezes.
 * A workout already underway keeps the modality it began with, and every set
 * already recorded keeps exactly what it recorded — including the old rows that
 * now read wrongly. Rewriting those would replace one inaccurate history with a
 * guessed one, so nothing here touches them.
 *
 * IT MUST BE REPAIRABLE. If the stored setting cannot be read, this is the
 * screen the user is sent to, and it has to let them fix it. The app never
 * repairs it on their behalf — it does not know what they meant, and guessing
 * is the failure this whole round exists to remove — but it must not tell them
 * to set it again and then disable every choice. So `unreadable` enables the
 * selector with its own wording, while a genuine load FAILURE still disables
 * it: one is knowledge about the data, the other is ignorance of it.
 */

type Feedback =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; message: string }

export function ExerciseInputTypeCard({
  exerciseId,
  name,
}: {
  exerciseId: string
  name: string
}) {
  const setting = useExerciseInputType(exerciseId)
  const [feedback, setFeedback] = useState<Feedback>({ state: 'idle' })

  // A mutation in flight. A ref so the double-submit guard is decided
  // synchronously inside the handler, the same rule the media editor uses.
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)

  const saved = setting.record?.inputType ?? null
  const unreadable = setting.status === 'unreadable'
  // Choosing is allowed whenever we KNOW the state of the stored setting —
  // including when we know it is unreadable, which is the case the user has
  // been sent here to fix. It is refused only while loading, and after a
  // failure that leaves us unable to say what is stored at all.
  const canChoose = setting.status === 'ready' || unreadable

  // Only ever a hint, and only while nothing is saved. It comes from the
  // programme text, which is evidence about what the author intended and not
  // about the user's equipment — so it is offered, never applied.
  //
  // Deliberately absent when the stored setting is unreadable: the user HAS
  // answered, and putting the programme's guess in front of them would present
  // their deliberate choice as though it had never been made.
  const suggestion = saved === null && !unreadable ? suggestedInputType(exerciseId) : null

  async function choose(next: WorkoutInputType) {
    if (inFlight.current || !canChoose) return
    // Re-picking the value already stored is a no-op — except when the stored
    // value is unreadable, where picking anything is the whole point.
    if (next === saved && !unreadable) return
    inFlight.current = true
    setBusy(true)
    setFeedback({ state: 'saving' })

    try {
      const persisted = await saveExerciseInputType(exerciseId, next)
      // Adopt what the server confirmed, never the value that was sent.
      setting.adopt(persisted)
      setFeedback({ state: 'saved' })
    } catch (error: unknown) {
      console.error('Exercise input type could not be saved', error)
      setFeedback({
        state: 'error',
        message: 'Could not save the input type. Nothing was changed.',
      })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-extrabold tracking-tight text-offwhite">
          How is this loaded?
        </h2>
        <p className="mt-1 text-[13px] text-ink-faint">
          Applies to {name} on every day it is trained. Changing it affects future
          workouts only — sets you have already recorded are never altered.
        </p>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="flex min-h-5 items-center gap-2 text-[13px]"
      >
        {setting.status === 'loading' && (
          <span className="flex items-center gap-2 text-ink-faint">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading input type
          </span>
        )}
        {setting.status === 'error' && (
          <>
            <span className="text-coral">The saved input type could not be loaded.</span>
            <button
              type="button"
              onClick={setting.reload}
              className="rounded-control font-bold text-blue underline-offset-2 hover:underline"
            >
              Retry
            </button>
          </>
        )}
        {unreadable && feedback.state === 'idle' && (
          <span className="text-coral">
            Saved input type could not be read. Choose the correct type to replace it.
          </span>
        )}
        {canChoose && feedback.state === 'saving' && (
          <span className="flex items-center gap-2 text-ink-faint">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Saving
          </span>
        )}
        {canChoose && feedback.state === 'saved' && (
          <span className="font-semibold text-completed">Saved.</span>
        )}
        {canChoose && feedback.state === 'error' && (
          <span className="text-coral">{feedback.message}</span>
        )}
        {setting.status === 'ready' && feedback.state === 'idle' && saved === null && (
          <span className="text-ink-faint">
            Not set yet — this exercise still records the way it always has.
          </span>
        )}
      </div>

      <fieldset className="min-w-0" disabled={!canChoose}>
        <legend className="sr-only">Input type</legend>
        <div
          role="radiogroup"
          aria-label="Input type"
          className="flex flex-col gap-2"
        >
          {WORKOUT_INPUT_TYPES.map((option) => (
            <motion.button
              {...press}
              key={option}
              type="button"
              role="radio"
              aria-checked={saved === option}
              disabled={busy || !canChoose}
              onClick={() => void choose(option)}
              className={cn(
                'rounded-control border px-4 py-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
                saved === option
                  ? 'border-blue bg-blue/15'
                  : 'border-edge bg-surface-overlay hover:border-edge-strong',
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'text-sm font-bold',
                    saved === option ? 'text-offwhite' : 'text-ink-dim',
                  )}
                >
                  {WORKOUT_INPUT_TYPE_LABELS[option]}
                </span>
                {suggestion === option && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-ink-faint">
                    Suggested
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-[12px] text-ink-faint">
                {WORKOUT_INPUT_TYPE_DESCRIPTIONS[option]}
              </span>
            </motion.button>
          ))}
        </div>
      </fieldset>
    </Card>
  )
}
