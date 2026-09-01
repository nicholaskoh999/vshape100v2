/**
 * The period Achievements evaluates, and how it is read.
 *
 * The period is the WHOLE of Foundation: Day 1 through today. It is never a
 * rolling recent window. A rolling window would quietly rewrite history — a
 * ten-day run reached last year would stop counting once it aged out, and
 * Consistency, already earned, would lock itself again purely because time
 * passed. An achievement must not un-happen.
 *
 * Requests still stay bounded. The period is split into ADJACENT, NON-
 * OVERLAPPING chunks, each inside the per-request span limit, and the results
 * are composed back into one complete history. Bounding the requests is not
 * the same as bounding the truth.
 */

import { MAX_HOLIDAY_RANGE_DAYS } from '@shared/holiday'
import { addLocalDays, daysBetween, isLocalDate } from '@shared/localDate'
import { MAX_HISTORY_RANGE_DAYS } from '@shared/workoutLog'

export type DateRange = { from: string; to: string }

/**
 * Days one chunk may span.
 *
 * The smaller of the two per-request limits, because every chunk is asked of
 * BOTH sources. Taking the smaller means a chunk can never be accepted by one
 * surface and refused by the other.
 */
export const MAX_CHUNK_DAYS = Math.min(MAX_HISTORY_RANGE_DAYS, MAX_HOLIDAY_RANGE_DAYS)

/**
 * A runaway guard on the loop below, not a bound on history.
 *
 * At 366 days per chunk this allows roughly two centuries of Foundation, so it
 * cannot be reached by the passage of time. It exists only so a nonsensical
 * date can never produce an unbounded loop.
 */
export const MAX_EVALUATION_CHUNKS = 512

/**
 * The period to evaluate: Foundation Day 1 through today.
 *
 * Deliberately NOT clipped to a recent span. Before Foundation begins there is
 * nothing behind today to evaluate, so the period collapses to today alone
 * rather than running backwards.
 *
 * Round 18: the start is the ACCOUNT's, passed in rather than imported. This
 * module used to reach for the source constant itself, which made it a second
 * authority on when Foundation began; now it has none of its own.
 */
export function evaluationWindow(today: string, startDate: string): DateRange {
  if (!isLocalDate(today)) return { from: today, to: today }
  if (!isLocalDate(startDate)) return { from: today, to: today }
  if (startDate > today) return { from: today, to: today }
  return { from: startDate, to: today }
}

/**
 * The period as adjacent bounded chunks, oldest first.
 *
 * Chunks tile the window exactly: the first begins on `from`, the last ends on
 * `to`, and each begins the day after the previous one ends. No date is
 * covered twice, so composing the results cannot double-count an occurrence,
 * and no date is skipped, so nothing is silently outside the evaluation.
 */
export function evaluationChunks(window: DateRange): DateRange[] {
  if (!isLocalDate(window.from) || !isLocalDate(window.to)) return []
  if (window.from > window.to) return []

  const chunks: DateRange[] = []
  let start: string | null = window.from

  while (start !== null && start <= window.to && chunks.length < MAX_EVALUATION_CHUNKS) {
    const limit = addLocalDays(start, MAX_CHUNK_DAYS - 1)
    const end = limit === null || limit > window.to ? window.to : limit
    chunks.push({ from: start, to: end })
    if (end === window.to) break
    start = addLocalDays(end, 1)
  }

  return chunks
}

/** Whole days a range covers, inclusive of both ends. */
export function rangeLength(range: DateRange): number {
  const span = daysBetween(range.from, range.to)
  return span === null ? 0 : span + 1
}
