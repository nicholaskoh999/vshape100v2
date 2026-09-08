import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Badge, IntensityBadge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Banner, Skeleton } from '@/components/ui/Feedback'
import { Field, PillTabs } from '@/components/ui/Field'
import { Card, PageHeader, SectionHeader } from '@/components/ui/Layout'
import { cn } from '@/lib/utils'
import {
  FOUNDATION_SESSION_META,
  MAX_TARGET,
  MIN_TARGET,
  PROGRAMME_SESSION_IDS,
  compactPositions,
  formatPrescription,
  validateProgramme,
  type ProgrammeIssue,
  type ProgrammeSessionId,
  type ProgrammeSessions,
  type ProgrammeSlot,
} from '@shared/programme/programme'
import { MAX_EQUIPMENT_LENGTH, MAX_SETS_PER_EXERCISE } from '@shared/workoutLog'

import {
  ProgrammeConflictError,
  saveProgramme,
  toSaveSessions,
  type ProgrammeView,
} from './programmeApi'
import { useProgramme } from './programmeContext'

/**
 * THE PROGRAMME, EDITED THE WAY IT IS LIVED: A WEEK AT A TIME.
 *
 * Round 24 (Q3, approved). Before this screen existed, editing the training
 * week meant Settings → Exercise Library → pick an exercise → scroll past its
 * media form → find the card that says which weekdays that exercise appears on.
 * That editor could tell you "Lat Pulldown is step 3 of 6 on Monday"; it could
 * not show you Monday. Building Monday's order meant opening six separate
 * exercise pages.
 *
 * The axis is inverted here — weekday first, then its ordered exercises, then
 * one focused editor for a single prescription. The MODEL is unchanged.
 *
 * WHAT IS PRESERVED, EXACTLY.
 *
 *   ONE ALL-OR-NOTHING WRITE. The save states the entire desired programme on
 *   the revision it was read at. A rename that lands while a Friday slot fails
 *   would leave the user's week in a state they never asked for and cannot see.
 *
 *   COMPARE-AND-SWAP, NEVER AUTO-OVERWRITE. On a conflict the user's edits stay
 *   on screen and the newer programme is offered. They choose.
 *
 *   EXPLICIT MOVE UP / MOVE DOWN, NOT DRAG-AND-DROP. These lists are edited on
 *   a phone, in a gym, and a keyboard user must be able to reorder them at all.
 *   Each button names the exercise AND the day.
 *
 *   POSITIONS ARE REWRITTEN FROM ARRAY ORDER, the same rule the server applies,
 *   so what is shown and what is stored cannot disagree.
 *
 *   IDENTITY DOES NOT MOVE. Nothing here touches an `exerciseId` — the key that
 *   holds media, input type, personal bests and every historical workout row.
 *   Renaming and archiving stay in the Exercise Library, which owns identity.
 */

type Draft = { sessions: ProgrammeSessions }

function draftFrom(programme: ProgrammeView): Draft {
  return { sessions: toSaveSessions(programme) }
}

