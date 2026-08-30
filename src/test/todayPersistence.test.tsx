import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createTodayServer, type TodayServer } from './todayApiTestUtils'

/**
 * Round 04 — Today completion persistence.
 *
 * These run the real client, the real hook and the real Today engine against
 * an in-memory stand-in for the API, so hydration, persistence, idempotency
 * and failure handling are exercised end to end.
 */

const MINUTE = 60_000
const TICK = MINUTE + 100

const MONDAY_GYM = '2026-09-07:gym-training'
const MONDAY_SLEEP = '2026-09-07:ready-to-sleep'
const TUESDAY_SLEEP = '2026-09-08:ready-to-sleep'

function setNow(year: number, month: number, day: number, hours: number, minutes = 0) {
  vi.setSystemTime(new Date(year, month, day, hours, minutes, 0, 0))
}

function tick(minutes: number) {
  act(() => {
    vi.advanceTimersByTime(TICK + (minutes - 1) * MINUTE)
  })
}

let server: TodayServer
let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  setItem = vi.spyOn(Storage.prototype, 'setItem')
  server = createTodayServer()
  mockAuthFetch({ session: authenticatedSession, today: server })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

function region(name: string) {
  return within(screen.getByRole('region', { name }))
}

/** Render Today and wait for saved progress to finish loading. */
async function renderToday() {
  const router = renderApp('/today')
  await screen.findByRole('heading', { name: 'Today', level: 1 })
  await waitFor(() =>
    expect(screen.queryByText(/Loading your saved progress/)).not.toBeInTheDocument(),
  )
  return router
}

function gets() {
  return server.calls.filter((call) => call.method === 'GET')
}

function writes() {
  return server.calls.filter((call) => call.method !== 'GET')
}

