import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { msUntilNextLocalMidnight } from '@/features/progress/useLocalToday'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgressServer, type ProgressServer } from './progressApiTestUtils'

/**
 * Round 15 production correction — local midnight, while the page stays open.
 *
 * Found in production, not by these tests: a Progress tab opened on 31 August
 * still offered 31 August as Today after Kuala Lumpur had crossed into
 * 1 September, and only a reload corrected it. The server was never at risk —
 * it validates against the request's own zone — but the field stops defaulting
 * to Today the moment the clock passes midnight, and a tab left open overnight
 * is the ordinary case rather than an exotic one.
 *
 * Two ways the date can move, and they must behave differently:
 *
 *   the clock moved      the field should follow, because it was showing Today
 *   the person moved it  the field must stay put, because they chose that date
 */

/** 23:59 local on the last day of August. */
const BEFORE_MIDNIGHT = new Date(2026, 7, 31, 23, 59, 0)
const YESTERDAY = '2026-08-31'
const TOMORROW = '2026-09-01'

let server: ProgressServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(BEFORE_MIDNIGHT)
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
const dateField = () => screen.getByLabelText(/^date$/i) as HTMLInputElement
const weightField = () => screen.getByLabelText(/weight \(kg\)/i) as HTMLInputElement

async function renderProgress() {
  renderApp('/progress')
  await screen.findByRole('heading', { level: 1, name: 'Progress' })
  // The card must actually be present, not merely "not loading" — an absent
  // card also reads as not-loading and would let a test run before the form,
  // and its effects, exist at all.
  await waitFor(() => expect(state()).toBe('ready'))
  // One more flush so the form's effects — including the midnight listeners —
  // have attached before a test starts moving the clock underneath them.
  await act(async () => {
    await Promise.resolve()
  })
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

/** Let the clock reach the given local time and run the timers it passes. */
async function passTime(to: Date) {
  const delta = to.getTime() - Date.now()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(delta)
  })
}

/**
 * A tab that was asleep: the clock moved on, but its timers did not run.
 * Waking it fires the visibility event a browser fires on resume.
 */
async function sleepThroughTo(to: Date) {
  vi.setSystemTime(to)
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/* ------------------------------------------------------------------ */
/* The wait itself                                                     */
/* ------------------------------------------------------------------ */

describe('0. waiting for midnight rather than polling for it', () => {
  it('waits until just past the next local midnight', () => {
    // 23:59:00 -> one minute, plus the guard that lands past the boundary.
    expect(msUntilNextLocalMidnight(new Date(2026, 7, 31, 23, 59, 0))).toBe(60_000 + 250)
  })

  it('waits nearly a whole day just after midnight', () => {
    const justAfter = msUntilNextLocalMidnight(new Date(2026, 8, 1, 0, 0, 1))
    // A single wait, not a poll: no second thoughts for almost 24 hours.
    expect(justAfter).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(justAfter).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 250)
  })

  it('carries the month and the year over', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 11, 31, 23, 59, 59))).toBe(1_000 + 250)
  })

  it('never returns a spin or an absurd wait, even if the clock jumped', () => {
    // A clock moved backwards must not produce a zero-length timer.
    expect(msUntilNextLocalMidnight(new Date(2026, 7, 31, 23, 59, 59, 900))).toBeGreaterThanOrEqual(
      250,
    )
    expect(msUntilNextLocalMidnight(new Date(2026, 7, 31, 0, 0, 0))).toBeLessThanOrEqual(
      25 * 60 * 60 * 1000,
    )
  })
})

/* ------------------------------------------------------------------ */
/* A + B. Mounted across the boundary                                  */
/* ------------------------------------------------------------------ */

describe('A. mounted at 23:59', () => {
  it('defaults to today and refuses to offer tomorrow', async () => {
    await renderProgress()

    expect(dateField()).toHaveValue(YESTERDAY)
    expect(dateField()).toHaveAttribute('max', YESTERDAY)
  })
})

