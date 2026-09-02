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
  inputType?: 'weight_kg' | 'resistance_band' | 'bodyweight'
  band?: { label: string; count: number }
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
    // Defaults follow the load mode, exactly as a pre-Round-20 row would be
    // read: kilograms meant kilograms, and no load meant bodyweight.
    inputType:
      over.inputType ?? ((over.loadMode ?? 'kg') === 'none' ? 'bodyweight' : 'weight_kg'),
    band: over.band ?? null,
    personalBest: points[over.bestIndex ?? points.length - 1] ?? null,
    points,
    lastPerformed: points[points.length - 1]?.date ?? '',
  }
}

function seed(variants: unknown[]) {
  server.setPerformance({ complete: true, examined: 99, variants })
}

/*
 * userEvent drives the FAKE clock rather than waiting on the real one. Without
 * this, every keystroke and click sits through its own real delay, which turns
 * a form test into seconds of wall time and loads the whole parallel run.
 */
async function renderProgress() {
  renderApp('/progress')
  await screen.findByRole('heading', { level: 1, name: 'Progress' })
  await waitFor(() => expect(pbState()).not.toBe('loading'))
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
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

    const expander = within(card).getByRole('button', { name: /show all 9 results/i })
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

    // Two choices, and neither reads the same as the other.
    expect(labels).toHaveLength(2)
    expect(new Set(labels).size).toBe(2)
    expect(labels).toEqual([
      'DB Press (kg · reps)',
      'DB Press (kg each · reps)',
    ])
  })

  /*
   * The data already separates variants by exerciseId + resultKind + loadMode
   * + perSide. What must also be true is that a PERSON can tell them apart: a
   * kg variant and an unloaded variant of one exercise have nothing
   * individually notable about either, and would otherwise render as two
   * identical choices meaning different things.
   */
  it('gives every variant of one exercise a distinct accessible name', async () => {
    seed([
      variant({
        key: 'x|reps|kg|both',
        exerciseId: 'exercise-x',
        exerciseName: 'Exercise X',
        loadMode: 'kg',
        points: [{ date: '2026-08-24', loadValue: 50, result: 8 }],
      }),
      variant({
        key: 'x|reps|none|both',
        exerciseId: 'exercise-x',
        exerciseName: 'Exercise X',
        loadMode: 'none',
        points: [{ date: '2026-08-20', result: 20 }],
      }),
    ])
    await renderProgress()

    const options = within(screen.getByLabelText(/^exercise$/i)).getAllByRole('option')
    const names = options.map((option) => option.textContent ?? '')

    expect(names).toHaveLength(2)
    // The exact wording is a UI choice; that the two differ is not.
    expect(new Set(names).size).toBe(2)
    for (const name of names) expect(name).toMatch(/Exercise X \(/)
    expect(names.some((name) => /no load/i.test(name))).toBe(true)
    expect(names.some((name) => /\bkg\b/i.test(name))).toBe(true)
  })

  it('distinguishes per-side from both-sides for one exercise', async () => {
    seed([
      variant({
        key: 'row|side',
        exerciseId: 'row',
        exerciseName: 'Row',
        perSide: true,
        points: [{ date: '2026-08-24', loadValue: 24, result: 10 }],
      }),
      variant({
        key: 'row|both',
        exerciseId: 'row',
        exerciseName: 'Row',
        perSide: false,
        points: [{ date: '2026-08-20', loadValue: 24, result: 10 }],
      }),
    ])
    await renderProgress()

    const names = within(screen.getByLabelText(/^exercise$/i))
      .getAllByRole('option')
      .map((option) => option.textContent ?? '')

    expect(new Set(names).size).toBe(2)
    expect(names.some((name) => /per side/i.test(name))).toBe(true)
  })

  it('distinguishes reps from timed for one exercise', async () => {
    seed([
      variant({
        key: 'hold|reps',
        exerciseId: 'hold',
        exerciseName: 'Hold',
        loadMode: 'none',
        resultKind: 'reps',
        points: [{ date: '2026-08-24', result: 12 }],
      }),
      variant({
        key: 'hold|seconds',
        exerciseId: 'hold',
        exerciseName: 'Hold',
        loadMode: 'none',
        resultKind: 'seconds',
        points: [{ date: '2026-08-20', result: 60 }],
      }),
    ])
    await renderProgress()

    const names = within(screen.getByLabelText(/^exercise$/i))
      .getAllByRole('option')
      .map((option) => option.textContent ?? '')

    expect(new Set(names).size).toBe(2)
    expect(names.some((name) => /timed/i.test(name))).toBe(true)
  })

  it('leaves a single-variant exercise reading as just its name', async () => {
    seed([
      variant({
        key: 'solo',
        exerciseId: 'solo',
        exerciseName: 'Lat Pulldown',
        points: [{ date: '2026-08-24', loadValue: 50, result: 8 }],
      }),
    ])
    await renderProgress()

    // Nothing to disambiguate, so nothing is added.
    expect(
      within(screen.getByLabelText(/^exercise$/i)).getByRole('option').textContent,
    ).toBe('Lat Pulldown')
  })

  it('distinguishes the rows in Personal Best too', async () => {
    seed([
      variant({
        key: 'x|reps|kg|both',
        exerciseId: 'exercise-x',
        exerciseName: 'Exercise X',
        loadMode: 'kg',
        points: [{ date: '2026-08-24', loadValue: 50, result: 8 }],
      }),
      variant({
        key: 'x|reps|none|both',
        exerciseId: 'exercise-x',
        exerciseName: 'Exercise X',
        loadMode: 'none',
        points: [{ date: '2026-08-20', result: 20 }],
      }),
    ])
    await renderProgress()

    const rows = [...((pbCard() as HTMLElement).querySelectorAll('li') ?? [])].map(
      (row) => row.textContent ?? '',
    )

    expect(rows).toHaveLength(2)
    // Both name the exercise, and each says which measurement it is.
    expect(rows.some((row) => /no load/i.test(row))).toBe(true)
    expect(rows.some((row) => /kg · reps/i.test(row))).toBe(true)
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

  it('says that the line shows load, not the whole set', async () => {
    // 50 kg x 8 then 50 kg x 10 draws FLAT, because the line carries load. The
    // second set was better, so the chart has to say which half it is drawing
    // rather than letting a flat shape imply nothing changed.
    seed([
      variant({
        key: 'a',
        points: [
          { date: '2026-08-03', loadValue: 50, result: 8 },
          { date: '2026-08-24', loadValue: 50, result: 10 },
        ],
      }),
    ])
    const user = await renderProgress()

    const card = perfCard() as HTMLElement
    expect(card.textContent).toMatch(/the line shows load/i)

    // And the reps it does not draw are one keystroke away.
    await user.click(within(card).getByText(/show the 2 recorded values/i))
    const table = within(card).getByRole('table')
    expect(within(table).getByText('50 kg × 8 reps')).toBeInTheDocument()
    expect(within(table).getByText('50 kg × 10 reps')).toBeInTheDocument()
  })

  it('says nothing extra when the line already is the whole result', async () => {
    seed([
      variant({
        key: 'plank',
        exerciseName: 'Plank',
        resultKind: 'seconds',
        loadMode: 'none',
        points: [
          { date: '2026-08-03', result: 45 },
          { date: '2026-08-24', result: 75 },
        ],
      }),
    ])
    await renderProgress()

    // A timed hold has one axis, so there is nothing to disclaim.
    expect(perfCard()?.textContent).not.toMatch(/the line shows/i)
  })

  it('drops a point whose date cannot be read rather than drawing it at day zero', async () => {
    server.setPerformance({
      complete: true,
      variants: [
        {
          key: 'a',
          exerciseId: 'a',
          exerciseName: 'Lat Pulldown',
          resultKind: 'reps',
          loadMode: 'kg',
          perSide: false,
          inputType: 'weight_kg',
          band: null,
          personalBest: { date: '2026-08-24', sessionId: 'monday', loadValue: 50, result: 8 },
          points: [
            { date: 'yesterday', sessionId: 'monday', loadValue: 45, result: 10 },
            { date: '2026-08-17', sessionId: 'monday', loadValue: 47.5, result: 9 },
            { date: '2026-08-24', sessionId: 'monday', loadValue: 50, result: 8 },
          ],
          lastPerformed: '2026-08-24',
        },
      ],
    })
    await renderProgress()

    // Two readable points are drawn; the unreadable one is not placed at the
    // epoch, where it would drag the whole axis with it.
    expect((perfCard() as HTMLElement).querySelectorAll('[data-trend-chart] circle')).toHaveLength(
      2,
    )
  })

  /*
   * A loaded chart plots LOAD. A point with no recorded load has nothing to
   * put on that axis, and substituting its rep count would place kilograms and
   * repetitions on one line — a 30-rep set at no weight would tower over a
   * 50 kg one. The server already excludes these; the client refuses to draw
   * one if it ever arrived.
   */
  it('never plots a rep count on a loaded chart axis', async () => {
    server.setPerformance({
      complete: true,
      variants: [
        {
          key: 'a',
          exerciseId: 'a',
          exerciseName: 'Lat Pulldown',
          resultKind: 'reps',
          loadMode: 'kg',
          perSide: false,
          inputType: 'weight_kg',
          band: null,
          personalBest: { date: '2026-08-24', sessionId: 'monday', loadValue: 50, result: 8 },
          points: [
            { date: '2026-08-03', sessionId: 'monday', loadValue: 45, result: 10 },
            // No load, and a rep count far larger than any of the loads.
            { date: '2026-08-10', sessionId: 'monday', loadValue: null, result: 30 },
            { date: '2026-08-24', sessionId: 'monday', loadValue: 50, result: 8 },
          ],
          lastPerformed: '2026-08-24',
        },
      ],
    })
    const user = await renderProgress()

    const card = perfCard() as HTMLElement
    const circles = [...card.querySelectorAll('[data-trend-chart] circle')]

    // Two dots, not three: the loadless workout is not a point on this chart.
    expect(circles).toHaveLength(2)

    // And the axis still spans 45 to 50, so nothing was scaled by a 30 that
    // meant repetitions.
    await user.click(within(card).getByText(/show the 2 recorded values/i))
    const table = within(card).getByRole('table')
    expect(within(table).getByText('45 kg × 10 reps')).toBeInTheDocument()
    expect(within(table).getByText('50 kg × 8 reps')).toBeInTheDocument()
    expect(within(table).queryByText(/30 reps/)).toBeNull()
  })

  it('drops a loaded personal best that carries no load', async () => {
    server.setPerformance({
      complete: true,
      variants: [
        {
          key: 'a',
          exerciseId: 'a',
          exerciseName: 'Lat Pulldown',
          resultKind: 'reps',
          loadMode: 'kg',
          perSide: false,
          // A best with no load is not a best.
          personalBest: { date: '2026-08-10', sessionId: 'monday', loadValue: null, result: 30 },
          points: [{ date: '2026-08-03', sessionId: 'monday', loadValue: 45, result: 10 }],
          lastPerformed: '2026-08-03',
        },
      ],
    })
    await renderProgress()

    const card = pbCard() as HTMLElement
    // The row renders nothing rather than "30 reps" where a load belongs.
    expect(card.textContent).not.toMatch(/30 reps/)
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

/* ------------------------------------------------------------------ */
/* 4. Round 20 — band work on the Progress page                        */
/* ------------------------------------------------------------------ */

/*
 * The user's Triceps Pushdown history is the shape this section defends: rows
 * recorded before Round 20 that say "3 kg" because the count of bands went into
 * the weight column, and rows recorded after it that say "Black x3". They are
 * different measurements of different things, and the page must never present
 * them as one series or claim a best across both.
 */
describe('4. band work', () => {
  it('writes a band best as its band and reps, never as kilograms', async () => {
    seed([
      variant({
        key: 'triceps|band',
        exerciseId: 'triceps-pushdown',
        exerciseName: 'Triceps Pushdown',
        loadMode: 'none',
        inputType: 'resistance_band',
        band: { label: 'Black', count: 3 },
        points: [
          { date: '2026-09-08', result: 12 },
          { date: '2026-09-15', result: 15 },
        ],
      }),
    ])
    await renderProgress()

    const card = pbCard() as HTMLElement
    expect(within(card).getByText('Black ×3 · 15 reps')).toBeInTheDocument()
    // The word that must not appear anywhere near this exercise.
    expect(card.textContent).not.toMatch(/kg/i)
  })

  it('keeps the legacy kilogram history and the band history apart on screen', async () => {
    seed([
      variant({
        key: 'triceps|band',
        exerciseId: 'triceps-pushdown',
        exerciseName: 'Triceps Pushdown',
        loadMode: 'none',
        inputType: 'resistance_band',
        band: { label: 'Black', count: 3 },
        points: [{ date: '2026-09-08', result: 12 }],
      }),
      variant({
        key: 'triceps|kg',
        exerciseId: 'triceps-pushdown',
        exerciseName: 'Triceps Pushdown',
        loadMode: 'kg',
        points: [{ date: '2026-09-01', loadValue: 3, result: 12 }],
      }),
    ])
    await renderProgress()

    const labels = within(screen.getByLabelText(/^exercise$/i))
      .getAllByRole('option')
      .map((option) => option.textContent)

    // Two choices, each saying which measurement it is. Neither can be read as
    // a continuation of the other.
    expect(labels).toHaveLength(2)
    expect(labels).toContain('Triceps Pushdown (Black ×3 · reps)')
    expect(labels).toContain('Triceps Pushdown (kg · reps)')
  })

  it('drops a variant whose modality the server did not state', async () => {
    // A build that cannot name the measurement shows nothing rather than
    // rendering "50 kg" for something that may not have been kilograms.
    server.setPerformance({
      complete: true,
      variants: [
        {
          key: 'unnamed',
          exerciseId: 'triceps-pushdown',
          exerciseName: 'Triceps Pushdown',
          resultKind: 'reps',
          loadMode: 'kg',
          perSide: false,
          personalBest: { date: '2026-09-01', sessionId: 'tuesday', loadValue: 3, result: 12 },
          points: [{ date: '2026-09-01', sessionId: 'tuesday', loadValue: 3, result: 12 }],
          lastPerformed: '2026-09-01',
        },
      ],
    })
    await renderProgress()

    expect(screen.queryByText('Triceps Pushdown')).not.toBeInTheDocument()
  })

  it('describes a Personal Best in modality-neutral terms', async () => {
    seed([
      variant({
        key: 'triceps|band',
        exerciseId: 'triceps-pushdown',
        exerciseName: 'Triceps Pushdown',
        loadMode: 'none',
        inputType: 'resistance_band',
        band: { label: 'Black', count: 3 },
        points: [{ date: '2026-09-08', result: 12 }],
      }),
    ])
    await renderProgress()

    const card = pbCard() as HTMLElement
    // "The heaviest set you have completed" was true when kilograms were the
    // only thing the app could store. A band best is the most REPS within one
    // exact setup, and a bodyweight best likewise.
    expect(within(card).getByText(/best completed set in each comparable measurement/i))
      .toBeInTheDocument()
    expect(card.textContent).not.toMatch(/heaviest/i)
  })

  it('counts RESULTS rather than claiming a false number of exercises', async () => {
    // One canonical exercise, three comparable variants. Calling this "3
    // exercises" would misstate what the user actually trains.
    seed([
      variant({
        key: 'triceps|kg', exerciseId: 'triceps-pushdown', exerciseName: 'Triceps Pushdown',
        points: [{ date: '2026-09-01', loadValue: 3, result: 12 }],
      }),
      variant({
        key: 'triceps|black', exerciseId: 'triceps-pushdown', exerciseName: 'Triceps Pushdown',
        loadMode: 'none', inputType: 'resistance_band', band: { label: 'Black', count: 3 },
        points: [{ date: '2026-09-08', result: 12 }],
      }),
      variant({
        key: 'triceps|red', exerciseId: 'triceps-pushdown', exerciseName: 'Triceps Pushdown',
        loadMode: 'none', inputType: 'resistance_band', band: { label: 'Red', count: 2 },
        points: [{ date: '2026-09-15', result: 14 }],
      }),
      ...Array.from({ length: 4 }, (_unused, index) =>
        variant({
          key: `other-${index}`,
          exerciseId: `other-${index}`,
          exerciseName: `Other ${index}`,
          points: [{ date: '2026-09-01', loadValue: 20, result: 10 }],
        }),
      ),
    ])
    await renderProgress()

    const card = pbCard() as HTMLElement
    expect(within(card).getByRole('button', { name: /show all 7 results/i })).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/7 exercises/i)
  })
})
