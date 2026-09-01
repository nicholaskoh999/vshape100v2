import { describe, expect, it } from 'vitest'

import { buildMilestones } from '@/features/achievements/model/milestones'
import { evaluationWindow } from '@/features/achievements/model/window'
import {
  DEFAULT_FOUNDATION_START,
  FOUNDATION_TOTAL_DAYS,
  foundationLabel,
  foundationStatus,
} from '@/features/progress/foundation'
import { evaluateStreaks, type StreakSources } from '@/features/achievements/model/streak'
import { sessionIdForWeekday } from '@/features/today/model/routines'
import { addLocalDays, weekdayOf } from '@shared/localDate'
import {
  effectiveFoundationStart,
  parseFoundationStartDate,
  parseSettingsUpdate,
} from '@shared/settings'

/**
 * Round 18.1 — the Foundation start date as an account setting.
 *
 * The rules these defend, in the order they matter:
 *
 *   an account that never chose keeps its legacy numbering
 *   a chosen date renumbers days and milestones, and NOTHING else
 *   there is never a Day 0 and never a negative day
 *   Day 100 is start + 99, and the count keeps going past it
 */

const LEGACY = DEFAULT_FOUNDATION_START // 2026-08-31
const CUTOVER = '2026-09-01'

/* ------------------------------------------------------------------ */
/* 1. No persisted date → legacy behaviour                             */
/* ------------------------------------------------------------------ */

