import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgressServer, type ProgressServer } from './progressApiTestUtils'

/**
 * Round 15 — Personal Best and Exercise Performance on Progress.
 *
 * The client's job is to RENDER what the server derived over all of history.
 * It must never re-rank, never convert a unit, and never draw a trend it does
 * not have the points for. When the server says it could not read the whole
 * history, nothing is shown at all — a best that is merely too low looks
 * exactly like a correct one.
 */

const TODAY = new Date(2026, 7, 31, 9, 0)

let server: ProgressServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(TODAY)
  server = createProgressServer()
  mockAuthFetch({ session: authenticatedSession, progress: server })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const pbCard = () => document.querySelector('[data-personal-best]') as HTMLElement | null
const perfCard = () =>
  document.querySelector('[data-exercise-performance]') as HTMLElement | null

const pbState = () => pbCard()?.getAttribute('data-personal-best-state') ?? null

type PointFixture = { date: string; sessionId?: string; loadValue?: number | null; result: number }

function variant(over: {
  key: string
  exerciseId?: string
  exerciseName?: string
  resultKind?: 'reps' | 'seconds'
  loadMode?: 'none' | 'kg' | 'kg_each'
  perSide?: boolean
  points: PointFixture[]
  bestIndex?: number
}) {
  const points = over.points.map((point) => ({
    date: point.date,
    sessionId: point.sessionId ?? 'monday',
    loadValue: point.loadValue ?? null,
    result: point.result,
  }))
  return {
    key: over.key,
    exerciseId: over.exerciseId ?? over.key,
    exerciseName: over.exerciseName ?? 'Lat Pulldown',
    resultKind: over.resultKind ?? 'reps',
    loadMode: over.loadMode ?? 'kg',
    perSide: over.perSide ?? false,
    personalBest: points[over.bestIndex ?? points.length - 1] ?? null,
    points,
    lastPerformed: points[points.length - 1]?.date ?? '',
  }
}

function seed(variants: unknown[]) {
  server.setPerformance({ complete: true, examined: 99, variants })
}

async function renderProgress() {
  renderApp('/progress')
  await screen.findByRole('heading', { level: 1, name: 'Progress' })
  await waitFor(() => expect(pbState()).not.toBe('loading'))
  return userEvent.setup()
}

/* ------------------------------------------------------------------ */
/* 1. Personal Best                                                    */
/* ------------------------------------------------------------------ */