describe('B. the clock crosses midnight while mounted', () => {
  it('advances the default date without a reload', async () => {
    await renderProgress()
    expect(dateField()).toHaveValue(YESTERDAY)

    await passTime(new Date(2026, 8, 1, 0, 0, 30))

    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))
  })

  it('advances the max, so the new day can actually be chosen', async () => {
    await renderProgress()
    await passTime(new Date(2026, 8, 1, 0, 0, 30))

    // Without this the control itself would refuse the only date that is now
    // valid.
    await waitFor(() => expect(dateField()).toHaveAttribute('max', TOMORROW))
  })

  it('does not need a remount to be correct', async () => {
    await renderProgress()
    await passTime(new Date(2026, 8, 1, 0, 0, 30))

    // Same mounted tree throughout: no navigation, no reload.
    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))
    expect(screen.getByRole('heading', { level: 1, name: 'Progress' })).toBeInTheDocument()
  })

  it('keeps advancing on the following midnight too', async () => {
    await renderProgress()
    await passTime(new Date(2026, 8, 1, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))

    // The wait re-arms itself; it is not a one-shot.
    await passTime(new Date(2026, 8, 2, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveValue('2026-09-02'))
  })
})

/* ------------------------------------------------------------------ */
/* C. The sleeping tab                                                 */
/* ------------------------------------------------------------------ */

describe('C. a tab that slept through midnight', () => {
  it('corrects itself the moment it becomes visible', async () => {
    await renderProgress()
    expect(dateField()).toHaveValue(YESTERDAY)

    // The laptop was shut at 23:59 and opened at 09:00. The timer never ran.
    await sleepThroughTo(new Date(2026, 8, 1, 9, 0, 0))

    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))
    expect(dateField()).toHaveAttribute('max', TOMORROW)
  })

  it('corrects itself on focus as well', async () => {
    await renderProgress()

    vi.setSystemTime(new Date(2026, 8, 1, 9, 0, 0))
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))
  })

  it('changes nothing when it wakes on the same day', async () => {
    await renderProgress()

    await sleepThroughTo(new Date(2026, 7, 31, 23, 59, 30))

    // Still the same date, and nothing thrashed.
    expect(dateField()).toHaveValue(YESTERDAY)
    expect(dateField()).toHaveAttribute('max', YESTERDAY)
  })
})

/* ------------------------------------------------------------------ */
/* D. A deliberate choice is not overwritten                           */
/* ------------------------------------------------------------------ */

