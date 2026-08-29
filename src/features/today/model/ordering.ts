import type { TodayEntry, TodayStatus } from './types'

/**
 * Display priority.
 *
 * NOW leads the day. LATE sits immediately behind it so unfinished overdue
 * work stays in the first screenful and is never buried under the rest of the
 * schedule. DONE EARLIER always drops to the bottom.
 */
const statusRank: Record<TodayStatus, number> = {
  NOW: 0,
  LATE: 1,
  NEXT: 2,
  LATER: 3,
  DONE_EARLIER: 4,
}

/**
 * Total order over occurrences: status, then chronology, then declaration
 * order. Because every tier is fully determined, the list is stable across
 * completes, undos and clock ticks — items only move when their status
 * actually changed.
 *
 * NOW runs newest-first: when a broad flexible window and a specific item are
 * both current (Sunday evening's free time and the room reset), the one that
 * started most recently is the one being asked for. Every other tier reads
 * chronologically, so the LATE backlog is oldest-first.
 */
export function compareEntries(a: TodayEntry, b: TodayEntry): number {
  const byStatus = statusRank[a.status] - statusRank[b.status]
  if (byStatus !== 0) return byStatus
  if (a.start !== b.start) {
    return a.status === 'NOW' ? b.start - a.start : a.start - b.start
  }
  return a.order - b.order
}

export function sortEntries(entries: readonly TodayEntry[]): TodayEntry[] {
  return [...entries].sort(compareEntries)
}

export type TodayGroups = Record<TodayStatus, TodayEntry[]>

/** Grouped by status, each group already in display order. */
export function groupByStatus(entries: readonly TodayEntry[]): TodayGroups {
  const groups: TodayGroups = {
    NOW: [],
    LATE: [],
    NEXT: [],
    LATER: [],
    DONE_EARLIER: [],
  }
  for (const entry of sortEntries(entries)) groups[entry.status].push(entry)
  return groups
}
