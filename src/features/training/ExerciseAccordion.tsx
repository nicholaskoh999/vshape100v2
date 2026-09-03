import { ChevronDown, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Card'
import { listItemVariants, listVariants, press, tween } from '@/design/motion'
import { cn } from '@/lib/utils'
import { ExerciseGuidance } from './ExerciseGuidance'
import { exercisePath } from './navigation'
import type { LaneRecommendation, ProgressionLoad } from './progressionApi'
import type { LaneError } from './useProgression'
import type { SessionExercise, TrainingSession } from './sessions'
import type { WorkoutSet } from './workoutApi'
import { WorkoutSetList, type WorkoutSetListProps } from './WorkoutSetList'
import type { CalibrationFeedback } from '@shared/progression/lane'
import { WORKOUT_INPUT_TYPE_LABELS, type WorkoutInputType } from '@shared/workoutInput'
import type { ModalityVerdict } from './inputTypeMismatch'

/**
 * Everything the expanded panel needs to log sets. Absent until the workout
 * has been started, so the accordion stays exactly the accepted prescription
 * view until there is something real to log against.
 */
export type AccordionLogging = Pick<
  WorkoutSetListProps,
  'busySet' | 'onComplete' | 'onSkip' | 'onUndo'
> & {
  /** Every set of the workout, in performance order. */
  sets: WorkoutSet[]
}

/**
 * Derived next-session guidance, matched to a row by its position in THIS
 * session — the same `exercise_order` the sets are matched on, so guidance for
 * Monday's Lat Pulldown can never appear against Wednesday's.
 *
 * Absent until the server has answered. Guidance is subordinate to logging: an
 * exercise with none simply shows none.
 *
 * `confirmed` is false while a re-read triggered by a change to the workout is
 * still in flight. The panel stays put — nothing jumps mid-workout — but every
 * action it offers is withheld until the answer describes the workout as it
 * now stands.
 */
/**
 * Per-position modality verdict: a disagreement, an unverified answer, or null.
 *
 * Supplied by the page because it is the page that knows both halves: the
 * stored snapshot and how far the account's current settings have been read.
 */
export type AccordionModality = (exerciseOrder: number) => ModalityVerdict | null

export type AccordionGuidance = {
  laneFor: (exerciseOrder: number) => LaneRecommendation | null
  confirmed: boolean
  busyLane: number | null
  error: LaneError | null
  onFeedback: (
    exerciseOrder: number,
    feedback: CalibrationFeedback,
    chosenLoad: ProgressionLoad | null,
  ) => void
}

/**
 * The in-session exercise list.
 *
 * Rows start compact so the whole workout stays scannable, and activating one
 * expands it in place — no navigation just to look something up. Single-open
 * by design: opening a row closes whichever was open.
 *
 * Everything shown comes from the *session's own* entry
 * (`session.exercises[index]`). The same exercise appears on several days with
 * different prescriptions — Monday's Lat Pulldown is `4 × 10–15 · BAND 20kg`
 * while Thursday's is `4 × 10–15` with no equipment — so a slug lookup would
 * quietly show the wrong day's numbers.
 *
 * The same rule governs logging: sets are matched by their position in this
 * session (`exercise_order`), never by canonical slug, so Monday's Lat
 * Pulldown cannot pick up Wednesday's log.
 */
/**
 * The minimum this component actually reads.
 *
 * Round 17 renders an Extra Workout from its FROZEN stored snapshot rather
 * than from today's `trainingSessions`, so the list it is given is not always
 * an accepted Foundation session. Only the id and the exercises are ever used
 * here, so that is what is asked for — the header (day, focus, intensity) is
 * the page's business, not the list's.
 */
export type AccordionSession = Pick<TrainingSession, 'id' | 'exercises'>

export function ExerciseAccordion({
  session,
  logging,
  guidance,
  modalityAt,
}: {
  session: AccordionSession
  logging?: AccordionLogging
  guidance?: AccordionGuidance
  modalityAt?: AccordionModality
}) {
  // Local, deliberately ephemeral: nothing here needs to survive a refresh,
  // so there is no URL state and no storage.
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  return (
    <motion.ol
      variants={listVariants}
      initial="initial"
      animate="enter"
      className="flex flex-col gap-3"
    >
      {session.exercises.map((exercise, index) => (
        <ExerciseRow
          key={`${exercise.id}-${index}`}
          exercise={exercise}
          index={index}
          sessionId={session.id}
          expanded={expandedIndex === index}
          onToggle={() =>
            setExpandedIndex((current) => (current === index ? null : index))
          }
          logging={logging}
          guidance={guidance}
          modalityAt={modalityAt}
        />
      ))}
    </motion.ol>
  )
}

function ExerciseRow({
  exercise,
  index,
  sessionId,
  expanded,
  onToggle,
  logging,
  guidance,
  modalityAt,
}: {
  exercise: SessionExercise
  index: number
  sessionId: string
  expanded: boolean
  onToggle: () => void
  logging?: AccordionLogging
  guidance?: AccordionGuidance
  modalityAt?: AccordionModality
}) {
  const reduceMotion = useReducedMotion()
  // Unique per row: only one session renders at a time and `index` is unique
  // within it, so the same exercise twice in a day still gets distinct ids.
  const triggerId = `exercise-trigger-${sessionId}-${index}`
  const panelId = `exercise-panel-${sessionId}-${index}`

  const summary = `${exercise.sets}${exercise.equipment ? ` · ${exercise.equipment}` : ''}`

  // Matched on exercise_order — this row's position in this session — so a
  // repeated canonical exercise never picks up another occurrence's sets.
  const sets = logging?.sets.filter((set) => set.exerciseOrder === index) ?? []
  const resolved = sets.filter((set) => set.status !== 'pending').length

  // Matched on the same position, so a repeated canonical exercise cannot pick
  // up the other slot's guidance any more than it can its sets.
  const lane = guidance?.laneFor(index) ?? null

  /*
   * What can be said about this exercise's modality right now?
   *
   * When the current setting DISAGREES with what the workout froze, the frozen
   * controls stay — they are what the logged sets mean — but the actionable
   * guidance is withdrawn. Confirming a kilogram load on an exercise the user
   * has just declared to be band work writes evidence they will have to undo.
   *
   * ROUND 22 CORRECTION 2. The same is withdrawn while the current setting is
   * merely UNVERIFIED — still loading, or unreadable. The disagreement above
   * cannot be ruled out until the library has actually answered, and offering
   * a kilogram judgement in the meantime is the same bad evidence arrived at
   * by assumption rather than by a stale setting.
   */
  const verdict = logging ? (modalityAt?.(index) ?? null) : null
  const mismatch = verdict?.kind === 'mismatch' ? verdict : null
  const unverified = verdict?.kind === 'unverified' ? verdict : null
  // Anything the panel OFFERS needs a modality that is both known and agreed.
  const actionable = verdict === null

  return (
    <motion.li variants={listItemVariants}>
      <Card
        className={cn(
          'overflow-hidden transition-colors duration-150',
          expanded ? 'border-blue/45 bg-surface-raised' : 'hover:border-edge-strong',
        )}
      >
        <motion.button
          type="button"
          id={triggerId}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          whileTap={press.whileTap}
          transition={press.transition}
          className="flex w-full items-center gap-4 p-4 text-left outline-offset-[-2px]"
        >
          <span
            aria-hidden="true"
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold transition-colors duration-150',
              expanded ? 'bg-blue/15 text-blue' : 'bg-surface-overlay text-ink-dim',
            )}
          >
            {index + 1}
          </span>

          <div className="min-w-0 flex-1">
            <p className="font-bold text-offwhite">{exercise.name}</p>
            <p className="mt-0.5 text-[13px] text-ink-faint">{summary}</p>
          </div>

          {sets.length > 0 && (
            <span className="shrink-0 text-[12px] font-bold text-ink-faint">
              {resolved}/{sets.length}
            </span>
          )}

          <motion.span
            aria-hidden="true"
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={reduceMotion ? { duration: 0 } : tween.enter}
            className="shrink-0 text-ink-faint"
          >
            <ChevronDown className="size-5" />
          </motion.span>
        </motion.button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="panel"
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={reduceMotion ? { duration: 0 } : tween.enter}
              className="overflow-hidden"
            >
              <div className="border-t border-edge px-4 pb-4 pt-3.5">
                <dl className="flex flex-wrap gap-x-8 gap-y-3">
                  <Detail label="Prescribed" value={exercise.sets} />
                  {exercise.equipment && (
                    <Detail label="Equipment" value={exercise.equipment} />
                  )}
                </dl>

                {mismatch && (
                  <div
                    role="status"
                    data-modality-mismatch
                    className="mt-4 rounded-control border border-coral/50 bg-coral/10 p-3"
                  >
                    <p className="text-[12px] font-bold text-offwhite">
                      This workout was started before this exercise&rsquo;s input
                      type changed.
                    </p>
                    <p className="mt-1 text-[12px] text-ink-dim">
                      It is frozen as{' '}
                      <strong className="text-offwhite">
                        {WORKOUT_INPUT_TYPE_LABELS[mismatch.frozen as WorkoutInputType]}
                      </strong>
                      ; your current setting is{' '}
                      <strong className="text-offwhite">
                        {WORKOUT_INPUT_TYPE_LABELS[mismatch.current as WorkoutInputType]}
                      </strong>
                      . Nothing has been converted, and what you already recorded
                      is unchanged.
                    </p>
                    <p className="mt-1 text-[12px] text-ink-faint">
                      Load guidance is paused for this exercise while the two
                      disagree. You can correct anything you recorded here
                      afterwards from Progress → Recorded sets → Edit recorded
                      set.
                    </p>
                  </div>
                )}

                {unverified && guidance && (
                  <div
                    role="status"
                    data-modality-unverified
                    data-unverified-reason={unverified.reason}
                    className="mt-4 rounded-control border border-edge-strong bg-surface-overlay/60 p-3"
                  >
                    <p className="text-[12px] font-bold text-offwhite">
                      {unverified.reason === 'error'
                        ? 'Current input type could not be verified. Load guidance is paused.'
                        : 'Checking this exercise’s current input type. Load guidance is paused.'}
                    </p>
                    <p className="mt-1 text-[12px] text-ink-faint">
                      Logging is unaffected — this workout keeps the controls it
                      was started with, and nothing you have recorded has
                      changed.
                    </p>
                  </div>
                )}

                {logging && lane && guidance && actionable && (
                  <ExerciseGuidance
                    lane={lane}
                    confirmed={guidance.confirmed}
                    busy={guidance.busyLane === index}
                    // Bound to the lane it happened on, so it survives the
                    // request that caused it rather than vanishing with the
                    // spinner.
                    error={
                      guidance.error?.exerciseOrder === index
                        ? guidance.error.message
                        : null
                    }
                    onFeedback={guidance.onFeedback}
                  />
                )}

                {logging && (
                  <WorkoutSetList
                    sets={sets}
                    busySet={logging.busySet}
                    // Offered to the draft field only; nothing is pre-filled.
                    suggestedLoad={actionable ? (lane?.suggestedLoad ?? null) : null}
                    // Unconfirmed guidance may be READ but not acted on: the
                    // set it was derived from may already have changed.
                    suggestionLocked={guidance ? !guidance.confirmed : false}
                    onComplete={logging.onComplete}
                    onSkip={logging.onSkip}
                    onUndo={logging.onUndo}
                  />
                )}

                <Link
                  to={exercisePath(exercise.id, sessionId)}
                  className="mt-4 inline-flex items-center gap-1 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:border-blue/60 hover:text-offwhite"
                >
                  Open exercise details
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.li>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </dt>
      <dd className="mt-0.5 text-[15px] font-bold text-offwhite">{value}</dd>
    </div>
  )
}