describe('1. an account that has never chosen keeps the legacy start', () => {
  it('resolves null settings to the legacy date', () => {
    expect(effectiveFoundationStart(null)).toBe(LEGACY)
    expect(effectiveFoundationStart({ foundationStartDate: null })).toBe(LEGACY)
    expect(LEGACY).toBe('2026-08-31')
  })

  it('numbers days exactly as it always has', () => {
    const start = effectiveFoundationStart(null)
    expect(foundationStatus('2026-08-31', start)!.day).toBe(1)
    expect(foundationStatus('2026-09-01', start)!.day).toBe(2)
    expect(foundationStatus('2026-12-08', start)!.day).toBe(100)
  })

  it('falls back rather than trusting an unreadable stored value', () => {
    // A shape-valid but impossible stored date must not renumber anything.
    expect(effectiveFoundationStart({ foundationStartDate: '2026-02-30' })).toBe(LEGACY)
    expect(effectiveFoundationStart({ foundationStartDate: 'nonsense' })).toBe(LEGACY)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Saving the cutover makes it Day 1 everywhere                     */
/* ------------------------------------------------------------------ */

describe('2. saving 2026-09-01 makes it Day 1', () => {
  it('is Day 1 on the chosen date, and the day before is upcoming', () => {
    const start = effectiveFoundationStart({ foundationStartDate: CUTOVER })
    expect(start).toBe(CUTOVER)
    expect(foundationStatus(CUTOVER, start)!.day).toBe(1)
    expect(foundationStatus('2026-08-31', start)!.phase).toBe('upcoming')
  })

  it('moves the evaluation window with it, so Achievements agrees', () => {
    // The window is the whole of Foundation. One start date, one window.
    expect(evaluationWindow('2026-09-11', CUTOVER)).toEqual({
      from: CUTOVER,
      to: '2026-09-11',
    })
    expect(evaluationWindow('2026-09-11', LEGACY)).toEqual({
      from: LEGACY,
      to: '2026-09-11',
    })
  })

  it('echoes the start it was derived from, so no consumer re-guesses it', () => {
    expect(foundationStatus('2026-09-05', CUTOVER)!.startDate).toBe(CUTOVER)
  })
})

/* ------------------------------------------------------------------ */
/* 3. A future start date                                              */
/* ------------------------------------------------------------------ */

describe('3. a future start date is valid and never produces Day 0', () => {
  it('reports upcoming with a null day and a countdown', () => {
    const future = '2027-03-01'
    const status = foundationStatus('2027-02-20', future)!
    expect(status.phase).toBe('upcoming')
    expect(status.day).toBeNull()
    expect(status.daysUntilStart).toBe(9)
    expect(foundationLabel(status)).toBe('Foundation upcoming')
  })

  it('never reports Day 0 or a negative day, however far ahead the start', () => {
    for (const today of ['2026-01-01', '2026-08-30', '2020-01-01']) {
      const status = foundationStatus(today, '2027-03-01')!
      expect(status.day, today).toBeNull()
      expect(status.phase, today).toBe('upcoming')
    }
  })

  it('accepts past, today and future alike', () => {
    for (const date of ['2020-01-01', '2026-09-01', '2099-12-31']) {
      expect(parseFoundationStartDate(date), date).toBe(date)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 4. Invalid dates are rejected                                       */
/* ------------------------------------------------------------------ */

describe('4. impossible and malformed dates are rejected', () => {
  it('refuses dates that are not real calendar days', () => {
    for (const value of [
      '2026-02-30', // rolls over in a naive parser
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '2025-02-29', // not a leap year
      '2026-9-1',
      '26-09-01',
      '2026/09/01',
      '',
      'today',
      42,
      null,
      undefined,
      {},
    ]) {
      expect(parseFoundationStartDate(value), String(value)).toBeNull()
    }
  })

  it('accepts a real leap day', () => {
    expect(parseFoundationStartDate('2028-02-29')).toBe('2028-02-29')
  })

  it('refuses the same values through the update parser the API uses', () => {
    expect(parseSettingsUpdate({ foundationStartDate: '2026-02-30' })).toEqual({
      ok: false,
      field: 'foundation_start_date',
    })
    expect(parseSettingsUpdate({})).toEqual({ ok: false, field: 'foundation_start_date' })
    expect(parseSettingsUpdate(null)).toEqual({ ok: false, field: 'body' })
    expect(parseSettingsUpdate([])).toEqual({ ok: false, field: 'body' })
  })

  it('accepts an explicit null as "clear my preference"', () => {
    expect(parseSettingsUpdate({ foundationStartDate: null })).toEqual({
      ok: true,
      value: { foundationStartDate: null },
    })
  })

  it('ignores an identity supplied in the body', () => {
    // `googleSub` is not part of the accepted shape, so it is simply dropped.
    const parsed = parseSettingsUpdate({
      foundationStartDate: CUTOVER,
      googleSub: 'somebody-else',
    })
    expect(parsed).toEqual({ ok: true, value: { foundationStartDate: CUTOVER } })
  })
})

/* ------------------------------------------------------------------ */
/* 7. The start date is not schedule authority                         */
/* ------------------------------------------------------------------ */

describe('7. changing the start date changes no schedule semantics', () => {
  it('leaves the weekday session mapping untouched', () => {
    // The programme is a property of the WEEKDAY, and no start date enters it.
    for (const date of ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
      const weekday = weekdayOf(date)!
      expect(sessionIdForWeekday(weekday), date).toBe(sessionIdForWeekday(weekday))
    }
    expect(sessionIdForWeekday(weekdayOf('2026-09-07')!)).toBe('monday')
    expect(sessionIdForWeekday(weekdayOf('2026-09-08')!)).toBe('tuesday')
  })

  it('is not an input to Gym identity, Holiday, reminders or Extra identity', () => {
    // Structural: the Foundation status carries only day numbering. Nothing in
    // it names a session, a holiday, a reminder or a workout occurrence.
    const status = foundationStatus('2026-09-07', CUTOVER)!
    expect(Object.keys(status).sort()).toEqual([
      'day',
      'daysUntilStart',
      'endDate',
      'phase',
      'startDate',
      'total',
    ])
  })

  it('leaves streak facts identical whichever start date is in force', () => {
    const entries = [
      {
        date: '2026-09-07',
        sessionId: 'monday',
        kind: 'scheduled' as const,
        sourceSessionId: null,
        day: 'Monday',
        focus: 'F',
        intensity: 'HARD',
        startedAt: 1,
        updatedAt: 2,
        progress: { total: 4, completed: 4, skipped: 0, resolved: 4 },
      },
    ]
    const sources = (from: string): StreakSources => ({
      today: '2026-09-11',
      from,
      holidayStatus: 'ready',
      holidays: [],
      historyStatus: 'ready',
      entries,
      coverage: 'complete',
    })

    const legacy = evaluateStreaks(sources(LEGACY))
    const cutover = evaluateStreaks(sources(CUTOVER))
    if (legacy.status !== 'ready' || cutover.status !== 'ready') {
      throw new Error('expected both to be ready')
    }
    // A streak counts SCHEDULED training days. Renumbering Foundation does not
    // change which days were scheduled or which were trained.
    expect(cutover.facts.qualifyingSessions).toBe(legacy.facts.qualifyingSessions)
    expect(cutover.facts.current).toBe(legacy.facts.current)
  })
})

/* ------------------------------------------------------------------ */
/* 8 + 9 + 10. Milestones, Day 100, and beyond                         */
/* ------------------------------------------------------------------ */

describe('8/9/10. day arithmetic moves consistently and never stops', () => {
  const start = CUTOVER

  it('9. makes Day 100 exactly start + 99 days', () => {
    const day100 = addLocalDays(start, FOUNDATION_TOTAL_DAYS - 1)!
    expect(day100).toBe('2026-12-09')
    expect(foundationStatus(day100, start)!.day).toBe(100)
    expect(foundationStatus(day100, start)!.phase).toBe('foundation')
    // And the status reports it, so nothing recomputes it independently.
    expect(foundationStatus(start, start)!.endDate).toBe(day100)
  })

  it('8. moves Day 10, 50 and 100 together when the start moves', () => {
    for (const target of [10, 50, 100]) {
      const onLegacy = addLocalDays(LEGACY, target - 1)!
      const onCutover = addLocalDays(start, target - 1)!
      expect(foundationStatus(onLegacy, LEGACY)!.day, `legacy ${target}`).toBe(target)
      expect(foundationStatus(onCutover, start)!.day, `cutover ${target}`).toBe(target)
      // Exactly one day apart, because the two starts are one day apart.
      expect(addLocalDays(onLegacy, 1)).toBe(onCutover)
    }
  })

  it('8. moves the Foundation milestones with the start date', () => {
    // 2026-09-09 is Day 10 under the legacy start and only Day 9 under the
    // cutover — the boundary that makes the difference visible.
    const streak = evaluateStreaks({
      today: '2026-09-09',
      from: start,
      holidayStatus: 'ready',
      holidays: [],
      historyStatus: 'ready',
      entries: [],
      coverage: 'complete',
    })

    const onCutover = buildMilestones({
      streak,
      foundation: foundationStatus('2026-09-09', start),
    })
    const onLegacy = buildMilestones({
      streak,
      foundation: foundationStatus('2026-09-09', LEGACY),
    })

    const day10 = (list: typeof onCutover) => {
      const milestone = list.find((row) => row.id === 'day-10')!
      return milestone.state.status === 'locked' ? milestone.state.value : 'unlocked'
    }

    // The same calendar day: Day 10 reached under the legacy start, still one
    // day short under the cutover.
    expect(day10(onLegacy)).toBe('unlocked')
    expect(day10(onCutover)).toBe(9)
  })

  it('10. keeps counting past Day 100 rather than stopping or resetting', () => {
    const day101 = addLocalDays(start, 100)!
    const beyond = foundationStatus(day101, start)!
    expect(beyond.day).toBe(101)
    expect(beyond.phase).toBe('beyond')
    // The label drops the "/ 100" rather than capping the number.
    expect(foundationLabel(beyond)).toBe('Day 101')

    const farOut = foundationStatus(addLocalDays(start, 999)!, start)!
    expect(farOut.day).toBe(1000)
    expect(farOut.phase).toBe('beyond')
  })
})
