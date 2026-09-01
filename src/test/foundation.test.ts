import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FOUNDATION_START,
  FOUNDATION_TOTAL_DAYS,
  foundationLabel,
  foundationStatus,
} from '@/features/progress/foundation'
import { localWorkoutDate } from '@/features/training/workoutPlan'

/**
 * Round 10 — the Foundation 100 calendar.
 *
 * Day 1 is 2026-08-31, Day 100 is 2026-12-08, and both are LOCAL calendar
 * dates. Reaching Day 100 ends nothing: the count keeps going.
 *
 * Round 18 made the start date an account setting, so these accepted cases now
 * run against the DEFAULT — which is exactly what an account that has never
 * chosen a date is still counted from. The end date is derived rather than
 * declared, so it is computed here too.
 */

/** Day 100 under the default start, formerly the FOUNDATION_END constant. */
const DEFAULT_FOUNDATION_END = '2026-12-08'

const day = (date: string) => foundationStatus(date, DEFAULT_FOUNDATION_START)

describe('the accepted anchors', () => {
  it('starts on 2026-08-31 and runs 100 days', () => {
    expect(DEFAULT_FOUNDATION_START).toBe('2026-08-31')
    expect(FOUNDATION_TOTAL_DAYS).toBe(100)
    // Day 100 is now derived from the start rather than declared beside it.
    expect(day(DEFAULT_FOUNDATION_START)!.endDate).toBe(DEFAULT_FOUNDATION_END)
  })

  it('makes the start date Day 1', () => {
    expect(day('2026-08-31')).toEqual({
      phase: 'foundation',
      day: 1,
      total: 100,
      daysUntilStart: null,
      // Round 18: the status echoes the start it was derived from, and the
      // derived Day 100, so nothing downstream has to recompute either.
      startDate: DEFAULT_FOUNDATION_START,
      endDate: DEFAULT_FOUNDATION_END,
    })
  })

  it('makes the accepted end date Day 100', () => {
    const status = day('2026-12-08')!
    expect(status.phase).toBe('foundation')
    expect(status.day).toBe(100)
  })

  it('agrees that the end date is exactly the last Foundation day', () => {
    // The two accepted anchors have to be consistent with each other.
    expect(day(DEFAULT_FOUNDATION_END)!.day).toBe(FOUNDATION_TOTAL_DAYS)
  })
})

describe('before the start', () => {
  it('is upcoming the day before, with no day number', () => {
    expect(day('2026-08-30')).toEqual({
      phase: 'upcoming',
      day: null,
      total: 100,
      daysUntilStart: 1,
      startDate: DEFAULT_FOUNDATION_START,
      endDate: DEFAULT_FOUNDATION_END,
    })
  })

  it('never reports Day 0', () => {
    for (const date of ['2026-08-30', '2026-08-01', '2026-01-01', '2025-12-31']) {
      const status = day(date)!
      expect(status.phase, date).toBe('upcoming')
      // Day 0 would present an inactive Foundation as if it were running.
      expect(status.day, date).toBeNull()
    }
  })

  it('counts the days remaining until Day 1', () => {
    expect(day('2026-08-29')!.daysUntilStart).toBe(2)
    expect(day('2026-08-01')!.daysUntilStart).toBe(30)
  })
})

describe('during Foundation', () => {
  it.each([
    ['2026-09-01', 2],
    ['2026-09-30', 31],
    ['2026-10-01', 32],
    ['2026-10-31', 62],
    ['2026-11-01', 63],
    ['2026-11-30', 92],
    ['2026-12-01', 93],
    ['2026-12-07', 99],
  ])('puts %s on day %i', (date, expected) => {
    const status = day(date)!
    expect(status.phase).toBe('foundation')
    expect(status.day).toBe(expected)
  })

  it('increments by exactly one per calendar day', () => {
    let previous = day('2026-08-31')!.day!
    for (const date of ['2026-09-01', '2026-09-02', '2026-09-03']) {
      const next = day(date)!.day!
      expect(next).toBe(previous + 1)
      previous = next
    }
  })
})

describe('after day 100', () => {
  it('keeps counting rather than stopping or resetting', () => {
    const next = day('2026-12-09')!
    expect(next.phase).toBe('beyond')
    // Not 1, and not capped at 100.
    expect(next.day).toBe(101)
  })

  it('continues long-term without implying anything finished', () => {
    const later = day('2027-03-01')!
    expect(later.phase).toBe('beyond')
    expect(later.day).toBeGreaterThan(100)
    expect(foundationLabel(later)).toBe(`Day ${later.day}`)
    expect(foundationLabel(later)).not.toMatch(/complete|finished|done|over/i)
  })
})

describe('labels', () => {
  it('reads Day X / 100 during Foundation', () => {
    expect(foundationLabel(day('2026-08-31')!)).toBe('Day 1 / 100')
    expect(foundationLabel(day('2026-12-08')!)).toBe('Day 100 / 100')
  })

  it('says upcoming before the start', () => {
    expect(foundationLabel(day('2026-08-30')!)).toBe('Foundation upcoming')
  })
})

describe('local-date semantics', () => {
  it('reads a plain calendar date, with no timezone applied', () => {
    // Same input, same answer, whatever the host offset — the value is a
    // calendar date, not an instant.
    expect(day('2026-08-31')!.day).toBe(1)
    expect(day('2026-09-01')!.day).toBe(2)
  })

  it('uses the device calendar date, not the UTC date', () => {
    // Just after local midnight on Day 1. East of UTC the ISO date is still
    // 2026-08-30, which would wrongly read as "upcoming".
    const justAfterMidnight = new Date(2026, 7, 31, 0, 30)
    expect(localWorkoutDate(justAfterMidnight)).toBe('2026-08-31')
    expect(day(localWorkoutDate(justAfterMidnight))!.day).toBe(1)

    // Late local evening on Day 1. West of UTC the ISO date is already
    // 2026-09-01, which would wrongly read as Day 2.
    const lateEvening = new Date(2026, 7, 31, 23, 45)
    expect(localWorkoutDate(lateEvening)).toBe('2026-08-31')
    expect(day(localWorkoutDate(lateEvening))!.day).toBe(1)
  })

  it('does not roll a month boundary', () => {
    expect(day(localWorkoutDate(new Date(2026, 8, 30, 23, 50)))!.day).toBe(31)
    expect(day(localWorkoutDate(new Date(2026, 9, 1, 0, 10)))!.day).toBe(32)
  })
})

describe('malformed input', () => {
  it.each(['', 'today', '2026-8-31', '31-08-2026', '2026-02-30', '2026-13-01'])(
    'returns null for %s rather than guessing a day',
    (value) => {
      expect(foundationStatus(value, DEFAULT_FOUNDATION_START)).toBeNull()
    },
  )
})
