import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import {
  createHolidayServer,
  holiday,
  type HolidayServer,
} from './holidayApiTestUtils'
import {
  createWorkoutServer,
  type ServerSet,
  type WorkoutServer,
} from './workoutApiTestUtils'

/**
 * Round 12 — the Achievements page.
 *
 * These run the real page, hooks and clients against the in-memory API
 * stand-ins. The page's central obligation is that it never states a streak it
 * cannot prove: a failed or truncated read must read as "unavailable", never
 * as a broken streak or a locked milestone.
 *
 * Tuesday 2026-09-15 is Foundation Day 16, so Day 10 is behind it and Day 50
 * is ahead of it.
 */

const TUESDAY_15TH = new Date(2026, 8, 15, 9, 0)

let workouts: WorkoutServer
let holidays: HolidayServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TUESDAY_15TH)
  workouts = createWorkoutServer()
  holidays = createHolidayServer()
  mockAuthFetch({ session: authenticatedSession, workouts, holidays })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Seed one recorded workout with an exact completed / skipped / pending split. */
function seedWorkout(options: {
  date: string
  sessionId: string
  total: number
  completed?: number
  skipped?: number
}) {
  const { date, sessionId, total, completed = 0, skipped = 0 } = options

  const sets: ServerSet[] = Array.from({ length: total }, (_unused, index) => {
    const status =
      index < completed ? 'completed' : index < completed + skipped ? 'skipped' : 'pending'
    return {
      exerciseOrder: 0,
      setIndex: index,
      exerciseId: 'lat-pulldown',
      exerciseName: 'Lat Pulldown',
      prescription: '4 × 10–15',
      equipment: 'BAND 20kg',
      resultKind: 'reps' as const,
      loadMode: 'kg' as const,
      perSide: false,
      status: status as ServerSet['status'],
      load: status === 'completed' ? { value: 20, unit: 'kg' as const } : null,
      result: status === 'completed' ? 12 : null,
      updatedAt: 1,
    }
  })

  workouts.seed(date, sessionId, {
    occurrence: {
      date,
      sessionId,
      day: sessionId,
      focus: 'Focus',
      intensity: 'HARD',
      startedAt: 1,
      updatedAt: 1,
    },
    sets,
  })
}

/** A finished session: every set resolved, all of them completed. */
function seedFinished(date: string, sessionId: string) {
  seedWorkout({ date, sessionId, total: 4, completed: 4 })
}

async function renderAchievements() {
  renderApp('/achievements')
  await screen.findByRole('heading', { level: 1, name: 'Achievements' })
}

function summary(): HTMLElement | null {
  return document.querySelector('[data-streak-summary]')
}

function streakState(): string | null {
  return summary()?.getAttribute('data-streak-state') ?? null
}

function milestoneState(id: string): string | null {
  return document.querySelector(`[data-milestone="${id}"]`)?.getAttribute('data-milestone-state')
    ?? null
}

function milestoneText(id: string): string {
  return document.querySelector(`[data-milestone="${id}"]`)?.textContent ?? ''
}

/** Wait until the streak summary has settled out of "checking". */
async function settled() {
  await waitFor(() => expect(streakState()).not.toBe('checking'))
}

/* ------------------------------------------------------------------ */
/* 1. Loading                                                          */
/* ------------------------------------------------------------------ */

describe('1. while the reads are in flight', () => {
  it('says it is checking rather than showing a streak of zero', async () => {
    const release = workouts.holdReads()
    await renderAchievements()

    expect(streakState()).toBe('checking')
    expect(summary()?.textContent).toMatch(/Checking streak/)
    // A zero here would be a claim that nothing has been trained.
    expect(summary()?.textContent).not.toMatch(/Current streak/)
    release()
  })

  it('leaves training milestones unresolved, not locked', async () => {
    const release = holidays.holdReads()
    await renderAchievements()

    expect(milestoneState('first-session')).toBe('unresolved')
    expect(milestoneText('first-session')).toMatch(/Checking/)
    release()
  })
})

/* ------------------------------------------------------------------ */
/* 2. Real facts                                                       */
/* ------------------------------------------------------------------ */

