import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'

/**
 * Today page behaviour, driven through the real route tree.
 *
 * The system clock is faked, so "20:29 → 20:30 flips the current item" is
 * asserted for real: timers advance, the clock controller wakes, and the page
 * recomputes. Nothing is re-rendered by hand and nothing is refreshed.
 */

const MINUTE = 60_000
/** The clock controller fires just after each boundary. */
const TICK = MINUTE + 100

function setNow(year: number, month: number, day: number, hours: number, minutes = 0) {
  vi.setSystemTime(new Date(year, month, day, hours, minutes, 0, 0))
}

function tick(minutes: number) {
  act(() => {
    vi.advanceTimersByTime(TICK + (minutes - 1) * MINUTE)
  })
}

let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // `shouldAdvanceTime` keeps the faked clock ticking in real time. Testing
  // Library's async helpers only recognise Jest's fake timers, so without it
  // their own (faked) polling timers never fire and every `findBy*` hangs.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  setItem = vi.spyOn(Storage.prototype, 'setItem')
  mockAuthFetch({ session: authenticatedSession })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

async function renderToday() {
  const router = renderApp('/today')
  await screen.findByRole('heading', { name: 'Today', level: 1 })
  return router
}

function region(name: string) {
  return within(screen.getByRole('region', { name }))
}

