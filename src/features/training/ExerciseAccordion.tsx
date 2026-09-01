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
import type { SessionExercise, TrainingSession } from './sessions'
import type { WorkoutSet } from './workoutApi'
import { WorkoutSetList, type WorkoutSetListProps } from './WorkoutSetList'
import type { CalibrationFeedback } from '@shared/progression/lane'

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
 */
export type AccordionGuidance = {
  laneFor: (exerciseOrder: number) => LaneRecommendation | null
  busyLane: number | null
  error: string | null
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
export function ExerciseAccordion({
  session,
  logging,
  guidance,
}: {
  session: TrainingSession
  logging?: AccordionLogging
  guidance?: AccordionGuidance
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
}: {
  exercise: SessionExercise
  index: number
  sessionId: string
  expanded: boolean
  onToggle: () => void
  logging?: AccordionLogging
  guidance?: AccordionGuidance
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

                {logging && lane && guidance && (
                  <ExerciseGuidance
                    lane={lane}
                    busy={guidance.busyLane === index}
                    error={guidance.busyLane === index ? guidance.error : null}
                    onFeedback={guidance.onFeedback}
                  />
                )}

                {logging && (
                  <WorkoutSetList
                    sets={sets}
                    busySet={logging.busySet}
                    // Offered to the draft field only; nothing is pre-filled.
                    suggestedLoad={lane?.suggestedLoad ?? null}
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