export function ProgrammePage() {
  const { status, programme, adopt, reload } = useProgramme()
  const [day, setDay] = useState<ProgrammeSessionId>('monday')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<'idle' | 'saved' | 'conflict' | 'error'>('idle')

  const base = programme ? draftFrom(programme) : null
  const current = draft ?? base

  const dirty = useMemo(
    () => (base && current ? JSON.stringify(base) !== JSON.stringify(current) : false),
    [base, current],
  )

  const issues = useMemo<ProgrammeIssue[]>(() => {
    if (!programme || !current) return []
    return validateProgramme({
      revision: programme.revision,
      exercises: programme.exercises,
      sessions: current.sessions,
    })
  }, [programme, current])

  if (status === 'loading') {
    return (
      <>
        <BackToSettings />
        <PageHeader eyebrow="Settings" title="Programme" subline="Reading your training week." />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-11 rounded-full" />
          <Skeleton className="h-24 rounded-card" />
          <Skeleton className="h-24 rounded-card" />
          <Skeleton className="h-24 rounded-card" />
        </div>
      </>
    )
  }

  if (status === 'error' || !programme || !current) {
    return (
      <>
        <BackToSettings />
        <PageHeader
          eyebrow="Settings"
          title="Programme"
          subline="Your training week could not be read."
        />
        <Banner
          tone="danger"
          live="alert"
          title="Your programme could not be loaded"
          actions={
            <Button size="sm" onClick={reload}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          }
        >
          Nothing is being guessed at, so no week is shown and nothing can be saved until it
          can be read. Nothing has been lost.
        </Banner>
      </>
    )
  }

  const nameOf = (exerciseId: string) =>
    programme.exercises.find((exercise) => exercise.exerciseId === exerciseId)?.name ??
    exerciseId

  const meta = FOUNDATION_SESSION_META[day]
  const slots = current.sessions[day]
  const dayIssues = issues.filter(
    (issue) => 'sessionId' in issue && issue.sessionId === day,
  )

  function update(sessions: ProgrammeSessions) {
    setDraft({ sessions })
    setFeedback('idle')
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...slots]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    // Positions are rewritten from array order — the same rule the server
    // applies — so what is shown and what is stored cannot disagree.
    update({ ...current!.sessions, [day]: compactPositions(next) })
  }

  function patch(exerciseId: string, changes: Partial<ProgrammeSlot>) {
    update({
      ...current!.sessions,
      [day]: slots.map((slot) =>
        slot.exerciseId === exerciseId ? { ...slot, ...changes } : slot,
      ),
    })
  }

  function remove(exerciseId: string) {
    update({
      ...current!.sessions,
      [day]: compactPositions(slots.filter((slot) => slot.exerciseId !== exerciseId)),
    })
    setEditing(null)
  }

  async function commit() {
    setBusy(true)
    setFeedback('idle')
    try {
      const saved = await saveProgramme({
        expectedRevision: programme!.revision,
        exercises: programme!.exercises,
        sessions: current!.sessions,
      })
      adopt(saved)
      setDraft(null)
      setEditing(null)
      setFeedback('saved')
    } catch (failure: unknown) {
      if (failure instanceof ProgrammeConflictError) {
        // Never auto-overwrite. The user is told what happened and offered the
        // latest; their own edits stay on screen until they choose.
        setFeedback('conflict')
        return
      }
      console.error('Programme save failed', failure)
      setFeedback('error')
    } finally {
      setBusy(false)
    }
  }

  const canSave = !busy && dirty && issues.length === 0

  return (
    <>
      <BackToSettings />
      <PageHeader
        eyebrow={`Settings · Revision ${programme.revision}`}
        title="Programme"
        subline="Your Monday–Friday training week"
        actions={
          dirty ? (
            <Badge tone="late">Unsaved changes</Badge>
          ) : feedback === 'saved' ? (
            <Badge tone="done" icon={Check}>
              All changes saved
            </Badge>
          ) : undefined
        }
      />

      <PillTabs
        label="Weekday"
        value={day}
        onChange={(next) => {
          setDay(next)
          setEditing(null)
        }}
        options={PROGRAMME_SESSION_IDS.map((id) => ({
          value: id,
          label: `${FOUNDATION_SESSION_META[id].day.slice(0, 3)} · ${current.sessions[id].length}`,
        }))}
        className="mb-5"
      />

      <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-start xl:gap-6">
        <div>
          <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[19px] font-bold tracking-[-0.01em] text-ink">{meta.day}</h2>
              <p className="mt-0.5 text-[13.5px] text-ink-2">{meta.focus}</p>
            </div>
            <IntensityBadge intensity={meta.intensity} />
          </div>

          {dayIssues.length > 0 && (
            <div className="mb-3.5 flex flex-col gap-2">
              {dayIssues.map((issue, index) => (
                <Banner
                  key={`${issue.code}-${index}`}
                  tone="warn"
                  live="alert"
                  title={describeIssue(issue, nameOf)}
                >
                  This cannot be saved until it is resolved.
                </Banner>
              ))}
            </div>
          )}

          <ol className="flex flex-col gap-2.5">
            {slots.map((slot, index) => (
              <li key={slot.exerciseId}>
                <SlotCard
                  slot={slot}
                  name={nameOf(slot.exerciseId)}
                  day={meta.day}
                  index={index}
                  total={slots.length}
                  open={editing === slot.exerciseId}
                  onOpen={() =>
                    setEditing(editing === slot.exerciseId ? null : slot.exerciseId)
                  }
                  onMove={(direction) => move(index, direction)}
                  onPatch={(changes) => patch(slot.exerciseId, changes)}
                  onRemove={() => remove(slot.exerciseId)}
                />
              </li>
            ))}
          </ol>

          {slots.length === 0 && (
            <Banner tone="warn" live="alert" title={`${meta.day} has no exercises`}>
              A weekday with nothing in it cannot be started, so it cannot be saved. Add an
              exercise from the Exercise Library.
            </Banner>
          )}

          <Link
            to="/settings/exercises"
            className="mt-3 flex min-h-tap w-full items-center justify-center gap-2 rounded-control border border-dashed border-line-strong bg-surface text-sm font-bold text-ink no-underline transition-colors duration-fast hover:border-ink-4"
          >
            <Plus className="size-4.5" aria-hidden="true" />
            Add an exercise to {meta.day}
          </Link>
          <p className="mt-2 px-1 text-xs text-ink-3">
            Exercises are created and named in the Exercise Library, which owns their
            identity. This screen arranges which day each one sits on.
          </p>

          <p className="mt-4 px-1 text-xs text-ink-3">
            Ordering uses Move up and Move down rather than drag-and-drop: these lists are
            edited on a phone, in a gym, and a keyboard user must be able to reorder them at
            all.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <SaveBar
            dirty={dirty}
            busy={busy}
            canSave={canSave}
            feedback={feedback}
            onSave={() => void commit()}
            onDiscard={() => {
              setDraft(null)
              setEditing(null)
              setFeedback('idle')
            }}
            onReload={reload}
          />

          <section aria-label="Week at a glance">
            <SectionHeader title="Week at a glance" className="mt-0" />
            <Card flush>
              <ul className="divide-y divide-line">
                {PROGRAMME_SESSION_IDS.map((id) => {
                  const dayMeta = FOUNDATION_SESSION_META[id]
                  const count = current.sessions[id].length
                  const sets = current.sessions[id].reduce(
                    (sum, slot) => sum + slot.setCount,
                    0,
                  )
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDay(id)
                          setEditing(null)
                        }}
                        className={cn(
                          'flex min-h-tap w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-soft',
                          id === day && 'bg-accent-soft',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold text-ink">
                            {dayMeta.day}
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-ink-2">
                            {dayMeta.focus}
                          </span>
                        </span>
                        <IntensityBadge intensity={dayMeta.intensity} />
                        <span className="shrink-0 text-[13px] font-semibold text-ink-2">
                          {count === 0 ? 'empty' : `${sets} sets`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Card>
            <p className="mt-2.5 px-1 text-xs text-ink-3">
              Day names, focus and intensity are fixed Foundation identities. This screen
              arranges what is <i>in</i> each day.
            </p>
          </section>

          <Banner tone="info" title="Editing never changes a workout you already started">
            A started workout keeps the snapshot it was started with, so a reorder here can
            never attach your logged sets to a different exercise.
          </Banner>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* One slot                                                            */
/* ------------------------------------------------------------------ */

/**
 * One exercise's place in one weekday.
 *
 * The row is a row. The editor opens BELOW it, focused on a single
 * prescription, rather than every field for every day being expanded at once —
 * which is what made the old card twenty inline controls deep.
 */
function SlotCard({
  slot,
  name,
  day,
  index,
  total,
  open,
  onOpen,
  onMove,
  onPatch,
  onRemove,
}: {
  slot: ProgrammeSlot
  name: string
  day: string
  index: number
  total: number
  open: boolean
  onOpen: () => void
  onMove: (direction: -1 | 1) => void
  onPatch: (changes: Partial<ProgrammeSlot>) => void
  onRemove: () => void
}) {
  return (
    <Card className={cn('p-4', open && 'border-2 border-accent-edge')}>
      <div className="flex flex-wrap items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-[12px] text-[13px] font-bold',
            open ? 'border border-accent-edge bg-accent text-ink' : 'bg-surface-soft text-ink-2',
          )}
        >
          {index + 1}
        </span>

        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <p className="text-[15px] font-semibold text-ink">{name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone="outline">
              {formatPrescription(slot)}
            </Badge>
            {slot.equipment && <Badge tone="neutral">{slot.equipment}</Badge>}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <IconButton
            label={`Move ${name} up in ${day}`}
            onClick={() => onMove(-1)}
            disabled={index === 0}
          >
            <ArrowUp className="size-4.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Move ${name} down in ${day}`}
            onClick={() => onMove(1)}
            disabled={index === total - 1}
          >
            <ArrowDown className="size-4.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Edit ${name} on ${day}`}
            onClick={onOpen}
            aria-expanded={open}
            className={open ? 'border-accent-edge' : undefined}
          >
            <Pencil className="size-4.5" aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-3 text-xs font-semibold text-ink-2">{day} prescription</p>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id={`sets-${slot.exerciseId}`}
              label="Sets"
              value={slot.setCount}
              min={1}
              max={MAX_SETS_PER_EXERCISE}
              onCommit={(value) => onPatch({ setCount: value })}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-semibold text-ink-2">Records</span>
              <PillTabs
                label="What this exercise records"
                value={slot.resultKind}
                onChange={(next) => onPatch({ resultKind: next })}
                options={[
                  { value: 'reps' as const, label: 'Reps' },
                  { value: 'seconds' as const, label: 'Seconds' },
                ]}
              />
            </div>
            <NumberField
              id={`min-${slot.exerciseId}`}
              label="Target from"
              value={slot.targetMin}
              min={MIN_TARGET}
              max={MAX_TARGET}
              onCommit={(value) => onPatch({ targetMin: value })}
            />
            <NumberField
              id={`max-${slot.exerciseId}`}
              label="Target to"
              value={slot.targetMax}
              min={MIN_TARGET}
              max={MAX_TARGET}
              onCommit={(value) => onPatch({ targetMax: value })}
            />
          </div>

          <Field
            id={`equipment-${slot.exerciseId}`}
            label="Equipment note (optional)"
            value={slot.equipment ?? ''}
            onChange={(value) =>
              onPatch({ equipment: value.trim() === '' ? null : value.slice(0, MAX_EQUIPMENT_LENGTH) })
            }
            className="mt-3"
          />

          <label className="mt-4 flex min-h-tap cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={slot.perSide}
              onChange={(event) => onPatch({ perSide: event.target.checked })}
              className="size-5 accent-accent-edge"
            />
            <span className="text-[13.5px] font-semibold text-ink-2">
              Per side — records as “10 reps / side”, never doubled
            </span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={onOpen}>
              <Check className="size-4" aria-hidden="true" />
              Done
            </Button>
            <Button
              variant="danger"
              className="ml-auto"
              onClick={onRemove}
              aria-label={`Remove ${name} from ${day}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Remove
            </Button>
          </div>
          <p className="mt-2.5 text-xs text-ink-3">
            Removing it from {day} does not delete the exercise or any workout you have
            already logged. It only stops appearing in future {day} workouts.
          </p>
        </div>
      )}
    </Card>
  )
}

/**
 * A bounded whole number.
 *
 * The draft is local text, committed on blur. The old editor bound
 * `Number(value)` straight through, so clearing the box snapped the value to 0
 * and flashed a red error on every keystroke of a two-digit number — on a phone
 * the only way to change 10 to 15 was select-all-then-type.
 */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value)
  const parsed = Number(shown.trim())
  const valid =
    shown.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-ink-2">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={shown}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (valid) onCommit(parsed)
          setDraft(null)
        }}
        aria-invalid={!valid || undefined}
        className={cn(
          'min-h-tap w-full min-w-0 rounded-field border bg-surface px-3 text-base font-semibold text-ink outline-offset-[-2px]',
          valid ? 'border-line-control' : 'border-2 border-danger-ink',
        )}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

function SaveBar({
  dirty,
  busy,
  canSave,
  feedback,
  onSave,
  onDiscard,
  onReload,
}: {
  dirty: boolean
  busy: boolean
  canSave: boolean
  feedback: 'idle' | 'saved' | 'conflict' | 'error'
  onSave: () => void
  onDiscard: () => void
  onReload: () => void
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] font-bold text-ink">
          {dirty ? 'Unsaved changes' : 'Your week is saved'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>
              Discard
            </Button>
          )}
          <Button variant="primary" onClick={onSave} disabled={!canSave} aria-busy={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            Save programme
          </Button>
        </div>
      </div>

      <p className="mt-2.5 text-xs text-ink-3">
        One all-or-nothing write on the revision you loaded. Either the whole week is saved,
        or none of it is.
      </p>

      {feedback === 'saved' && (
        <p role="status" className="mt-3 text-[13px] font-semibold text-success-ink">
          Saved. Your training week is updated.
        </p>
      )}

      {feedback === 'conflict' && (
        <Banner
          tone="danger"
          live="alert"
          className="mt-3"
          title="Your programme changed somewhere else"
          actions={
            <Button size="sm" onClick={onReload}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Show the newer version
            </Button>
          }
        >
          Nothing was overwritten and your edits are still on screen. Review the newer
          version, then decide.
        </Banner>
      )}

      {feedback === 'error' && (
        <Banner
          tone="danger"
          live="alert"
          className="mt-3"
          title="Your programme could not be saved"
          actions={
            <Button size="sm" onClick={onSave}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </Button>
          }
        >
          Nothing was written. Your edits are still on screen.
        </Banner>
      )}
    </Card>
  )
}

function describeIssue(issue: ProgrammeIssue, nameOf: (id: string) => string): string {
  switch (issue.code) {
    case 'session_empty':
      return `${FOUNDATION_SESSION_META[issue.sessionId].day} would have no exercises. A training day cannot be empty.`
    case 'session_too_long':
      return `${FOUNDATION_SESSION_META[issue.sessionId].day} has too many exercises.`
    case 'slot_set_count_invalid':
      return `${nameOf(issue.exerciseId)}: sets must be between 1 and ${MAX_SETS_PER_EXERCISE}.`
    case 'slot_target_invalid':
      return `${nameOf(issue.exerciseId)}: the target range needs a lower number first, and both must be positive.`
    case 'slot_equipment_invalid':
      return `${nameOf(issue.exerciseId)}: equipment text is too long (${MAX_EQUIPMENT_LENGTH} characters at most).`
    case 'slot_exercise_archived':
      return `${nameOf(issue.exerciseId)} is archived, and an archived exercise cannot hold a place in a future workout.`
    case 'occurrence_too_many_sets':
      return `${FOUNDATION_SESSION_META[issue.sessionId].day} would have too many sets to log in one workout.`
    default:
      return 'These changes cannot be saved yet.'
  }
}

function BackToSettings() {
  return (
    <Link
      to="/settings"
      className="mb-3 inline-flex min-h-tap items-center gap-1.5 rounded-control text-[13px] font-semibold text-ink-2 no-underline transition-colors duration-fast hover:text-ink"
    >
      <ChevronRight className="size-4 rotate-180" aria-hidden="true" />
      Settings
    </Link>
  )
}
