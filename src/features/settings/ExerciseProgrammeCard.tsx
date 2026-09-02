import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Card } from '@/components/ui/Card'
import { useProgramme } from '@/features/programme/programmeContext'
import {
  ProgrammeConflictError,
  saveProgramme,
  toSaveSessions,
  type ProgrammeView,
} from '@/features/programme/programmeApi'
import { cn } from '@/lib/utils'
import {
  FOUNDATION_SESSION_META,
  MAX_TARGET,
  MIN_TARGET,
  PROGRAMME_SESSION_IDS,
  compactPositions,
  formatPrescription,
  validateProgramme,
  type ProgrammeSessionId,
  type ProgrammeSessions,
  type ProgrammeSlot,
} from '@shared/programme/programme'
import { MAX_EQUIPMENT_LENGTH, MAX_EXERCISE_NAME_LENGTH, MAX_SETS_PER_EXERCISE } from '@shared/workoutLog'

/**
 * ONE EXERCISE'S PLACE IN THE PROGRAMME.
 *
 * The name, the weekdays it is trained on, how each of those days prescribes
 * it, what order it comes in, and whether it is archived — all edited together
 * and saved as ONE all-or-nothing write.
 *
 * That is the point of the whole card. A rename that lands while a Friday slot
 * fails, or a Monday move that lands while Wednesday stays stale, would leave
 * the user's programme in a state they never asked for and cannot see. The save
 * states the entire desired programme on the revision it was read at, and the
 * server applies all of it or none of it.
 *
 * IDENTITY DOES NOT MOVE. Renaming rewrites one column. The exercise id — which
 * keys media, input type, personal bests and every workout row ever written —
 * is untouched, which is what lets somebody call `lat-pulldown` "Band Lat
 * Pulldown" without orphaning a single record.
 *
 * ORDERING WITHOUT DRAG. Move up and move down are buttons with real accessible
 * names. Drag-and-drop is not an acceptance requirement and would be the wrong
 * thing to reach for first: these are small lists, edited on a phone in a gym,
 * and a keyboard user must be able to reorder them at all.
 */

type Draft = {
  name: string
  archived: boolean
  sessions: ProgrammeSessions
}

function draftFrom(programme: ProgrammeView, exerciseId: string): Draft {
  const exercise = programme.exercises.find((e) => e.exerciseId === exerciseId)
  return {
    name: exercise?.name ?? '',
    archived: exercise?.archived ?? false,
    sessions: toSaveSessions(programme),
  }
}

/** A slot with the defaults a newly-added weekday starts from. */
function newSlot(exerciseId: string): ProgrammeSlot {
  return {
    exerciseId,
    position: 0,
    setCount: 3,
    resultKind: 'reps',
    targetMin: 10,
    targetMax: 15,
    perSide: false,
    equipment: null,
  }
}

