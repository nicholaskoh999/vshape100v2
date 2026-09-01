import { CalendarDays, Check, Loader2, RefreshCw } from 'lucide-react'
import { useId, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { foundationLabel, foundationStatus } from '@/features/progress/foundation'
import { localWorkoutDate } from '@/features/training/workoutPlan'
import { isLocalDate } from '@shared/localDate'
import { DEFAULT_FOUNDATION_START } from '@shared/settings'

import { useFoundationStart } from './FoundationStartContext'

/**
 * Foundation Start Date — the account's Day 1.
 *
 * Round 18 turned a source constant into something the user owns. Changing it
 * renumbers Foundation days and milestones and NOTHING else: the Monday–Friday
 * programme, Today's Gym item, Holiday, reminders and Extra Workout identity
 * are all unaffected, and no recorded history is touched. The card says so,
 * because a date field that silently reshuffled training would be alarming.
 *
 * Every state is distinct and honest:
 *
 *   loading  — the saved date is not known yet, so nothing is offered to edit
 *   error    — the read failed; say so and offer a retry rather than showing
 *              the default as though it were the account's choice
 *   ready    — the field holds the persisted date, or the default when none
 *              was ever chosen, and says which of the two it is
 *   saving   — the control is busy and cannot be submitted twice
 *   saved    — briefly confirms the write the SERVER acknowledged
 *   failed   — the previously confirmed date stays on screen and authoritative
 */
export function FoundationStartCard() {
  const foundation = useFoundationStart()
  const inputId = useId()
  const helpId = useId()

  // The draft the user is editing. Seeded from persisted truth once it arrives,
  // and re-seeded whenever that truth changes — including after a save, so the
  // field shows what was actually STORED rather than what was typed.
  const [draft, setDraft] = useState('')
  const [touched, setTouched] = useState(false)
  const [seeded, setSeeded] = useState<string | null>(null)

  // Adjusted during render rather than in an effect. React supports exactly
  // this for "derive state from what we just learned": it re-runs this
  // component before anything is committed, so there is no flash of an empty
  // field, and no cascading-render effect.
  const seed = foundation.status === 'ready' ? (foundation.persisted ?? foundation.startDate) : null
  if (seed !== null && seed !== seeded) {
    setSeeded(seed)
    setDraft(seed)
    setTouched(false)
  }

  const valid = isLocalDate(draft)
  const changed = draft !== (foundation.persisted ?? foundation.startDate)
  // Rejected client-side before the request, and again by the server. An
  // impossible date such as 2026-02-30 fails `isLocalDate`, which a shape-only
  // check would let through.
  const showInvalid = touched && draft !== '' && !valid

  const preview = valid ? foundationStatus(localWorkoutDate(), draft) : null

  return (
    <Card className="px-5 py-4">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-overlay text-ink-dim"
        >
          <CalendarDays className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-offwhite">Foundation Start Date</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-faint">
            Day 1 of your Foundation 100. This changes day numbers and milestones
            only — your training week, Holidays, reminders and recorded workouts
            stay exactly as they are.
          </p>

          {foundation.status === 'loading' && (
            <p
              role="status"
              className="mt-3.5 flex items-center gap-2 text-[13px] font-semibold text-ink-dim"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading your start date…
            </p>
          )}

          {foundation.status === 'error' && (
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
              <p role="alert" className="text-[13px] font-semibold text-coral">
                Could not load your start date. Nothing has been changed.
              </p>
              <button
                type="button"
                onClick={foundation.reload}
                className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Try again
              </button>
            </div>
          )}

          {foundation.status === 'ready' && (
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (!valid || foundation.saving) return
                void foundation.save(draft)
              }}
            >
              <label
                htmlFor={inputId}
                className="block text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint"
              >
                Day 1
              </label>

              <div className="mt-1.5 flex flex-wrap items-start gap-3">
                <div className="min-w-0">
                  <input
                    id={inputId}
                    type="date"
                    value={draft}
                    aria-describedby={helpId}
                    aria-invalid={showInvalid}
                    disabled={foundation.saving}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      setTouched(true)
                    }}
                    className="w-44 rounded-control border border-edge-strong bg-surface px-3 py-2 text-[15px] font-bold text-offwhite outline-offset-2 disabled:opacity-50 aria-[invalid=true]:border-coral"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!valid || !changed || foundation.saving}
                  aria-busy={foundation.saving}
                  className="inline-flex items-center gap-1.5 rounded-control bg-blue px-4 py-2.5 text-[13px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {foundation.saving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="size-4" aria-hidden="true" />
                  )}
                  {foundation.saving ? 'Saving…' : 'Save start date'}
                </button>
              </div>

              <p id={helpId} className="mt-2 text-[12px] leading-relaxed text-ink-faint">
                {foundation.persisted === null
                  ? `No date saved yet — counting from ${DEFAULT_FOUNDATION_START}.`
                  : `Saved: ${foundation.persisted}.`}
                {preview ? ` Today would be ${foundationLabel(preview)}.` : ''}
              </p>

              {/* Not colour alone: the invalid, failed and saved states each
                  carry their own words and an icon or role. */}
              {showInvalid && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-coral">
                  That is not a real calendar date. Pick a valid day.
                </p>
              )}

              {foundation.saveError && (
                <p role="alert" className="mt-2 text-[13px] font-semibold text-coral">
                  {foundation.saveError}
                </p>
              )}

              {foundation.saved && !foundation.saveError && !changed && (
                <p
                  role="status"
                  className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-lime"
                >
                  <Check className="size-4" aria-hidden="true" />
                  Start date saved.
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </Card>
  )
}