describe('1. personal best', () => {
  it('shows the best set with the date it was first reached', async () => {
    seed([
      variant({
        key: 'lat',
        exerciseName: 'Lat Pulldown',
        points: [
          { date: '2026-08-03', loadValue: 45, result: 10 },
          { date: '2026-08-24', loadValue: 50, result: 8 },
        ],
      }),
    ])
    await renderProgress()

    const card = pbCard() as HTMLElement
    expect(within(card).getByText('Lat Pulldown')).toBeInTheDocument()
    expect(within(card).getByText('50 kg × 8 reps')).toBeInTheDocument()
    expect(within(card).getByText('24 Aug 2026')).toBeInTheDocument()
  })

  it('never doubles a per-dumbbell load into a total', async () => {
    seed([
      variant({
        key: 'db',
        exerciseName: 'DB Press',
        loadMode: 'kg_each',
        points: [{ date: '2026-08-24', loadValue: 20, result: 10 }],
      }),
    ])
    await renderProgress()

    const card = pbCard() as HTMLElement
    expect(within(card).getByText('20 kg each × 10 reps')).toBeInTheDocument()
    // 40 kg would be a different measurement entirely.
    expect(card.textContent).not.toMatch(/40/)
    expect(card.textContent).toMatch(/per dumbbell/i)
  })

  it('keeps per-side visible rather than folding it into a total', async () => {
    seed([
      variant({
        key: 'row',
        exerciseName: 'One-Arm Row',
        perSide: true,
        points: [{ date: '2026-08-24', loadValue: 24, result: 10 }],
      }),
    ])
    await renderProgress()

    expect(within(pbCard() as HTMLElement).getByText('24 kg × 10 reps / side')).toBeInTheDocument()
  })

  it('shows a timed best in seconds with no load traded in', async () => {
    seed([
      variant({
        key: 'plank',
        exerciseName: 'Plank',
        resultKind: 'seconds',
        loadMode: 'none',
        points: [{ date: '2026-08-24', result: 75 }],
      }),
    ])
    await renderProgress()

    const card = pbCard() as HTMLElement
    expect(within(card).getByText('75s')).toBeInTheDocument()
    expect(card.textContent).toMatch(/timed/i)
  })

  it('shows an unloaded best as reps alone', async () => {
    seed([
      variant({
        key: 'pushup',
        exerciseName: 'Push-Up',
        loadMode: 'none',
        points: [{ date: '2026-08-24', result: 22 }],
      }),
    ])
    await renderProgress()

    expect(within(pbCard() as HTMLElement).getByText('22 reps')).toBeInTheDocument()
  })

  it('shows nothing at all when the history could not be fully read', async () => {
    server.setPerformance({ complete: false, reason: 'truncated', variants: [] })
    await renderProgress()

    const card = pbCard() as HTMLElement
    expect(pbState()).toBe('incomplete')
    // Not an empty state, and certainly not a number.
    expect(card.textContent).toMatch(/full history could not be read/i)
    expect(card.textContent).not.toMatch(/no completed sets recorded yet/i)
    expect(card.textContent).not.toMatch(/\d+ kg/)
  })

  it('says so when the request fails, and offers a retry', async () => {
    server.failWith(500)
    const user = await renderProgress()

    expect(pbState()).toBe('error')
    server.failWith(null)
    seed([variant({ key: 'lat', points: [{ date: '2026-08-24', loadValue: 50, result: 8 }] })])

    await user.click(within(pbCard() as HTMLElement).getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(pbState()).toBe('ready'))
    expect(pbCard()?.textContent).toMatch(/50 kg/)
  })

  it('reports an empty history honestly', async () => {
    await renderProgress()
    expect(pbCard()?.textContent).toMatch(/no completed sets recorded yet/i)
  })

  it('collapses a long list behind an expander', async () => {
    seed(
      Array.from({ length: 9 }, (_, index) =>
        variant({
          key: `lift-${index}`,
          exerciseName: `Lift ${index}`,
          points: [{ date: `2026-08-0${(index % 9) + 1}`, loadValue: 40 + index, result: 8 }],
        }),
      ),
    )
    const user = await renderProgress()

    const card = pbCard() as HTMLElement
    expect(within(card).queryByText('Lift 8')).toBeNull()

    const expander = within(card).getByRole('button', { name: /show all 9 exercises/i })
    expect(expander).toHaveAttribute('aria-expanded', 'false')
    await user.click(expander)

    expect(within(card).getByText('Lift 8')).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* 2. Exercise performance                                             */
/* ------------------------------------------------------------------ */

describe('2. exercise performance', () => {
  it('offers a labelled selector of exercises with completed history', async () => {
    seed([
      variant({ key: 'a', exerciseName: 'Lat Pulldown', points: [{ date: '2026-08-24', loadValue: 50, result: 8 }] }),
      variant({ key: 'b', exerciseName: 'Leg Press', points: [{ date: '2026-08-10', loadValue: 120, result: 10 }] }),
    ])
    await renderProgress()

    const select = screen.getByLabelText(/^exercise$/i)
    // A native select: focusable, operable by keyboard, and named.
    expect(select.tagName).toBe('SELECT')
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Lat Pulldown',
      'Leg Press',
    ])
  })

  it('preserves the server most-recent-first ordering', async () => {
    // The server sorts; the client must not re-sort into its own idea of order.
    seed([
      variant({ key: 'recent', exerciseName: 'Recent Lift', points: [{ date: '2026-08-24', loadValue: 50, result: 8 }] }),
      variant({ key: 'old', exerciseName: 'Ancient Lift', points: [{ date: '2020-01-05', loadValue: 50, result: 8 }] }),
    ])
    await renderProgress()

    const options = within(screen.getByLabelText(/^exercise$/i)).getAllByRole('option')
    expect(options[0]).toHaveTextContent('Recent Lift')
  })

  it('keeps measurement variants of one exercise as separate choices', async () => {
    seed([
      variant({ key: 'db|kg', exerciseId: 'db', exerciseName: 'DB Press', loadMode: 'kg', points: [{ date: '2026-08-24', loadValue: 30, result: 10 }] }),
      variant({ key: 'db|each', exerciseId: 'db', exerciseName: 'DB Press', loadMode: 'kg_each', points: [{ date: '2026-08-20', loadValue: 20, result: 10 }] }),
    ])
    await renderProgress()

    const labels = within(screen.getByLabelText(/^exercise$/i))
      .getAllByRole('option')
      .map((option) => option.textContent)

    // Two choices, and the one that is per dumbbell says so.
    expect(labels).toHaveLength(2)
    expect(labels.some((label) => /per dumbbell/i.test(label ?? ''))).toBe(true)
  })

  it('shows one real result and no trend line for a single workout', async () => {
    seed([variant({ key: 'a', points: [{ date: '2026-08-24', loadValue: 50, result: 8 }] })])
    await renderProgress()

    const card = perfCard() as HTMLElement
    expect(card.textContent).toMatch(/50 kg × 8 reps/)
    expect(card.textContent).toMatch(/not enough history for a trend yet/i)
    // Nothing drawn at all rather than a line through one point.
    expect(card.querySelector('[data-trend-chart]')).toBeNull()
  })

  it('draws a real trend once there are two or more workouts', async () => {
    seed([
      variant({
        key: 'a',
        points: [
          { date: '2026-08-03', loadValue: 45, result: 10 },
          { date: '2026-08-10', loadValue: 47.5, result: 8 },
          { date: '2026-08-17', loadValue: 47.5, result: 10 },
          { date: '2026-08-24', loadValue: 50, result: 8 },
        ],
      }),
    ])
    await renderProgress()

    const card = perfCard() as HTMLElement
    expect(card.querySelectorAll('[data-trend-chart] circle')).toHaveLength(4)
    expect(card.querySelectorAll('[data-trend-chart] path')).toHaveLength(1)
    expect(card.textContent).toMatch(/4 workouts recorded/i)
  })

  it('lists every plotted workout as accessible data', async () => {
    seed([
      variant({
        key: 'a',
        points: [
          { date: '2026-08-03', loadValue: 45, result: 10 },
          { date: '2026-08-24', loadValue: 50, result: 8 },
        ],
      }),
    ])
    const user = await renderProgress()

    const card = perfCard() as HTMLElement
    await user.click(within(card).getByText(/show the 2 recorded values/i))

    const table = within(card).getByRole('table')
    expect(within(table).getByText('45 kg × 10 reps')).toBeInTheDocument()
    expect(within(table).getByText('50 kg × 8 reps')).toBeInTheDocument()
  })

  it('switches the chart when another exercise is selected', async () => {
    seed([
      variant({ key: 'a', exerciseName: 'Lat Pulldown', points: [{ date: '2026-08-24', loadValue: 50, result: 8 }, { date: '2026-08-25', loadValue: 52.5, result: 8 }] }),
      variant({ key: 'b', exerciseName: 'Leg Press', points: [{ date: '2026-08-10', loadValue: 120, result: 10 }, { date: '2026-08-11', loadValue: 130, result: 10 }] }),
    ])
    const user = await renderProgress()

    await user.selectOptions(screen.getByLabelText(/^exercise$/i), 'b')

    const card = perfCard() as HTMLElement
    await waitFor(() => expect(card.textContent).toMatch(/last performed 11 Aug 2026/i))
    expect(card.textContent).not.toMatch(/52\.5/)
  })

  it('never invents a point between two distant workouts', async () => {
    seed([
      variant({
        key: 'a',
        points: [
          { date: '2026-01-05', loadValue: 45, result: 10 },
          { date: '2026-08-24', loadValue: 50, result: 8 },
        ],
      }),
    ])
    await renderProgress()

    // Almost eight months apart, exactly two dots.
    expect((perfCard() as HTMLElement).querySelectorAll('[data-trend-chart] circle')).toHaveLength(2)
  })

  it('reports an empty history honestly', async () => {
    await renderProgress()
    expect(perfCard()?.textContent).toMatch(/no completed sets recorded yet/i)
  })

  it('shows no trend when the history could not be fully read', async () => {
    server.setPerformance({ complete: false, reason: 'unreadable', variants: [] })
    await renderProgress()

    expect(perfCard()?.textContent).toMatch(/full history could not be read/i)
    expect(perfCard()?.querySelector('[data-trend-chart]')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 3. Round boundaries                                                 */
/* ------------------------------------------------------------------ */

describe('3. reporting only', () => {
  it('offers no progression advice anywhere on the page', async () => {
    seed([
      variant({
        key: 'a',
        points: [
          { date: '2026-08-03', loadValue: 45, result: 10 },
          { date: '2026-08-24', loadValue: 50, result: 8 },
        ],
      }),
    ])
    await renderProgress()

    const text = document.querySelector('main')?.textContent ?? ''
    for (const banned of [
      /next time/i,
      /next load/i,
      /add \d+ reps/i,
      /increase the load/i,
      /recommend/i,
      /suggest/i,
      /double progression/i,
      /you should/i,
      /1\s?rm/i,
      /tonnage/i,
      /estimated/i,
    ]) {
      expect(text, String(banned)).not.toMatch(banned)
    }
  })

  it('adds no new top-level destination', async () => {
    seed([variant({ key: 'a', points: [{ date: '2026-08-24', loadValue: 50, result: 8 }] })])
    await renderProgress()

    const navLabels = screen
      .getAllByRole('link')
      .map((link) => link.textContent?.trim().toLowerCase() ?? '')

    // Body weight and Personal Best are sections of Progress, not tabs.
    for (const banned of ['body', 'personal best', 'analytics', 'weight']) {
      expect(navLabels, banned).not.toContain(banned)
    }
  })

  it('keeps the existing Progress sections intact', async () => {
    seed([variant({ key: 'a', points: [{ date: '2026-08-24', loadValue: 50, result: 8 }] })])
    await renderProgress()

    const text = document.querySelector('main')?.textContent ?? ''
    // Round 10 and Round 12 truth is still on the page.
    expect(text).toMatch(/foundation 100/i)
    expect(text).toMatch(/recorded training/i)
    expect(text).toMatch(/recent workouts/i)
  })
})