export function ExerciseProgrammeCard({ exerciseId }: { exerciseId: string }) {
  const { programme, adopt, reload } = useProgramme()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<
    'idle' | 'saved' | 'conflict' | 'error'
  >('idle')
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  const base = programme ? draftFrom(programme, exerciseId) : null
  const current = draft ?? base

  const dirty = useMemo(
    () => (base && current ? JSON.stringify(base) !== JSON.stringify(current) : false),
    [base, current],
  )

  const issues = useMemo(() => {
    if (!programme || !current) return []
    return validateProgramme({
      revision: programme.revision,
      exercises: programme.exercises.map((exercise) =>
        exercise.exerciseId === exerciseId
          ? { ...exercise, name: current.name.trim(), archived: current.archived }
          : exercise,
      ),
      sessions: current.sessions,
    })
  }, [programme, current, exerciseId])

  if (!programme || !current) return null

  const nameValid =
    current.name.trim().length > 0 && current.name.trim().length <= MAX_EXERCISE_NAME_LENGTH
  const canSave = !busy && dirty && nameValid && issues.length === 0

  function update(next: Partial<Draft>) {
    setDraft({ ...(current as Draft), ...next })
    setFeedback('idle')
  }

  function slotFor(sessionId: ProgrammeSessionId): ProgrammeSlot | undefined {
    return current!.sessions[sessionId].find((slot) => slot.exerciseId === exerciseId)
  }

  function toggleWeekday(sessionId: ProgrammeSessionId, on: boolean) {
    const slots = current!.sessions[sessionId]
    const next = on
      ? [...slots, newSlot(exerciseId)]
      : slots.filter((slot) => slot.exerciseId !== exerciseId)
    update({
      sessions: { ...current!.sessions, [sessionId]: compactPositions(next) },
    })
  }

  function patchSlot(sessionId: ProgrammeSessionId, patch: Partial<ProgrammeSlot>) {
    update({
      sessions: {
        ...current!.sessions,
        [sessionId]: current!.sessions[sessionId].map((slot) =>
          slot.exerciseId === exerciseId ? { ...slot, ...patch } : slot,
        ),
      },
    })
  }

  function move(sessionId: ProgrammeSessionId, direction: -1 | 1) {
    const slots = [...current!.sessions[sessionId]]
    const index = slots.findIndex((slot) => slot.exerciseId === exerciseId)
    const target = index + direction
    if (index === -1 || target < 0 || target >= slots.length) return
    ;[slots[index], slots[target]] = [slots[target], slots[index]]
    // Positions are rewritten from array order — the same rule the server
    // applies — so what is shown and what is stored cannot disagree.
    update({ sessions: { ...current!.sessions, [sessionId]: compactPositions(slots) } })
  }

  async function commit(nextDraft: Draft) {
    setBusy(true)
    setFeedback('idle')
    try {
      const saved = await saveProgramme({
        expectedRevision: programme!.revision,
        exercises: programme!.exercises.map((exercise) =>
          exercise.exerciseId === exerciseId
            ? { ...exercise, name: nextDraft.name.trim(), archived: nextDraft.archived }
            : exercise,
        ),
        sessions: nextDraft.sessions,
      })
      adopt(saved)
      setDraft(null)
      setConfirmingArchive(false)
      setFeedback('saved')
    } catch (failure: unknown) {
      if (failure instanceof ProgrammeConflictError) {
        // Never auto-overwrite. The user is told what happened and offered the
        // latest; their own edits stay on screen until they choose.
        setFeedback('conflict')
        return
      }
      console.error('Programme could not be saved', failure)
      setFeedback('error')
    } finally {
      setBusy(false)
    }
  }

  /** Archiving also clears every future weekday, in the same write. */
  function archive() {
    const sessions = { ...current!.sessions }
    for (const sessionId of PROGRAMME_SESSION_IDS) {
      sessions[sessionId] = compactPositions(
        sessions[sessionId].filter((slot) => slot.exerciseId !== exerciseId),
      )
    }
    void commit({ ...current!, archived: true, sessions })
  }

  const archiveWouldEmpty = PROGRAMME_SESSION_IDS.some((sessionId) => {
    const slots = current.sessions[sessionId]
    return slots.length === 1 && slots[0].exerciseId === exerciseId
  })

  return (
    <Card className="flex flex-col gap-5 p-5" data-programme-card>
      {/* ---------------- name ---------------- */}
      <div>
        <label
          htmlFor="exercise-name"
          className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint"
        >
          Name
        </label>
        <input
          id="exercise-name"
          type="text"
          value={current.name}
          maxLength={MAX_EXERCISE_NAME_LENGTH}
          disabled={busy}
          onChange={(event) => update({ name: event.target.value })}
          className="mt-1 w-full rounded-control border border-edge bg-surface-overlay px-3 py-2 text-sm font-bold text-offwhite outline-none focus-visible:border-blue"
        />
        <p className="mt-1.5 text-[12px] text-ink-faint">
          Renaming changes what you see from now on. Your recorded history keeps
          the name it was performed under.
        </p>
      </div>

      {/* ---------------- weekdays ---------------- */}
      <fieldset className="min-w-0" disabled={busy || current.archived}>
        <legend className="mb-2 text-[13px] font-bold text-ink-dim">Programme</legend>
        {current.archived ? (
          <p className="text-[13px] text-ink-faint">
            Archived exercises hold no weekday. Restore it below to put it back
            into your week.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {PROGRAMME_SESSION_IDS.map((sessionId) => {
              const slot = slotFor(sessionId)
              const meta = FOUNDATION_SESSION_META[sessionId]
              const slots = current.sessions[sessionId]
              const index = slots.findIndex((s) => s.exerciseId === exerciseId)
              return (
                <li
                  key={sessionId}
                  data-weekday={sessionId}
                  className="rounded-control border border-edge bg-surface-overlay/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label className="flex items-center gap-2 text-[13px] font-bold text-offwhite">
                      <input
                        type="checkbox"
                        checked={slot !== undefined}
                        aria-label={`Train on ${meta.day}`}
                        onChange={(event) => toggleWeekday(sessionId, event.target.checked)}
                        className="size-4 accent-blue"
                      />
                      {meta.day}
                    </label>

                    {slot && (
                      <>
                        <span className="text-[12px] text-ink-faint">
                          {formatPrescription(slot)}
                        </span>
                        <span className="ml-auto flex items-center gap-1">
                          <span className="text-[11px] font-semibold text-ink-faint">
                            Step {index + 1} of {slots.length}
                          </span>
                          <button
                            type="button"
                            aria-label={`Move ${current.name || 'this exercise'} up on ${meta.day}`}
                            disabled={index <= 0}
                            onClick={() => move(sessionId, -1)}
                            className="rounded-control border border-edge-strong p-1 text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${current.name || 'this exercise'} down on ${meta.day}`}
                            disabled={index === -1 || index >= slots.length - 1}
                            onClick={() => move(sessionId, 1)}
                            className="rounded-control border border-edge-strong p-1 text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      </>
                    )}
                  </div>

                  {slot && (
                    <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      <Field
                        label="Sets"
                        id={`${sessionId}-sets`}
                        value={slot.setCount}
                        min={1}
                        max={MAX_SETS_PER_EXERCISE}
                        onChange={(value) => patchSlot(sessionId, { setCount: value })}
                      />
                      <Field
                        label={slot.resultKind === 'seconds' ? 'Seconds from' : 'Reps from'}
                        id={`${sessionId}-min`}
                        value={slot.targetMin}
                        min={MIN_TARGET}
                        max={MAX_TARGET}
                        onChange={(value) => patchSlot(sessionId, { targetMin: value })}
                      />
                      <Field
                        label="to"
                        id={`${sessionId}-max`}
                        value={slot.targetMax}
                        min={MIN_TARGET}
                        max={MAX_TARGET}
                        onChange={(value) => patchSlot(sessionId, { targetMax: value })}
                      />
                      <div>
                        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                          Measured in
                        </span>
                        <div
                          role="radiogroup"
                          aria-label={`How ${meta.day} is measured`}
                          className="mt-1 flex gap-1"
                        >
                          {(['reps', 'seconds'] as const).map((kind) => (
                            <button
                              key={kind}
                              type="button"
                              role="radio"
                              aria-checked={slot.resultKind === kind}
                              onClick={() => patchSlot(sessionId, { resultKind: kind })}
                              className={cn(
                                'rounded-control border px-2 py-1 text-[11px] font-bold',
                                slot.resultKind === kind
                                  ? 'border-blue bg-blue/15 text-offwhite'
                                  : 'border-edge-strong text-ink-dim',
                              )}
                            >
                              {kind === 'reps' ? 'Reps' : 'Seconds'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="col-span-2 flex items-center gap-2 text-[12px] font-semibold text-ink-dim">
                        <input
                          type="checkbox"
                          checked={slot.perSide}
                          aria-label={`Per side on ${meta.day}`}
                          onChange={(event) =>
                            patchSlot(sessionId, { perSide: event.target.checked })
                          }
                          className="size-3.5 accent-blue"
                        />
                        Per side
                      </label>

                      <div className="col-span-2">
                        <label
                          htmlFor={`${sessionId}-equipment`}
                          className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint"
                        >
                          Equipment
                        </label>
                        <input
                          id={`${sessionId}-equipment`}
                          type="text"
                          value={slot.equipment ?? ''}
                          maxLength={MAX_EQUIPMENT_LENGTH}
                          onChange={(event) =>
                            patchSlot(sessionId, {
                              equipment: event.target.value.trim() === '' ? null : event.target.value,
                            })
                          }
                          className="mt-1 w-full rounded-control border border-edge bg-surface px-2.5 py-1.5 text-[13px] text-offwhite outline-none focus-visible:border-blue"
                        />
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>

      {/* ---------------- status ---------------- */}
      {issues.length > 0 && (
        <p role="alert" className="text-[12px] font-semibold text-coral" data-programme-invalid>
          {describeIssue(issues[0])}
        </p>
      )}

      {feedback === 'conflict' && (
        <p role="alert" className="text-[12px] font-semibold text-coral" data-programme-conflict>
          Your programme changed in another tab. Reload the latest version before
          saving.{' '}
          <button
            type="button"
            onClick={reload}
            className="rounded-control font-bold text-blue underline-offset-2 hover:underline"
          >
            Reload latest
          </button>
        </p>
      )}

      {feedback === 'error' && (
        <p role="alert" className="text-[12px] font-semibold text-coral">
          Could not save. Nothing was changed.
        </p>
      )}

      {feedback === 'saved' && !dirty && (
        <p className="text-[12px] font-semibold text-completed" data-programme-saved>
          Saved.
        </p>
      )}

      {dirty && feedback !== 'conflict' && (
        <p className="text-[12px] font-semibold text-ink-faint" data-programme-dirty>
          Unsaved changes.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void commit(current)}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded-control bg-blue px-3 py-1.5 text-[12px] font-bold text-offwhite transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          Save changes
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setDraft(null)
              setFeedback('idle')
            }}
            disabled={busy}
            className="rounded-control px-3 py-1.5 text-[12px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
          >
            Discard
          </button>
        )}
      </div>

      {/* ---------------- lifecycle ---------------- */}
      <div className="border-t border-edge pt-4">
        {current.archived ? (
          <>
            <p className="text-[12px] text-ink-faint">
              Restoring makes it available again. It will not go back onto the
              weekdays it used to be on — you choose those again.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void commit({ ...current, archived: false })}
              className="mt-2 rounded-control border border-edge-strong px-2.5 py-1 text-[11px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
            >
              Restore exercise
            </button>
          </>
        ) : confirmingArchive ? (
          <div className="rounded-control border border-edge-strong bg-surface-overlay/60 p-2.5">
            <p className="text-[12px] font-bold text-offwhite">Archive this exercise?</p>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              It leaves every weekday from now on. Your recorded history, media
              and input type are all kept.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={archive}
                className="inline-flex items-center gap-1.5 rounded-control bg-coral px-2.5 py-1 text-[11px] font-bold text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
                Archive
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingArchive(false)}
                className="rounded-control px-2.5 py-1 text-[11px] font-bold text-ink-dim hover:text-offwhite"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || archiveWouldEmpty}
              onClick={() => setConfirmingArchive(true)}
              className="rounded-control border border-edge-strong px-2.5 py-1 text-[11px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite disabled:cursor-not-allowed disabled:opacity-40"
            >
              Archive exercise
            </button>
            {archiveWouldEmpty && (
              <p className="mt-1.5 text-[11px] text-ink-faint" data-archive-blocked>
                It is the only exercise left on a weekday. Add another to that day
                first — a training day cannot be empty.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

function Field({
  label,
  id,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  id: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-control border border-edge bg-surface px-2.5 py-1.5 text-[13px] font-bold text-offwhite outline-none focus-visible:border-blue"
      />
    </div>
  )
}

/** Say what is wrong in the user's terms, never in the validator's. */
function describeIssue(issue: ReturnType<typeof validateProgramme>[number]): string {
  switch (issue.code) {
    case 'session_empty':
      return `${FOUNDATION_SESSION_META[issue.sessionId].day} would have no exercises. A training day cannot be empty.`
    case 'slot_set_count_invalid':
      return `Sets must be between 1 and ${MAX_SETS_PER_EXERCISE}.`
    case 'slot_target_invalid':
      return 'The target range needs a lower number first, and both must be positive.'
    case 'slot_equipment_invalid':
      return `Equipment text is too long (${MAX_EQUIPMENT_LENGTH} characters at most).`
    case 'exercise_name_invalid':
      return `A name is required, and must be ${MAX_EXERCISE_NAME_LENGTH} characters or fewer.`
    case 'slot_exercise_archived':
      return 'An archived exercise cannot stay on a weekday.'
    default:
      return 'These changes cannot be saved yet.'
  }
}
