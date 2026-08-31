import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgressServer, type ProgressServer } from './progressApiTestUtils'

/**
 * Round 15 — the Body Weight section of Progress.
 *
 * The things worth defending here are the honest ones: a single measurement
 * must not grow a trend, a missing day must not become a point, and a failed
 * save must not look like a successful one.
 */

/** Day 1 of Foundation, so the page's other sections behave predictably. */
const TODAY = new Date(2026, 7, 31, 9, 0)
const TODAY_DATE = '2026-08-31'

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

const card = () => document.querySelector('[data-body-weight]') as HTMLElement | null
const state = () => card()?.getAttribute('data-body-weight-state') ?? null

/*
 * userEvent drives the FAKE clock rather than waiting on the real one. Without
 * this, every keystroke and click sits through its own real delay, which turns
 * a form test into seconds of wall time and loads the whole parallel run.
 */
async function renderProgress() {
  renderApp('/progress')
  await screen.findByRole('heading', { level: 1, name: 'Progress' })
  await waitFor(() => expect(state()).not.toBe('loading'))
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

/* ------------------------------------------------------------------ */
/* 1. Empty and single-measurement states                              */
/* ------------------------------------------------------------------ */

describe('1. honest states', () => {
  it('says nothing has been recorded rather than showing a zero', async () => {
    await renderProgress()

    const text = card()?.textContent ?? ''
    // The default window is 90 days, so the empty message says exactly that
    // and points at All rather than claiming nothing was ever recorded.
    expect(text).toMatch(/no measurements in the last 90 days/i)
    // "0.0 kg" would be a measurement that never happened.
    expect(text).not.toMatch(/0\.0 kg/)
  })

  it('refuses to compare a single measurement', async () => {
    server.seedWeight(TODAY_DATE, 784)
    await renderProgress()

    const text = card()?.textContent ?? ''
    expect(text).toMatch(/78\.4/)
    // Neither change can be computed from one point, and neither is shown as
    // 0.0 — "no change" would be a claim about a comparison never made.
    expect(text).toMatch(/needs two measurements/i)
    expect(text).not.toMatch(/\+0\.0/)
  })

  it('draws no trend line through a single point', async () => {
    server.seedWeight(TODAY_DATE, 784)
    await renderProgress()

    expect(card()?.textContent).toMatch(/not enough for a trend yet/i)
    // One dot, no path: a line needs two real points.
    expect(card()?.querySelectorAll('[data-trend-chart] circle')).toHaveLength(1)
    expect(card()?.querySelectorAll('[data-trend-chart] path')).toHaveLength(0)
  })

  it('draws a line once there are two real points', async () => {
    server.seedWeight('2026-08-01', 800)
    server.seedWeight(TODAY_DATE, 784)
    await renderProgress()

    expect(card()?.querySelectorAll('[data-trend-chart] circle')).toHaveLength(2)
    expect(card()?.querySelectorAll('[data-trend-chart] path')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Changes                                                          */
/* ------------------------------------------------------------------ */

describe('2. changes are exact and signed', () => {
  it('reports a loss with an explicit minus', async () => {
    server.seedWeight('2026-08-01', 800)
    server.seedWeight('2026-08-20', 790)
    server.seedWeight(TODAY_DATE, 784)
    await renderProgress()

    const text = card()?.textContent ?? ''
    expect(text).toMatch(/-0\.6/)
    expect(text).toMatch(/-1\.6/)
  })

  it('reports a gain with an explicit plus', async () => {
    server.seedWeight('2026-08-01', 780)
    server.seedWeight(TODAY_DATE, 795)
    await renderProgress()

    expect(card()?.textContent).toMatch(/\+1\.5/)
  })

  it('has no float residue on a one-tenth difference', async () => {
    // 78.5 - 78.4 as floats is 0.09999999999999432.
    server.seedWeight('2026-08-01', 785)
    server.seedWeight(TODAY_DATE, 784)
    await renderProgress()

    const text = card()?.textContent ?? ''
    expect(text).toMatch(/-0\.1/)
    expect(text).not.toMatch(/0\.09999/)
  })

  it('reports an unchanged weight as exactly zero', async () => {
    server.seedWeight('2026-08-01', 784)
    server.seedWeight(TODAY_DATE, 784)
    await renderProgress()

    // Two measurements that agree IS a comparison, and its answer is 0.0.
    expect(card()?.textContent).toMatch(/unchanged from/i)
  })

  it('shows one decimal place, always', async () => {
    server.seedWeight(TODAY_DATE, 780)
    await renderProgress()
    // 78.0, not 78 — the precision shown is the precision stored.
    expect(card()?.textContent).toMatch(/78\.0/)
  })
})

/* ------------------------------------------------------------------ */
/* 3. Windows                                                          */
/* ------------------------------------------------------------------ */

describe('3. 30D / 90D / All', () => {
  it('offers all three windows as pressable controls', async () => {
    await renderProgress()
    const group = screen.getByRole('group', { name: /measurement window/i })

    for (const label of ['30D', '90D', 'All']) {
      expect(within(group).getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('excludes a measurement older than the window', async () => {
    server.seedWeight('2020-01-01', 900)
    server.seedWeight(TODAY_DATE, 784)
    const user = await renderProgress()

    await user.click(screen.getByRole('button', { name: '30D' }))
    await waitFor(() => expect(card()?.textContent).toMatch(/1 measurement(?!s)/))

    // The 2020 measurement is outside 30 days and is simply not in the window.
    expect(card()?.textContent).not.toMatch(/90\.0/)
  })

  it('includes older measurements under All', async () => {
    server.seedWeight('2020-01-01', 900)
    server.seedWeight(TODAY_DATE, 784)
    const user = await renderProgress()

    await user.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(card()?.textContent).toMatch(/2 measurements/))
  })

  it('marks the selected window for assistive technology', async () => {
    const user = await renderProgress()
    await user.click(screen.getByRole('button', { name: '30D' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '30D' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('says a bounded window is empty rather than reaching further back', async () => {
    server.seedWeight('2020-01-01', 900)
    const user = await renderProgress()

    await user.click(screen.getByRole('button', { name: '30D' }))
    await waitFor(() => expect(card()?.textContent).toMatch(/no measurements in the last/i))
    expect(card()?.textContent).not.toMatch(/90\.0/)
  })
})

/* ------------------------------------------------------------------ */
/* 4. Writing                                                          */
/* ------------------------------------------------------------------ */

describe('4. adding and correcting', () => {
  async function type(user: ReturnType<typeof userEvent.setup>, value: string) {
    const field = screen.getByLabelText(/weight \(kg\)/i)
    await user.clear(field)
    await user.type(field, value)
  }

  it('defaults the date to the local today', async () => {
    await renderProgress()
    expect(screen.getByLabelText(/^date$/i)).toHaveValue(TODAY_DATE)
  })

  it('cannot offer a future date', async () => {
    await renderProgress()
    // The control itself refuses, before anything is sent.
    expect(screen.getByLabelText(/^date$/i)).toHaveAttribute('max', TODAY_DATE)
  })

  it('saves a measurement and reports success', async () => {
    const user = await renderProgress()
    await type(user, '78.4')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))

    await waitFor(() => expect(card()?.textContent).toMatch(/saved/i))
    expect(card()?.textContent).toMatch(/78\.4/)
  })

  it('sends the browser own timezone with the write', async () => {
    const user = await renderProgress()
    await type(user, '78.4')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))

    await waitFor(() => expect(server.calls.some((call) => call.method === 'PUT')).toBe(true))
    const write = server.calls.find((call) => call.method === 'PUT')
    // Without it the server cannot tell a valid local Today from the future.
    expect((write?.body as { timezone: string }).timezone.length).toBeGreaterThan(0)
  })

  it('refuses more than one decimal place before sending anything', async () => {
    const user = await renderProgress()
    await type(user, '78.45')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/at most one decimal place/i)
    // Refused locally, and not silently rounded to 78.5.
    expect(server.calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('refuses an empty or zero weight', async () => {
    const user = await renderProgress()

    await user.click(screen.getByRole('button', { name: /add measurement/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(server.calls.some((call) => call.method === 'PUT')).toBe(false)

    await type(user, '0')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))
    expect(server.calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('marks the field invalid for assistive technology', async () => {
    const user = await renderProgress()
    await type(user, '78.45')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))

    await waitFor(() =>
      expect(screen.getByLabelText(/weight \(kg\)/i)).toHaveAttribute('aria-invalid', 'true'),
    )
  })

  it('updates an existing date instead of adding a second entry', async () => {
    server.seedWeight(TODAY_DATE, 784)
    const user = await renderProgress()

    // The field is pre-filled with what is stored, and the button says Update.
    await waitFor(() => expect(screen.getByLabelText(/weight \(kg\)/i)).toHaveValue(78.4))
    const update = screen.getByRole('button', { name: /^update$/i })

    await type(user, '77.9')
    await user.click(update)

    await waitFor(() => expect(card()?.textContent).toMatch(/77\.9/))
    // Still one measurement for that day, not two contradictory ones.
    expect(card()?.textContent).toMatch(/1 measurement(?!s)/)
  })

  it('reports a failed save without claiming it worked', async () => {
    const user = await renderProgress()
    await type(user, '78.4')
    server.failWith(500)
    await user.click(screen.getByRole('button', { name: /add measurement/i }))

    await waitFor(() =>
      expect(card()?.textContent).toMatch(/could not save that measurement/i),
    )
    expect(card()?.textContent).not.toMatch(/saved 31 aug/i)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Deleting                                                         */
/* ------------------------------------------------------------------ */

describe('5. deleting', () => {
  it('asks before deleting, naming exactly what will go', async () => {
    server.seedWeight(TODAY_DATE, 784)
    const user = await renderProgress()

    await user.click(screen.getByRole('button', { name: /delete this measurement/i }))

    expect(card()?.textContent).toMatch(/delete the 78\.4 kg measurement on 31 Aug 2026/i)
    // Nothing has been sent yet.
    expect(server.calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('deletes only after the confirmation is pressed', async () => {
    server.seedWeight(TODAY_DATE, 784)
    const user = await renderProgress()

    await user.click(screen.getByRole('button', { name: /delete this measurement/i }))
    await user.click(screen.getByRole('button', { name: /delete it/i }))

    await waitFor(() => expect(card()?.textContent).toMatch(/no measurements in the last/i))
    const removed = server.calls.find((call) => call.method === 'DELETE')
    expect(removed?.url).toContain(TODAY_DATE)
  })

  it('can be backed out of', async () => {
    server.seedWeight(TODAY_DATE, 784)
    const user = await renderProgress()

    await user.click(screen.getByRole('button', { name: /delete this measurement/i }))
    await user.click(screen.getByRole('button', { name: /keep it/i }))

    expect(server.calls.some((call) => call.method === 'DELETE')).toBe(false)
    expect(card()?.textContent).toMatch(/78\.4/)
  })

  it('offers no delete for a date with no measurement', async () => {
    await renderProgress()
    expect(screen.queryByRole('button', { name: /delete this measurement/i })).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 6. The chart is not the only copy                                   */
/* ------------------------------------------------------------------ */

describe('6. accessible data', () => {
  it('offers every plotted value as a real table', async () => {
    server.seedWeight('2026-08-01', 800)
    server.seedWeight('2026-08-20', 790)
    server.seedWeight(TODAY_DATE, 784)
    const user = await renderProgress()

    await user.click(screen.getByText(/show the 3 recorded values/i))

    const table = within(card() as HTMLElement).getByRole('table')
    expect(within(table).getByText('80.0 kg')).toBeInTheDocument()
    expect(within(table).getByText('79.0 kg')).toBeInTheDocument()
    expect(within(table).getByText('78.4 kg')).toBeInTheDocument()
  })

  it('hides the drawing from assistive technology', async () => {
    server.seedWeight('2026-08-01', 800)
    server.seedWeight(TODAY_DATE, 784)
    await renderProgress()

    // The numbers are in the table; the SVG is decoration.
    expect(card()?.querySelector('[data-trend-chart]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('lists exactly the measurements that exist, with no filled days', async () => {
    server.seedWeight('2026-08-01', 800)
    server.seedWeight(TODAY_DATE, 784)
    const user = await renderProgress()

    await user.click(screen.getByText(/show the 2 recorded values/i))

    const table = within(card() as HTMLElement).getByRole('table')
    // Thirty days apart, two rows. Nothing was interpolated between them.
    expect(within(table).getAllByRole('row')).toHaveLength(3) // header + 2
  })

  it('survives a flat series where every value is equal', async () => {
    server.seedWeight('2026-08-01', 784)
    server.seedWeight('2026-08-15', 784)
    server.seedWeight(TODAY_DATE, 784)
    await renderProgress()

    // No division by a zero span, and three real dots on one line.
    const circles = card()?.querySelectorAll('[data-trend-chart] circle') ?? []
    expect(circles).toHaveLength(3)
    for (const circle of circles) {
      expect(Number(circle.getAttribute('cy'))).toBeCloseTo(60, 5)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 7. Failure                                                          */
/* ------------------------------------------------------------------ */

describe('7. when the read fails', () => {
  it('says so instead of showing an empty history', async () => {
    server.failWith(500)
    await renderProgress()

    expect(state()).toBe('error')
    // "No measurements" would be a claim we cannot make.
    expect(card()?.textContent).toMatch(/could not load your measurements/i)
    expect(card()?.textContent).not.toMatch(/no measurements recorded yet/i)
  })

  it('offers a retry that actually re-reads', async () => {
    server.failWith(500)
    const user = await renderProgress()

    server.failWith(null)
    server.seedWeight(TODAY_DATE, 784)
    await user.click(within(card() as HTMLElement).getByRole('button', { name: /try again/i }))

    await waitFor(() => expect(state()).toBe('ready'))
    expect(card()?.textContent).toMatch(/78\.4/)
  })
})
