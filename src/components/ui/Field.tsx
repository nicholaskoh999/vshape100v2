import { Minus, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useId } from 'react'

import { cn } from '@/lib/utils'
import { IconButton } from './Button'

/**
 * Text and numeric input.
 *
 * THREE RULES THAT ARE NOT COSMETIC:
 *
 * 1. The border is `line-control` (3.2:1), not the decorative hairline
 *    (1.6:1). A card's border is decoration — the white-on-canvas step already
 *    identifies it — but a field's border is the only thing that says "type
 *    here", so WCAG 1.4.11 applies to it and not to the card.
 *
 * 2. The font is 16px. Below that iOS zooms the page on focus, and a zoom
 *    mid-set is a real usability failure in a gym, not a cosmetic one.
 *
 * 3. Invalidity is never a hue change alone: `aria-invalid` plus a described
 *    message, and the border thickens as well as changing colour.
 */

export function Field({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  inputMode = 'text',
  placeholder,
  invalid = false,
  disabled = false,
  size = 'md',
  className,
  inputClassName,
  autoComplete = 'off',
}: {
  id: string
  label: string
  hint?: ReactNode
  /** Shown, and associated with the input, when `invalid`. */
  error?: string
  value: string
  onChange: (next: string) => void
  inputMode?: 'numeric' | 'decimal' | 'text'
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  /** `gym` is the 56px in-set control: bigger, centred, harder to miss. */
  size?: 'md' | 'gym'
  className?: string
  inputClassName?: string
  autoComplete?: string
}) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy =
    [invalid && error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-ink-2">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          'w-full min-w-0 rounded-field border bg-surface px-3 font-semibold text-ink outline-offset-[-2px] placeholder:font-medium placeholder:text-ink-4 disabled:cursor-not-allowed disabled:opacity-50',
          // 16px is the floor: anything smaller and iOS zooms on focus.
          size === 'gym'
            ? 'min-h-gym text-center text-[22px] font-bold'
            : 'min-h-tap text-base',
          invalid ? 'border-2 border-danger-ink' : 'border-line-control',
          inputClassName,
        )}
      />
      {hint && (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
      {invalid && error && (
        <p id={errorId} className="text-xs font-semibold text-danger-ink">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The in-gym numeric control: a 56px field between two 56px buttons.
 *
 * The stepper is an INPUT AID, never a claim. It edits the same draft string
 * the field does, and the typed value stays the authority — which is why the
 * field is still empty on render and a step from empty starts at `from`
 * rather than at zero.
 */
export function Stepper({
  id,
  label,
  hint,
  value,
  onChange,
  step,
  from,
  inputMode = 'numeric',
  placeholder,
  invalid = false,
  error,
  disabled = false,
  decimals = 0,
}: {
  id: string
  label: string
  hint?: ReactNode
  value: string
  onChange: (next: string) => void
  /** How much one press moves the value: 2.5 for kg, 1 for reps, 5 for seconds. */
  step: number
  /** Where a press starts from when the field is empty. */
  from: number
  inputMode?: 'numeric' | 'decimal'
  placeholder?: string
  invalid?: boolean
  error?: string
  disabled?: boolean
  decimals?: number
}) {
  function nudge(direction: 1 | -1) {
    const trimmed = value.trim()
    const current = trimmed === '' ? null : Number(trimmed)
    // An unreadable draft is left exactly as the user typed it: silently
    // replacing it with a number would discard what they were in the middle of.
    if (trimmed !== '' && !Number.isFinite(current)) return
    const next = current === null ? from : current + direction * step
    if (next < 0) return
    onChange(next.toFixed(decimals).replace(/\.0+$/, ''))
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-ink-2">
        {label}
      </label>
      <div className="flex min-w-0 items-stretch gap-2">
        <IconButton
          label={`Decrease ${label.toLowerCase()}`}
          onClick={() => nudge(-1)}
          disabled={disabled}
          className="h-gym w-12 shrink-0 rounded-field"
        >
          <Minus className="size-5" aria-hidden="true" />
        </IconButton>
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid && error ? `${id}-error` : undefined}
          className={cn(
            'min-h-gym w-full min-w-0 flex-1 rounded-field border bg-surface px-2 text-center text-[22px] font-bold text-ink outline-offset-[-2px] placeholder:text-[17px] placeholder:font-medium placeholder:text-ink-4 disabled:cursor-not-allowed disabled:opacity-50',
            invalid ? 'border-2 border-danger-ink' : 'border-line-control',
          )}
        />
        <IconButton
          label={`Increase ${label.toLowerCase()}`}
          onClick={() => nudge(1)}
          disabled={disabled}
          className="h-gym w-12 shrink-0 rounded-field"
        >
          <Plus className="size-5" aria-hidden="true" />
        </IconButton>
      </div>
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
      {invalid && error && (
        <p id={`${id}-error`} className="text-xs font-semibold text-danger-ink">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * A segmented control.
 *
 * The selected pill is an INK FILL with light text (14.9:1) rather than an
 * accent tint, so selection never competes with the page's one primary action.
 */
export function PillTabs<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T
  options: readonly { value: T; label: ReactNode }[]
  onChange: (next: T) => void
  className?: string
}) {
  const group = useId()
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface-soft p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={`${group}-${option.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-9 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-fast',
              selected
                ? 'on-fill bg-ink font-bold text-ink-on-dark'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
