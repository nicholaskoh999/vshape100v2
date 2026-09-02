import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import {
  createWorkoutServer,
  type ServerSet,
  type WorkoutServer,
} from './workoutApiTestUtils'

/**
 * Round 10 — Progress v1.
 *
 * Progress reports recorded history and nothing else. These run the real
 * client, hook and page against the in-memory API stand-in.
 */

/** Day 1 of Foundation. */
const DAY_ONE = new Date(2026, 7, 31, 9, 0)

let server: WorkoutServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(DAY_ONE)
  server = createWorkoutServer()
  mockAuthFetch({ session: authenticatedSession, workouts: server })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type SeedOptions = {
  date: string
  sessionId?: string
  day?: string
  focus?: string
  intensity?: string
  total: number
  completed?: number
  skipped?: number
  startedAt?: number
}

/** Seed one recorded workout with an exact completed / skipped / pending split. */
function seedWorkout(options: SeedOptions) {
  const {
    date,
    sessionId = 'monday',
    day = 'Monday',
    focus = 'Back Width + Biceps',
    intensity = 'HARD',
    total,
    completed = 0,
    skipped = 0,
    startedAt = 1,
  } = options

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
      inputType: 'weight_kg' as const,
      band: null,
      status: status as ServerSet['status'],
      load: status === 'completed' ? { value: 20, unit: 'kg' as const } : null,
      result: status === 'completed' ? 12 : null,
      updatedAt: 1,
    }
  })

  server.seed(date, sessionId, {
    occurrence: { date, sessionId, day, focus, intensity, startedAt, updatedAt: startedAt },
    sets,
  })
}

async function renderProgress() {
  renderApp('/progress')
  await screen.findByRole('heading', { level: 1, name: 'Progress' })
}

/** The Recent workouts card. */
function historyCard() {
  return document.querySelector('[data-history-state]')
}

/** Wait for the Recent workouts card to reach a state and return it. */
async function awaitHistoryCard(state: 'populated' | 'empty' = 'populated') {
  return waitFor(() => {
    const el = historyCard()
    expect(el?.getAttribute('data-history-state')).toBe(state)
    return el as HTMLElement
  })
}

function foundationPhase() {
  return document.querySelector('[data-foundation-phase]')?.getAttribute('data-foundation-phase')
}

/* ------------------------------------------------------------------ */
/* Load states                                                         */
/* ------------------------------------------------------------------ */