describe('D. a date the person picked themselves', () => {
  it('survives midnight untouched', async () => {
    const user = await renderProgress()

    // Backfilling an earlier day, at 23:59.
    await user.clear(dateField())
    await user.type(dateField(), '2026-08-20')
    expect(dateField()).toHaveValue('2026-08-20')

    await passTime(new Date(2026, 8, 1, 0, 0, 30))

    // The clock moved; their choice did not.
    await waitFor(() => expect(dateField()).toHaveAttribute('max', TOMORROW))
    expect(dateField()).toHaveValue('2026-08-20')
  })

  it('still gains the new max, so today remains reachable', async () => {
    const user = await renderProgress()
    await user.clear(dateField())
    await user.type(dateField(), '2026-08-20')

    await passTime(new Date(2026, 8, 1, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveAttribute('max', TOMORROW))

    // And they can move to the new day when they choose to.
    await user.clear(dateField())
    await user.type(dateField(), TOMORROW)
    expect(dateField()).toHaveValue(TOMORROW)
  })

  it('survives a sleeping tab too', async () => {
    const user = await renderProgress()
    await user.clear(dateField())
    await user.type(dateField(), '2026-08-20')

    await sleepThroughTo(new Date(2026, 8, 1, 9, 0, 0))

    await waitFor(() => expect(dateField()).toHaveAttribute('max', TOMORROW))
    expect(dateField()).toHaveValue('2026-08-20')
  })
})

/* ------------------------------------------------------------------ */
/* E. A half-entered measurement                                       */
/* ------------------------------------------------------------------ */

describe('E. work in progress', () => {
  it('is not thrown away by the clock', async () => {
    const user = await renderProgress()

    await user.clear(weightField())
    await user.type(weightField(), '78.4')

    await passTime(new Date(2026, 8, 1, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))

    // The date moved underneath it; the typing stayed.
    expect(weightField()).toHaveValue(78.4)
  })

  it('is still cleared when the person changes the date themselves', async () => {
    const user = await renderProgress()

    await user.clear(weightField())
    await user.type(weightField(), '78.4')
    await user.clear(dateField())
    await user.type(dateField(), '2026-08-20')

    // A different day is a different measurement, so the field starts empty.
    expect(weightField()).toHaveValue(null)
  })

  it('keeps an error message visible rather than resetting the form', async () => {
    const user = await renderProgress()

    await user.clear(weightField())
    await user.type(weightField(), '78.45')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await passTime(new Date(2026, 8, 1, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))

    // Still showing what they typed and why it was refused.
    expect(weightField()).toHaveValue(78.45)
  })
})

/* ------------------------------------------------------------------ */
/* F. Validation uses the current day                                  */
/* ------------------------------------------------------------------ */

describe('F. the future check follows the clock', () => {
  it('accepts the new day once midnight has passed', async () => {
    const user = await renderProgress()

    await passTime(new Date(2026, 8, 1, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))

    await user.clear(weightField())
    await user.type(weightField(), '78.4')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))

    // Against the mount-time date this would have been "in the future" and
    // refused locally, never reaching the server.
    await waitFor(() => expect(card()?.textContent).toMatch(/saved/i))
    expect(screen.queryByText(/that date is in the future/i)).toBeNull()

    const write = server.calls.find((call) => call.method === 'PUT')
    expect((write?.body as { localDate: string }).localDate).toBe(TOMORROW)
  })

  it('still refuses a genuinely future date after rollover', async () => {
    const user = await renderProgress()
    await passTime(new Date(2026, 8, 1, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))

    await user.clear(dateField())
    await user.type(dateField(), '2026-09-02')
    await user.clear(weightField())
    await user.type(weightField(), '78.4')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/future/i)
    expect(server.calls.some((call) => call.method === 'PUT')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* G. Nothing else moved                                               */
/* ------------------------------------------------------------------ */

describe('G. add, update and delete after a rollover', () => {
  it('adds against the new day, then updates it in place', async () => {
    const user = await renderProgress()
    await passTime(new Date(2026, 8, 1, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))

    await user.clear(weightField())
    await user.type(weightField(), '78.4')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))
    await waitFor(() => expect(card()?.textContent).toMatch(/saved/i))

    // The same date is now an update, not a second entry.
    const update = await screen.findByRole('button', { name: /^update$/i })
    await user.clear(weightField())
    await user.type(weightField(), '77.9')
    await user.click(update)

    await waitFor(() => expect(card()?.textContent).toMatch(/77\.9/))
    expect(card()?.textContent).toMatch(/1 measurement(?!s)/)
  })

  it('deletes it again and returns to the empty state', async () => {
    const user = await renderProgress()
    await passTime(new Date(2026, 8, 1, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))

    await user.clear(weightField())
    await user.type(weightField(), '78.4')
    await user.click(screen.getByRole('button', { name: /add measurement/i }))
    await waitFor(() => expect(card()?.textContent).toMatch(/saved/i))

    await user.click(screen.getByRole('button', { name: /delete this measurement/i }))
    await user.click(screen.getByRole('button', { name: /delete it/i }))

    await waitFor(() => expect(card()?.textContent).toMatch(/no measurements in the last/i))
  })

  it('leaves the stored measurement for the previous day alone', async () => {
    server.seedWeight(YESTERDAY, 800)
    await renderProgress()

    // Before midnight the field shows what is stored for today.
    await waitFor(() => expect(weightField()).toHaveValue(80))

    await passTime(new Date(2026, 8, 1, 0, 0, 30))
    await waitFor(() => expect(dateField()).toHaveValue(TOMORROW))

    // The new day has nothing recorded, so the field is empty and the action
    // is an Add — yesterday's 80.0 is untouched and still in the history.
    expect(weightField()).toHaveValue(null)
    expect(screen.getByRole('button', { name: /add measurement/i })).toBeInTheDocument()
    expect(card()?.textContent).toMatch(/80\.0/)
  })
})