describe('Today — the day it renders', () => {
  it('leads with the item that is happening now', async () => {
    setNow(2026, 8, 7, 20, 45) // Monday
    await renderToday()
    expect(screen.getByRole('heading', { name: 'Gym training', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('20:30 – 21:30')).toBeInTheDocument()
    expect(screen.getByText(/Home Mode/)).toBeInTheDocument()
  })

  it('shows the live clock', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    expect(screen.getByText('20:45')).toBeInTheDocument()
  })

  it('leads with the closest upcoming item when nothing is current', async () => {
    setNow(2026, 8, 7, 6, 0) // Monday, before Wake up
    await renderToday()
    expect(screen.getByRole('heading', { name: 'Wake up', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('in 1 h 30')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Needs attention' })).not.toBeInTheDocument()
  })

  it('keeps unfinished overdue work in a needs-attention section', async () => {
    setNow(2026, 8, 7, 22, 15) // Monday, most of the day gone
    await renderToday()
    const late = region('Needs attention')
    expect(late.getByText('Gym training')).toBeInTheDocument()
    expect(late.getByText('Work')).toBeInTheDocument()
  })

  it('links the gym slot to the day’s training session', async () => {
    setNow(2026, 8, 7, 20, 45)
    const router = await renderToday()
    await user().click(screen.getByRole('link', { name: /Open session/ }))
    expect(router.state.location.pathname).toBe('/training/monday')
  })
})

describe('Today — manual completion', () => {
  it('completes and undoes an item', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    const person = user()

    await person.click(screen.getByRole('button', { name: 'Complete Gym training' }))
    expect(region('Done earlier').getByText('Gym training')).toBeInTheDocument()

    await person.click(
      region('Done earlier').getByRole('button', { name: 'Undo Gym training' }),
    )
    expect(screen.queryByRole('region', { name: 'Done earlier' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Gym training', level: 2 })).toBeInTheDocument()
  })

  it('reports completion state on the control itself', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    const toggle = screen.getByRole('button', { name: 'Complete Gym training' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user().click(toggle)
    expect(
      region('Done earlier').getByRole('button', { name: 'Undo Gym training' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('promotes the next item once the current one is done', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    await user().click(screen.getByRole('button', { name: 'Complete Gym training' }))
    expect(
      screen.getByRole('heading', { name: 'Shower + rest', level: 2 }),
    ).toBeInTheDocument()
  })

  it('clears a late item out of needs-attention when completed', async () => {
    setNow(2026, 8, 7, 22, 15)
    await renderToday()
    expect(region('Needs attention').getByText('Gym training')).toBeInTheDocument()

    await user().click(screen.getByRole('button', { name: 'Complete Gym training' }))
    expect(region('Done earlier').getByText('Gym training')).toBeInTheDocument()
    expect(region('Needs attention').queryByText('Gym training')).not.toBeInTheDocument()
  })

  it('keeps completion in memory only — no browser storage is written', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    await user().click(screen.getByRole('button', { name: 'Complete Gym training' }))

    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })
})

describe('Today — live time recomputation', () => {
  it('flips the current item at the boundary without a refresh', async () => {
    setNow(2026, 8, 7, 20, 29)
    await renderToday()
    expect(
      screen.getByRole('heading', { name: 'Dinner + Netflix', level: 2 }),
    ).toBeInTheDocument()

    tick(1) // 20:30

    expect(screen.getByRole('heading', { name: 'Gym training', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('20:30')).toBeInTheDocument()
  })

  it('never completes an item just because its time ran out', async () => {
    setNow(2026, 8, 7, 20, 29)
    await renderToday()

    tick(62) // 21:31 — the gym hour has been and gone, untouched

    const late = region('Needs attention')
    expect(late.getByText('Gym training')).toBeInTheDocument()
    expect(
      late.getByRole('button', { name: 'Complete Gym training' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('region', { name: 'Done earlier' })).not.toBeInTheDocument()
  })

  it('keeps a manually completed item done as time moves on', async () => {
    setNow(2026, 8, 7, 20, 29)
    await renderToday()
    await user().click(screen.getByRole('button', { name: 'Complete Dinner + Netflix' }))

    tick(62)

    expect(region('Done earlier').getByText('Dinner + Netflix')).toBeInTheDocument()
    expect(region('Needs attention').queryByText('Dinner + Netflix')).not.toBeInTheDocument()
  })
})

describe('Today — routes and flexible items', () => {
  it('uses the Saturday chill route with no gym', async () => {
    setNow(2026, 8, 12, 18, 0) // Saturday
    await renderToday()
    expect(screen.getByText(/Chill route/)).toBeInTheDocument()
    expect(screen.queryByText('Gym training')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Chill / Netflix / rest', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('After work · flexible')).toBeInTheDocument()
  })

  it("shows Saturday's after-midnight sleep block in Saturday's own terms", async () => {
    setNow(2026, 8, 12, 18, 0)
    await renderToday()
    expect(screen.getByText('01:00 – 03:00')).toBeInTheDocument()
    expect(screen.getByText(/after midnight/)).toBeInTheDocument()
  })

  it('uses the Sunday recovery route and never invents clock times', async () => {
    setNow(2026, 8, 13, 19, 0) // Sunday evening
    await renderToday()
    expect(screen.getByText(/Recovery route/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Room reset', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Evening · 1 hour')).toBeInTheDocument()
    expect(screen.getByText('No alarm')).toBeInTheDocument()
    // Sunday accepted no exact times, so it contributes no clock range. The
    // only one on screen belongs to Saturday's 01:00–03:00 block, which
    // spilled past midnight into Sunday.
    expect(screen.getAllByText(/^\d{2}:\d{2} – \d{2}:\d{2}$/).map((el) => el.textContent))
      .toEqual(['01:00 – 03:00'])
  })

  it('shows a second simultaneous item rather than hiding it', async () => {
    setNow(2026, 8, 13, 19, 0)
    await renderToday()
    expect(region('Also now').getByText('Free time / Netflix / rest')).toBeInTheDocument()
  })

  it("marks Saturday's leftovers as yesterday's, not Sunday's", async () => {
    setNow(2026, 8, 13, 19, 0)
    await renderToday()
    const late = region('Needs attention')
    expect(late.getByText('Chill / Netflix / rest')).toBeInTheDocument()
    expect(late.getAllByText('· yesterday')).toHaveLength(2)
  })

  it("carries the previous day's block past midnight", async () => {
    setNow(2026, 8, 8, 0, 15) // Tuesday 00:15 — Monday's 23:30–00:30 block
    await renderToday()
    expect(
      screen.getByRole('heading', { name: 'Ready to sleep', level: 2 }),
    ).toBeInTheDocument()
    // Monday's block is current; Tuesday's own is still ahead. Two distinct
    // occurrences of the same routine item.
    expect(screen.getAllByText('23:30 – 00:30')).toHaveLength(2)
    expect(screen.getByText('from yesterday')).toBeInTheDocument()
    expect(screen.getByText(/Tuesday/)).toBeInTheDocument()
  })
})