describe('1. load states', () => {
  it('says it is loading before claiming nothing was recorded', async () => {
    const release = server.holdReads()
    await renderProgress()

    expect(screen.getByText(/Loading your recorded training/)).toBeInTheDocument()
    // It must not assert an empty history while the read is still open.
    expect(screen.queryByText('No workouts recorded yet')).toBeNull()

    release()
    await screen.findByText('No workouts recorded yet')
  })

  it('reports a failed load and recovers on retry', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads()
    await renderProgress()

    expect(await screen.findByText(/Could not load your recorded training/)).toBeInTheDocument()
    // A failed read must never be shown as "nothing recorded".
    expect(screen.queryByText('No workouts recorded yet')).toBeNull()

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No workouts recorded yet')).toBeInTheDocument()
    errors.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

describe('2. empty state', () => {
  it('shows an honest, neutral empty history', async () => {
    await renderProgress()

    expect(await screen.findByText('No workouts recorded yet')).toBeInTheDocument()
    await awaitHistoryCard('empty')
  })

  it('uses no failure, pressure or streak language', async () => {
    await renderProgress()
    await screen.findByText('No workouts recorded yet')

    const text = document.body.textContent ?? ''
    for (const word of [
      /missed/i,
      /streak/i,
      /0%/,
      /failed/i,
      /behind/i,
      /don't break/i,
      /keep it up/i,
    ]) {
      expect(text, String(word)).not.toMatch(word)
    }
  })

  it('still shows the Foundation overview with zero history', async () => {
    await renderProgress()
    await screen.findByText('No workouts recorded yet')

    expect(screen.getByText('Foundation 100')).toBeInTheDocument()
    expect(screen.getByText('Day 1 / 100')).toBeInTheDocument()
  })

  it('reports zero totals rather than hiding them', async () => {
    await renderProgress()
    await screen.findByText('No workouts recorded yet')

    const totals = screen.getByText('Recorded training').closest('div')!
    expect(within(totals).getByText('Workouts')).toBeInTheDocument()
    expect(within(totals).getAllByText('0').length).toBeGreaterThanOrEqual(4)
  })
})

/* ------------------------------------------------------------------ */
/* Foundation overview                                                 */
/* ------------------------------------------------------------------ */

describe('3. Foundation overview', () => {
  it('shows Day 1 on the start date', async () => {
    await renderProgress()
    expect(await screen.findByText('Day 1 / 100')).toBeInTheDocument()
    expect(foundationPhase()).toBe('foundation')
  })

  it('shows upcoming before the start, with no day number', async () => {
    vi.setSystemTime(new Date(2026, 7, 29, 9, 0))
    await renderProgress()

    expect(await screen.findByText('Foundation upcoming')).toBeInTheDocument()
    expect(foundationPhase()).toBe('upcoming')
    expect(screen.getByText(/Starts in 2 days/)).toBeInTheDocument()
    expect(screen.queryByText(/Day 0/)).toBeNull()
  })

  it('shows Day 100 on the accepted end date', async () => {
    vi.setSystemTime(new Date(2026, 11, 8, 9, 0))
    await renderProgress()
    expect(await screen.findByText('Day 100 / 100')).toBeInTheDocument()
  })

  it('keeps counting past Day 100 without implying an ending', async () => {
    vi.setSystemTime(new Date(2026, 11, 9, 9, 0))
    await renderProgress()

    expect(await screen.findByText('Day 101')).toBeInTheDocument()
    expect(foundationPhase()).toBe('beyond')
    expect(document.body.textContent).not.toMatch(/finished|complete!|the end/i)
  })
})

/* ------------------------------------------------------------------ */
/* Recorded history                                                    */
/* ------------------------------------------------------------------ */

describe('4. recorded history', () => {
  it('lists recorded workouts newest first', async () => {
    seedWorkout({ date: '2026-08-31', total: 4, completed: 4, startedAt: 1 })
    seedWorkout({
      date: '2026-09-02',
      sessionId: 'wednesday',
      day: 'Wednesday',
      focus: 'Light Back + Rear Delts + Core',
      intensity: 'LIGHT',
      total: 2,
      completed: 2,
      startedAt: 2,
    })
    await renderProgress()

    const card = await awaitHistoryCard()
    const items = within(card).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('2 Sep 2026')
    expect(items[1].textContent).toContain('31 Aug 2026')
  })

  it('shows the day, date, focus and intensity of a recorded workout', async () => {
    seedWorkout({ date: '2026-08-31', total: 4, completed: 4 })
    await renderProgress()

    const card = await awaitHistoryCard()
    expect(within(card).getByText(/Monday/)).toBeInTheDocument()
    expect(within(card).getByText('31 Aug 2026')).toBeInTheDocument()
    expect(within(card).getByText('Back Width + Biceps')).toBeInTheDocument()
    expect(within(card).getByText('HARD')).toBeInTheDocument()
  })

  it('reports totals across recorded history', async () => {
    seedWorkout({ date: '2026-08-31', total: 4, completed: 3, skipped: 1 })
    seedWorkout({ date: '2026-09-01', total: 2, completed: 1, skipped: 0, startedAt: 2 })
    await renderProgress()

    await screen.findByText('Recorded training')
    const totals = screen.getByText('Recorded training').closest('div')!
    expect(within(totals).getByText('Workouts').nextSibling).toHaveTextContent('2')
    expect(within(totals).getByText('Total sets').nextSibling).toHaveTextContent('6')
    expect(within(totals).getByText('Completed').nextSibling).toHaveTextContent('4')
    expect(within(totals).getByText('Skipped').nextSibling).toHaveTextContent('1')
  })

  /**
   * The totals headline counts every expected set row a Start created, so it
   * includes sets that are still pending. It must therefore not be described
   * as work that was logged.
   */
  it('counts pending sets in the total without calling them logged', async () => {
    // 7 expected sets: 3 completed, 1 skipped, 3 still pending.
    seedWorkout({ date: '2026-08-31', total: 4, completed: 2, skipped: 1 })
    seedWorkout({ date: '2026-09-01', total: 3, completed: 1, skipped: 0, startedAt: 2 })
    await renderProgress()

    await screen.findByText('Recorded training')
    const totals = screen.getByText('Recorded training').closest('div')!

    // The total includes the 3 pending rows.
    expect(within(totals).getByText('Total sets').nextSibling).toHaveTextContent('7')
    // Completed and skipped stay their own separate facts.
    expect(within(totals).getByText('Completed').nextSibling).toHaveTextContent('3')
    expect(within(totals).getByText('Skipped').nextSibling).toHaveTextContent('1')
    // 3 + 1 = 4 resolved, so 3 of the 7 were never touched.
    expect(within(totals).queryByText('Sets logged')).toBeNull()

    // And nowhere on the page are those 7 described as logged.
    const page = document.querySelector('main')?.textContent ?? ''
    expect(page).not.toMatch(/sets logged/i)
    expect(page).not.toMatch(/7 (sets )?logged/i)
    // The per-workout rows still report the untouched sets as pending:
    // 4 sets = 2 completed + 1 skipped + 1 pending, and 3 = 1 completed + 2 pending.
    const card = await awaitHistoryCard()
    expect(within(card).getByText(/2 completed · 1 skipped · 1 pending/)).toBeInTheDocument()
    expect(within(card).getByText(/1 completed · 2 pending/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* Honest incompleteness                                               */
/* ------------------------------------------------------------------ */

describe('5. honest incompleteness', () => {
  it('reports pending sets rather than calling a workout done', async () => {
    seedWorkout({ date: '2026-08-31', total: 4, completed: 1 })
    await renderProgress()

    const card = await awaitHistoryCard()
    expect(within(card).getByText('1 / 4 sets resolved')).toBeInTheDocument()
    expect(within(card).getByText(/1 completed · 3 pending/)).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/perfect/i)
  })

  it('shows completed and skipped separately, never merged', async () => {
    seedWorkout({ date: '2026-08-31', total: 4, completed: 3, skipped: 1 })
    await renderProgress()

    const card = await awaitHistoryCard()
    expect(within(card).getByText(/3 completed · 1 skipped/)).toBeInTheDocument()
    // Resolved is traversal, so it may equal the total while 3 were trained.
    expect(within(card).getByText('All 4 sets resolved')).toBeInTheDocument()
  })

  it('does not report a fully skipped workout as trained', async () => {
    seedWorkout({ date: '2026-08-31', total: 3, completed: 0, skipped: 3 })
    await renderProgress()

    const card = await awaitHistoryCard()
    expect(within(card).getByText('All 3 sets resolved')).toBeInTheDocument()
    // The completed count is the fact that matters, and it is zero.
    expect(within(card).getByText(/0 completed · 3 skipped/)).toBeInTheDocument()

    const totals = screen.getByText('Recorded training').closest('div')!
    expect(within(totals).getByText('Completed').nextSibling).toHaveTextContent('0')
    expect(within(totals).getByText('Skipped').nextSibling).toHaveTextContent('3')
  })

  it('includes a started workout with nothing logged', async () => {
    seedWorkout({ date: '2026-08-31', total: 4 })
    await renderProgress()

    const card = await awaitHistoryCard()
    expect(within(card).getByText('0 / 4 sets resolved')).toBeInTheDocument()
    expect(within(card).getByText(/0 completed · 4 pending/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* Semantic boundary                                                   */
/* ------------------------------------------------------------------ */

describe('6. reports only what was recorded', () => {
  /*
   * Round 15 moved two of these out of the banned list on purpose: Progress
   * now owns Body Weight and Personal Best. Everything else stays banned, and
   * the progression vocabulary is banned harder — reporting what happened is
   * Round 15's whole scope, and recommending what to do next is Round 16's.
   */
  it('shows no streak, holiday, achievement or progression surface', async () => {
    seedWorkout({ date: '2026-08-31', total: 4, completed: 4 })
    await renderProgress()
    await awaitHistoryCard()

    // Scoped to the page: the shell's own nav legitimately links Calendar and
    // Achievements, which are other rounds' surfaces, not Progress content.
    const text = document.querySelector('main')?.textContent ?? ''
    for (const banned of [
      /streak/i,
      /holiday/i,
      /achievement/i,
      /adherence/i,
      /double progression/i,
      /missed/i,
      /next load/i,
      /deload/i,
      // Round 15 additions: no invented score, and no advice.
      /1\s?rm/i,
      /estimated/i,
      /tonnage/i,
      /suggest/i,
      /recommend/i,
      /you should/i,
      /try adding/i,
    ]) {
      expect(text, String(banned)).not.toMatch(banned)
    }
  })

  it('never infers a workout that was not recorded', async () => {
    // One recorded workout in a week that has five training days.
    seedWorkout({ date: '2026-08-31', total: 4, completed: 4 })
    await renderProgress()

    const card = await awaitHistoryCard()
    // Exactly one row — nothing is invented for the days with no occurrence.
    expect(within(card).getAllByRole('listitem')).toHaveLength(1)
    const totals = screen.getByText('Recorded training').closest('div')!
    expect(within(totals).getByText('Workouts').nextSibling).toHaveTextContent('1')
  })
})

/* ------------------------------------------------------------------ */
/* Structure and accessibility                                         */
/* ------------------------------------------------------------------ */

describe('7. structure', () => {
  it('exposes the Foundation day to assistive technology', async () => {
    await renderProgress()
    const bar = await screen.findByRole('progressbar', { name: 'Foundation day' })
    expect(bar).toHaveAttribute('aria-valuenow', '1')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('renders recent workouts as a list', async () => {
    seedWorkout({ date: '2026-08-31', total: 4, completed: 4 })
    await renderProgress()

    const card = await awaitHistoryCard()
    expect(within(card).getByRole('list')).toBeInTheDocument()
  })

  it('uses fluid layout classes rather than fixed widths', async () => {
    seedWorkout({ date: '2026-08-31', total: 4, completed: 4 })
    await renderProgress()
    await awaitHistoryCard()

    // A fixed pixel width anywhere in the page body is what produces
    // horizontal overflow on a narrow screen.
    const fixed = [...document.querySelectorAll('main *')].filter((el) =>
      /(^|\s)w-\[\d+px\]/.test(el.className.toString()),
    )
    expect(fixed).toHaveLength(0)
  })

  it('requests a bounded page of history', async () => {
    await renderProgress()
    await screen.findByText('No workouts recorded yet')

    const historyCalls = server.calls.filter((call) => call.url.includes('/history'))
    expect(historyCalls.length).toBeGreaterThan(0)
    // No unbounded read: the server's own default bound applies.
    expect(historyCalls[0].method).toBe('GET')
  })
})