describe('2. derived facts', () => {
  it('reports current streak, best streak and finished sessions', async () => {
    seedFinished('2026-09-10', 'thursday')
    seedFinished('2026-09-11', 'friday')
    seedFinished('2026-09-15', 'tuesday')
    // Monday the 14th is a Holiday: exempt, so it bridges rather than breaks.
    holidays.seed(holiday('h1', '2026-09-14'))

    await renderAchievements()
    await settled()

    expect(streakState()).toBe('ready')
    const text = summary()?.textContent ?? ''
    expect(text).toMatch(/Current streak/)
    // Three training days, not six calendar days.
    expect(summary()?.querySelectorAll('dd')[0]?.textContent).toMatch(/^3/)
    expect(summary()?.querySelectorAll('dd')[1]?.textContent).toMatch(/^3/)
    expect(summary()?.querySelectorAll('dd')[2]?.textContent).toMatch(/^3/)
  })

  it('unlocks First session and shows honest progress toward Full week', async () => {
    seedFinished('2026-09-14', 'monday')
    seedFinished('2026-09-15', 'tuesday')

    await renderAchievements()
    await settled()

    expect(milestoneState('first-session')).toBe('unlocked')
    expect(milestoneText('first-session')).toMatch(/Unlocked/)

    expect(milestoneState('full-week')).toBe('locked')
    expect(milestoneText('full-week')).toMatch(/2 \/ 5 training days/)
  })

  it('does not unlock anything from a session that was only skipped', async () => {
    seedWorkout({ date: '2026-09-15', sessionId: 'tuesday', total: 4, skipped: 4 })

    await renderAchievements()
    await settled()

    expect(milestoneState('first-session')).toBe('locked')
    expect(milestoneText('first-session')).toMatch(/0 \/ 1 training days/)
  })

  it('never presents a Holiday as a missed session', async () => {
    holidays.seed(holiday('h1', '2026-09-07', '2026-09-15'))

    await renderAchievements()
    await settled()

    const page = document.querySelector('main')?.textContent ?? ''
    expect(page).toMatch(/exempt/i)
    for (const banned of [/missed/i, /failed/i, /broken/i]) {
      expect(page, String(banned)).not.toMatch(banned)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 3. Foundation milestones stay answerable                            */
/* ------------------------------------------------------------------ */

describe('3. Foundation milestones', () => {
  it('unlocks Day 10 from the calendar with nothing recorded at all', async () => {
    await renderAchievements()
    await settled()

    // Day 16 today. No workout is required to have reached Day 10.
    expect(milestoneState('day-10')).toBe('unlocked')
    expect(milestoneState('day-50')).toBe('locked')
    expect(milestoneText('day-50')).toMatch(/Day 16 \/ 50/)
  })

  it('keeps counting Foundation days through a Holiday', async () => {
    holidays.seed(holiday('h1', '2026-09-01', '2026-09-15'))

    await renderAchievements()
    await settled()

    expect(milestoneState('day-10')).toBe('unlocked')
    expect(milestoneText('day-50')).toMatch(/Day 16 \/ 50/)
  })

  it('still answers Foundation days when the streak cannot be known', async () => {
    workouts.failReads()

    await renderAchievements()
    await settled()

    expect(streakState()).toBe('unavailable')
    // A calendar fact does not depend on the workout read.
    expect(milestoneState('day-10')).toBe('unlocked')
  })
})

/* ------------------------------------------------------------------ */
/* 4. Refusing to claim                                                */
/* ------------------------------------------------------------------ */

describe('4. incomplete truth', () => {
  it('shows no streak when the workout read fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedFinished('2026-09-15', 'tuesday')
    workouts.failReads()

    await renderAchievements()
    await settled()

    expect(streakState()).toBe('unavailable')
    expect(summary()?.textContent).toMatch(/Streak unavailable/)
    expect(summary()?.textContent).toMatch(/Nothing has been counted as missed/)
    expect(summary()?.querySelectorAll('dd')).toHaveLength(0)
    errors.mockRestore()
  })

  it('shows no streak when Holiday truth fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedFinished('2026-09-15', 'tuesday')
    holidays.failReads()

    await renderAchievements()
    await settled()

    expect(streakState()).toBe('unavailable')
    // Without Holiday truth a rest day and a missed day are the same thing.
    expect(summary()?.textContent).toMatch(/rest days cannot be told from missed ones/)
    errors.mockRestore()
  })

  it('treats a truncated workout read as unproven rather than as an empty history', async () => {
    seedFinished('2026-09-10', 'thursday')
    seedFinished('2026-09-11', 'friday')
    seedFinished('2026-09-15', 'tuesday')
    // The server returns one row and admits it did not cover the window.
    workouts.capRange(1)

    await renderAchievements()
    await settled()

    expect(streakState()).toBe('unavailable')
    expect(summary()?.textContent).toMatch(/did not cover the whole period/)
    expect(milestoneState('first-session')).toBe('unresolved')
  })

  it('leaves no stale streak number behind after a failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    workouts.failReads()

    await renderAchievements()
    await settled()

    const text = summary()?.textContent ?? ''
    expect(text).not.toMatch(/Current streak/)
    expect(text).not.toMatch(/Best streak/)
    errors.mockRestore()
  })

  it('offers a retry that recovers', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    seedFinished('2026-09-15', 'tuesday')
    workouts.failReads()

    await renderAchievements()
    await settled()
    expect(streakState()).toBe('unavailable')

    screen.getByRole('button', { name: 'Try again' }).click()
    await waitFor(() => expect(streakState()).toBe('ready'))
    expect(milestoneState('first-session')).toBe('unlocked')
    errors.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/* 5. Structure                                                        */
/* ------------------------------------------------------------------ */

describe('5. structure', () => {
  it('keeps the six accepted milestone slots', async () => {
    await renderAchievements()
    await settled()

    const ids = [...document.querySelectorAll('[data-milestone]')].map((el) =>
      el.getAttribute('data-milestone'),
    )
    expect(ids).toEqual([
      'first-session',
      'full-week',
      'day-10',
      'consistency',
      'day-50',
      'day-100',
    ])
  })

  it('invents no unlock dates and no gamification', async () => {
    seedFinished('2026-09-15', 'tuesday')
    await renderAchievements()
    await settled()

    const page = document.querySelector('main')?.textContent ?? ''
    for (const banned of [/XP/, /coins?/i, /level/i, /leaderboard/i, /reward/i, /badge/i]) {
      expect(page, String(banned)).not.toMatch(banned)
    }
    // No "Unlocked on 15 Sep" — the app never recorded when.
    expect(page).not.toMatch(/Unlocked on/i)
  })

  it('uses no fixed pixel widths that would overflow a narrow screen', async () => {
    await renderAchievements()
    await settled()

    const fixed = [...document.querySelectorAll('main *')].filter((el) => {
      const width = (el as HTMLElement).style.width
      return width.endsWith('px')
    })
    expect(fixed).toHaveLength(0)
  })
})
