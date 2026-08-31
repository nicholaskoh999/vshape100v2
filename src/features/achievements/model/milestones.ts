/**
 * The six milestone slots, derived from facts that already exist.
 *
 * Nothing is stored and nothing is "unlocked" as an event: a milestone is a
 * question asked of the current facts every time the page renders. That is why
 * there are no unlock dates anywhere — the app never recorded one, so it would
 * have to invent it.
 *
 * Two different truths drive them:
 *
 *   - training milestones need streak facts, which need complete workout AND
 *     Holiday truth. Without that they are `unresolved`, never "locked".
 *   - Foundation milestones are pure local-calendar facts. Holiday does not
 *     pause Foundation, so they stay answerable even when streaks are not.
 */

import type { FoundationStatus } from '@/features/progress/foundation'

import type { StreakEvaluation } from './streak'

export type MilestoneId =
  | 'first-session'
  | 'full-week'
  | 'day-10'
  | 'consistency'
  | 'day-50'
  | 'day-100'

/** Which truth a milestone is asking about. */
export type MilestoneSource = 'training' | 'foundation'

/**
 * A milestone's state.
 *
 *   unlocked   — the fact is true now
 *   locked     — not yet, with honest progress toward it. `value` is null when
 *                there is no number to show (Foundation has not started, so
 *                there is no Day 0 to claim)
 *   unresolved — the truth it depends on is loading, failed or incomplete. It
 *                is NOT locked: we do not know.
 */
export type MilestoneState =
  | { status: 'unlocked' }
  | { status: 'locked'; value: number | null; target: number }
  | { status: 'unresolved' }

export type Milestone = {
  id: MilestoneId
  label: string
  /** What reaching it means, in one short line. */
  description: string
  source: MilestoneSource
  target: number
  state: MilestoneState
}

/** Progress copy for a locked milestone, e.g. `3 / 5 training days`. */
export function milestoneProgressLabel(milestone: Milestone): string | null {
  if (milestone.state.status !== 'locked') return null
  const { value, target } = milestone.state

  if (milestone.source === 'foundation') {
    // No Day 0: before Foundation begins there is no day number to report.
    return value === null ? 'Foundation not started' : `Day ${value} / ${target}`
  }
  return `${value ?? 0} / ${target} training days`
}

/** A training milestone: unresolved unless the streak facts are trustworthy. */
function trainingMilestone(
  id: MilestoneId,
  label: string,
  description: string,
  target: number,
  streak: StreakEvaluation,
  read: (facts: { current: number; best: number; qualifyingSessions: number }) => number,
): Milestone {
  const base = { id, label, description, source: 'training' as const, target }

  if (streak.status !== 'ready') {
    return { ...base, state: { status: 'unresolved' } }
  }

  const value = read(streak.facts)
  return {
    ...base,
    state: value >= target ? { status: 'unlocked' } : { status: 'locked', value, target },
  }
}

/**
 * A Foundation milestone: a calendar fact.
 *
 * Holiday does not pause Foundation, so nothing about Holiday truth is
 * consulted here, and no workout is required to reach one.
 */
function foundationMilestone(
  id: MilestoneId,
  label: string,
  description: string,
  target: number,
  foundation: FoundationStatus | null,
): Milestone {
  const base = { id, label, description, source: 'foundation' as const, target }

  // Null means the local date itself could not be read — not "not yet".
  if (foundation === null) return { ...base, state: { status: 'unresolved' } }

  // Upcoming has no day number at all; `day` stays null rather than 0.
  const day = foundation.day
  if (day === null) return { ...base, state: { status: 'locked', value: null, target } }

  return {
    ...base,
    state: day >= target ? { status: 'unlocked' } : { status: 'locked', value: day, target },
  }
}

/** The six milestones, in their accepted order. */
export function buildMilestones(input: {
  streak: StreakEvaluation
  foundation: FoundationStatus | null
}): Milestone[] {
  const { streak, foundation } = input

  return [
    trainingMilestone(
      'first-session',
      'First session',
      'Finish one planned training session.',
      1,
      streak,
      (facts) => facts.qualifyingSessions,
    ),
    trainingMilestone(
      'full-week',
      'Full week',
      'Five training days in a row. Weekends and Holidays are exempt.',
      5,
      streak,
      (facts) => facts.best,
    ),
    foundationMilestone(
      'day-10',
      'Day 10',
      'Reach Day 10 of Foundation.',
      10,
      foundation,
    ),
    trainingMilestone(
      'consistency',
      'Consistency',
      'Ten training days in a row. Weekends and Holidays are exempt.',
      10,
      streak,
      (facts) => facts.best,
    ),
    foundationMilestone(
      'day-50',
      'Day 50',
      'Reach Day 50 of Foundation.',
      50,
      foundation,
    ),
    foundationMilestone(
      'day-100',
      'Day 100',
      'Reach Day 100 of Foundation.',
      100,
      foundation,
    ),
  ]
}
