import { CalendarCheck, Dumbbell, Gamepad2, Loader2, Moon, RefreshCw } from 'lucide-react'
import { motion } from 'motion/react'

import { Card } from '@/components/ui/Card'
import { press } from '@/design/motion'
import { cn } from '@/lib/utils'
import {
  TRAINING_FLEX_DESCRIPTIONS,
  TRAINING_FLEX_LABELS,
  type TrainingFlexKind,
} from '@shared/trainingFlex'

import type { TrainingFlexState } from '../useTrainingFlex'

/**
 * Today's training choice.
 *
 * Shown only on a day that actually PLANS a strength session — there is nothing
 * to flex away from on a weekend or a Holiday with training off, and offering
 * the choice there would be clutter that implies a session exists.
 *
 * Three options, presented as one row of choices rather than a menu, because
 * the decision is small and the page is already dense:
 *
 *   scheduled workout  — the default; selecting it CLEARS the day's choice
 *   Recovery today     — deliberate rest
 *   Fitness Boxing 2   — the one named alternative activity
 *
 * The card states the consequence plainly, because the honest answer is the
 * reassuring one: choosing recovery is not a missed day and does not break the
 * streak. Nothing here records a workout.
 */

const OPTION_ICONS = {
  scheduled: Dumbbell,
  recovery: Moon,
  fitness_boxing_2: Gamepad2,
} as const

type Option = {
  value: TrainingFlexKind | null
  label: string
  description: string
  icon: (typeof OPTION_ICONS)[keyof typeof OPTION_ICONS]
}

const OPTIONS: Option[] = [
  {
    value: null,
    label: 'Do scheduled workout',
    description: "Today's Foundation session, as planned.",
    icon: OPTION_ICONS.scheduled,
  },
  {
    value: 'recovery',
    label: TRAINING_FLEX_LABELS.recovery,
    description: TRAINING_FLEX_DESCRIPTIONS.recovery,
    icon: OPTION_ICONS.recovery,
  },
  {
    value: 'fitness_boxing_2',
    label: TRAINING_FLEX_LABELS.fitness_boxing_2,
    description: TRAINING_FLEX_DESCRIPTIONS.fitness_boxing_2,
    icon: OPTION_ICONS.fitness_boxing_2,
  },
]

export function TrainingFlexCard({ flex }: { flex: TrainingFlexState }) {
  const { status, choice, saving, saveError } = flex

  return (
    <Card className="p-5">
      {/* Card does not forward extra props, so the markers live here. */}
      <div data-training-flex data-training-flex-state={status} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
            Today&rsquo;s training
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-faint">
            Not up for the session? Say so — it is not a missed day.
          </p>
        </div>
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-overlay text-ink-faint"
        >
          <CalendarCheck className="size-5" />
        </span>
      </div>

      {status === 'loading' && (
        <p
          role="status"
          className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-ink-dim"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading today&rsquo;s choice…
        </p>
      )}

      {status === 'error' && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-[13px] font-semibold text-coral">
            Could not load today&rsquo;s choice.
          </p>
          <button
            type="button"
            onClick={flex.reload}
            className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {status === 'ready' && (
        <>
          <div
            role="radiogroup"
            aria-label="Today's training choice"
            className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3"
          >
            {OPTIONS.map((option) => {
              const active = choice === option.value
              const Icon = option.icon
              return (
                <motion.button
                  key={option.label}
                  {...press}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  // A save in flight blocks a second one; the guard is also
                  // enforced in the hook, so a fast double tap cannot write twice.
                  disabled={saving}
                  onClick={() => {
                    if (active) return
                    void flex.choose(option.value)
                  }}
                  className={cn(
                    'flex min-h-11 flex-col items-start gap-1 rounded-control border p-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
                    active
                      ? 'border-blue bg-blue/12 text-offwhite'
                      : 'border-edge-strong text-ink-dim hover:border-edge-strong hover:text-offwhite',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="text-[13px] font-bold">{option.label}</span>
                  </span>
                  <span className="text-[12px] leading-snug text-ink-faint">
                    {option.description}
                  </span>
                </motion.button>
              )
            })}
          </div>

          <p role="status" className="mt-3 text-[12px] font-semibold text-ink-faint">
            {saving ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Saving…
              </span>
            ) : choice === null ? (
              'Today is the scheduled Foundation session.'
            ) : (
              // The confirmed choice, and the consequence, stated together.
              `Today is ${TRAINING_FLEX_LABELS[choice]}. No strength session is expected, and your streak is unaffected.`
            )}
          </p>

          {saveError && (
            <p role="alert" className="mt-2 text-[13px] font-semibold text-coral">
              {saveError}
            </p>
          )}
        </>
      )}
    </Card>
  )
}