describe('14–15. hydration from the server', () => {
  it('shows a saved completion as done on first load', async () => {
    server.rows.add(MONDAY_GYM)
    setNow(2026, 8, 7, 20, 45)
    await renderToday()

    expect(region('Done earlier').getByText('Gym training')).toBeInTheDocument()
    expect(
      region('Done earlier').getByRole('button', { name: 'Undo Gym training' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('asks the server for the days Today can show', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    // The reference day plus the previous day, which is the only one that can
    // still be running past midnight.
    expect(gets()[0].url).toContain('from=2026-09-06')
    expect(gets()[0].url).toContain('to=2026-09-07')
  })

  it('restores the completion again after a remount (refresh)', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    await user().click(screen.getByRole('button', { name: 'Complete Gym training' }))
    await screen.findByRole('region', { name: 'Done earlier' })
    expect(server.rows.has(MONDAY_GYM)).toBe(true)

    // Tear the app down and mount it again — exactly what a refresh does.
    cleanup()
    await renderToday()

    expect(region('Done earlier').getByText('Gym training')).toBeInTheDocument()
  })

  it('holds the completion controls until saved progress has loaded', async () => {
    // holdReads, not hold: the stand-in's `hold` gates writes only, so this
    // previously relied on catching the first render frame before the read
    // resolved. Since Round 11 the routine waits for the day's Holiday state,
    // so that frame is gone — the read is now genuinely held instead, which is
    // what the test always meant.
    const release = server.holdReads()
    server.rows.add(MONDAY_GYM)
    setNow(2026, 8, 7, 20, 45)
    renderApp('/today')
    await screen.findByRole('heading', { name: 'Today', level: 1 })

    // Nothing is claimed either way while the read is in flight.
    expect(await screen.findByText(/Loading your saved progress/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Gym training' })).toBeDisabled()

    release()
    await waitFor(() =>
      expect(screen.queryByText(/Loading your saved progress/)).not.toBeInTheDocument(),
    )
    expect(region('Done earlier').getByText('Gym training')).toBeInTheDocument()
  })

  it('re-reads for the new day when the calendar day changes', async () => {
    setNow(2026, 8, 7, 23, 59)
    await renderToday()
    expect(gets()).toHaveLength(1)

    tick(2) // 00:01 on Tuesday

    await waitFor(() => expect(gets()).toHaveLength(2))
    expect(gets()[1].url).toContain('from=2026-09-07')
    expect(gets()[1].url).toContain('to=2026-09-08')
  })
})

describe('16–17. saving and undoing', () => {
  it('persists a completion and updates the UI', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()

    await user().click(screen.getByRole('button', { name: 'Complete Gym training' }))

    await screen.findByRole('region', { name: 'Done earlier' })
    expect(server.rows.has(MONDAY_GYM)).toBe(true)
    expect(writes()).toEqual([
      {
        method: 'PUT',
        key: MONDAY_GYM,
        // The key is percent-encoded into the path, never interpolated raw.
        url: '/api/today/completions/2026-09-07%3Agym-training',
      },
    ])
  })

  it('persists an undo and updates the UI', async () => {
    server.rows.add(MONDAY_GYM)
    setNow(2026, 8, 7, 20, 45)
    await renderToday()

    await user().click(
      region('Done earlier').getByRole('button', { name: 'Undo Gym training' }),
    )

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Done earlier' })).not.toBeInTheDocument(),
    )
    expect(server.rows.has(MONDAY_GYM)).toBe(false)
    expect(writes().map((call) => call.method)).toEqual(['DELETE'])
  })

  it('never uses browser storage', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    await user().click(screen.getByRole('button', { name: 'Complete Gym training' }))
    await screen.findByRole('region', { name: 'Done earlier' })

    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })
})

describe('18–19. a failed write never leaves false state', () => {
  it('does not show a false completion when Mark done fails', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    server.failMutations()

    await user().click(screen.getByRole('button', { name: 'Complete Gym training' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn’t save/)
    expect(screen.getByRole('alert')).toHaveTextContent(/Gym training/)
    // Still not done, on screen and on the server.
    expect(screen.queryByRole('region', { name: 'Done earlier' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Complete Gym training' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(server.rows.has(MONDAY_GYM)).toBe(false)
  })

  it('does not show a false undo when Undo fails', async () => {
    server.rows.add(MONDAY_GYM)
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    server.failMutations()

    await user().click(
      region('Done earlier').getByRole('button', { name: 'Undo Gym training' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn’t undo/)
    // Still done, on screen and on the server.
    expect(region('Done earlier').getByText('Gym training')).toBeInTheDocument()
    expect(server.rows.has(MONDAY_GYM)).toBe(true)
  })

  it('lets the user retry after a failed write', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    server.failMutations()

    const person = user()
    await person.click(screen.getByRole('button', { name: 'Complete Gym training' }))
    await screen.findByRole('alert')

    // The next attempt succeeds and clears the error.
    await person.click(screen.getByRole('button', { name: 'Complete Gym training' }))
    await screen.findByRole('region', { name: 'Done earlier' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(server.rows.has(MONDAY_GYM)).toBe(true)
  })

  it('lets the user dismiss the failure notice', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    server.failMutations()

    const person = user()
    await person.click(screen.getByRole('button', { name: 'Complete Gym training' }))
    await screen.findByRole('alert')

    await person.click(screen.getByRole('button', { name: /Dismiss/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('20. hydration failure is honest and retryable', () => {
  it('says so instead of pretending nothing is completed', async () => {
    server.rows.add(MONDAY_GYM)
    server.failHydration()
    setNow(2026, 8, 7, 20, 45)
    renderApp('/today')
    await screen.findByRole('heading', { name: 'Today', level: 1 })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Couldn’t load your saved progress/)
    // Crucially, the saved completion is NOT rendered as unfinished work.
    expect(screen.queryByRole('region', { name: 'Done earlier' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Gym training' })).toBeDisabled()
  })

  it('keeps the rest of Today usable', async () => {
    server.failHydration()
    setNow(2026, 8, 7, 20, 45)
    renderApp('/today')
    await screen.findByRole('heading', { name: 'Today', level: 1 })
    await screen.findByRole('alert')

    expect(screen.getByRole('heading', { name: 'Gym training', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Later today' })).toBeInTheDocument()
  })

  it('recovers when the user retries', async () => {
    server.rows.add(MONDAY_GYM)
    server.failHydration()
    setNow(2026, 8, 7, 20, 45)
    renderApp('/today')
    await screen.findByRole('heading', { name: 'Today', level: 1 })
    await screen.findByRole('alert')

    await user().click(screen.getByRole('button', { name: /Try again/ }))

    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    )
    expect(region('Done earlier').getByText('Gym training')).toBeInTheDocument()
    expect(gets()).toHaveLength(2)
  })
})

describe('21–22. previous-day spillover keeps its own key', () => {
  it('saves the spillover under yesterday’s anchor day', async () => {
    setNow(2026, 8, 8, 0, 15) // Tuesday 00:15 — Monday's 23:30–00:30 block
    await renderToday()

    expect(screen.getByRole('heading', { name: 'Ready to sleep', level: 2 })).toBeInTheDocument()
    // Both the spillover and tonight's own block are on screen, so target the
    // hero — the one that is currently running.
    await user().click(screen.getByText('Mark done'))
    await screen.findByRole('region', { name: 'Done earlier' })

    expect([...server.rows]).toEqual([MONDAY_SLEEP])
    expect(server.rows.has(TUESDAY_SLEEP)).toBe(false)
  })

  it('hydrates the spillover from yesterday’s key', async () => {
    server.rows.add(MONDAY_SLEEP)
    setNow(2026, 8, 8, 0, 15)
    await renderToday()

    // The spillover is done; tonight's own block is still ahead.
    expect(region('Done earlier').getByText('Ready to sleep')).toBeInTheDocument()
    expect(region('Later today').getByText('Ready to sleep')).toBeInTheDocument()
  })

  it('does not let tonight’s completion mark the spillover done', async () => {
    server.rows.add(TUESDAY_SLEEP)
    setNow(2026, 8, 8, 0, 15)
    await renderToday()

    // Tonight's block is done; the one still running is not.
    expect(region('Done earlier').getByText('Ready to sleep')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Ready to sleep', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Mark done')).toBeInTheDocument()
  })
})

describe('23–24. duplicate taps cannot double-write', () => {
  it('ignores a second tap while the write is in flight', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()

    const release = server.hold()
    const button = screen.getByRole('button', { name: 'Complete Gym training' })
    await user().click(button)

    // The control reports itself busy and refuses further taps.
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    fireEvent.click(button)

    release()
    await screen.findByRole('region', { name: 'Done earlier' })

    expect(writes()).toHaveLength(1)
    expect(server.rows.size).toBe(1)
  })

  it('shows a saving state on the hero button', async () => {
    setNow(2026, 8, 7, 20, 45)
    await renderToday()

    const release = server.hold()
    await user().click(screen.getByRole('button', { name: 'Complete Gym training' }))
    expect(await screen.findByText('Saving…')).toBeInTheDocument()

    release()
    await screen.findByRole('region', { name: 'Done earlier' })
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument()
  })

  it('stays a single row even if the same write lands twice', async () => {
    // Server-side idempotency, independent of the UI guard.
    setNow(2026, 8, 7, 20, 45)
    await renderToday()
    const person = user()

    await person.click(screen.getByRole('button', { name: 'Complete Gym training' }))
    await screen.findByRole('region', { name: 'Done earlier' })
    await person.click(
      region('Done earlier').getByRole('button', { name: 'Undo Gym training' }),
    )
    await waitFor(() => expect(server.rows.size).toBe(0))
    await person.click(screen.getByRole('button', { name: 'Complete Gym training' }))
    await screen.findByRole('region', { name: 'Done earlier' })

    expect(server.rows.size).toBe(1)
  })
})
