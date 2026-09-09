/**
 * When Prep Week is, as one rule.
 *
 * Its own module rather than an export beside the component, because it is a
 * domain rule and not a component: the note renders it and the Today eyebrow
 * words itself around it, and both have to agree. Two callers separately
 * interpreting a Foundation phase is exactly how the gap this corrects opened.
 */

import type { FoundationStatus } from '@/features/progress/foundation'

/** Prep Week is the last seven calendar days before Day 1: 1..7 inclusive. */
export const PREP_WEEK_DAYS = 7

/**
 * How many days of Prep Week are left, or null when it is not Prep Week.
 *
 * CORRECTION 1. The first cut treated `upcoming` as a synonym for Prep Week,
 * and it is not one. The Foundation start date is editable, so `upcoming` is
 * simply "Day 1 has not arrived" — it is equally true 30 or 60 days out. A
 * page that read "PREP WEEK · 30 days until Foundation Day 1" would be naming
 * a week that is nowhere near, which is the same class of untruth as showing a
 * confident number for something unknown.
 *
 * So Prep Week is a WINDOW, defined once, here. The note and the eyebrow both
 * ask this function rather than each deciding for themselves — two components
 * separately interpreting a phase is exactly how the original gap opened.
 *
 * Everything it refuses:
 *
 *   - `upcoming` only. On Day 1 the phase becomes `foundation` and this
 *     returns null, so the normal Foundation state takes over with nothing to
 *     dismiss and nothing to unwind.
 *   - `1..7` only. Further out than a week is not Prep Week, and gets a
 *     truthful countdown eyebrow instead of a name that would be wrong.
 *   - Never 0 and never negative. `upcoming` means `day < 1`, which makes
 *     `daysUntilStart` at least 1 by construction; the explicit lower bound is
 *     belt-and-braces against a future caller, not a fix for a real case.
 *
 * No date is re-derived and no number is hard-coded to a particular day: the
 * count is `foundationStatus`'s own `daysUntilStart`.
 */
export function prepWeekDaysRemaining(status: FoundationStatus | null): number | null {
  if (!status || status.phase !== 'upcoming') return null
  const days = status.daysUntilStart
  if (days === null || days < 1 || days > PREP_WEEK_DAYS) return null
  return days
}
