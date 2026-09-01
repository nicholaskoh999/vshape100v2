import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createProgressServer, type ProgressServer } from './progressApiTestUtils'

/**
 * Round 18 Correction 1 — the body weight read identity includes the local day.
 *
 * THE BUG.
 *
 * 30D and 90D are windows ending TODAY, computed server-side. The local date was
 * folded into the key that STARTS a read but not into the identity that SETTLES
 * one: `loaded` was tagged with the attempt number alone. So after midnight the
 * previous day's result still satisfied `matched` and stayed on screen labelled
 * `ready`, under a heading that now meant a different window.
 *
 * The second half is worse than the first. If the rollover refetch FAILED, the
 * stale result kept winning forever: the card reported `ready`, the error never
 * surfaced, and the numbers shown were quietly answering yesterday's question.
 *
 * 2026-08-02 is the discriminator below. It is inside the 30-day window ending
 * 2026-08-31 and outside the one ending 2026-09-01, so the two days genuinely
 * disagree about what the window contains.
 */

const BEFORE_MIDNIGHT = new Date(2026, 7, 31, 23, 59, 0)
const AFTER_MIDNIGHT = new Date(2026, 8, 1, 0, 5, 0)

/** Inside the 30D window on 31 August, outside it on 1 September. */
const DROPS_OUT = '2026-08-02'
/** Comfortably inside both. */
const STAYS_IN = '2026-08-20'

/** A date the user picks deliberately; it must survive the rollover. */
const CHOSEN_BACKFILL = '2026-08-15'

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
const measurementCount = () => screen.queryByText(/\d+ measurements?/)?.textContent ?? null

async function renderProgress() {
  renderApp('/progress')
  await screen.findByRole('heading', { level: 1, name: 'Progress' })
  await waitFor(() => expect(state()).toBe('ready'))
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
 * Get to a steady state on 31 August: 30D selected, two measurements in the
 * window, a typed draft and a deliberately chosen backfill date.
 */
async function settleOn31August() {
  server.seedWeight(DROPS_OUT, 750)
  server.seedWeight(STAYS_IN, 760)
  const user = await renderProgress()

  await user.click(screen.getByRole('button', { name: '30D' }))
  await waitFor(() => expect(measurementCount()).toBe('2 measurements'))

  // The date FIRST: choosing one deliberately clears the weight draft, so a
  // draft typed before it would not survive the click.
  await user.clear(dateField())
  await user.type(dateField(), CHOSEN_BACKFILL)
  await user.type(weightField(), '77.4')

  expect(dateField().value).toBe(CHOSEN_BACKFILL)
  expect(weightField().value).toBe('77.4')
  return user
}

describe('1. a successful refetch at midnight', () => {
  it('adopts the new day’s window instead of relabelling yesterday’s', async () => {
    await settleOn31August()
    expect(measurementCount()).toBe('2 measurements')

    await passTime(AFTER_MIDNIGHT)

    // The window moved on, and 2026-08-02 fell out of it.
    await waitFor(() => expect(state()).toBe('ready'))
    await waitFor(() => expect(measurementCount()).toBe('1 measurement'))
  })

  it('keeps the range, the typed draft and the chosen date', async () => {
    await settleOn31August()
    await passTime(AFTER_MIDNIGHT)
    await waitFor(() => expect(measurementCount()).toBe('1 measurement'))

    // A refetch is not a reset: nothing the user was in the middle of is lost.
    expect(screen.getByRole('button', { name: '30D' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(dateField().value).toBe(CHOSEN_BACKFILL)
    expect(weightField().value).toBe('77.4')
  })
})

describe('2. a FAILED refetch at midnight', () => {
  it('reports an error instead of leaving yesterday’s data marked ready', async () => {
    await settleOn31August()
    expect(state()).toBe('ready')
    expect(measurementCount()).toBe('2 measurements')

    // The rollover read fails.
    server.failWith(500)
    await passTime(AFTER_MIDNIGHT)

    // THE ASSERTION THAT FAILS WITHOUT THE FIX. The old identity let the
    // previous day's result keep satisfying `matched`, so the card stayed
    // 'ready' and the failure was invisible — permanently.
    await waitFor(() => expect(state()).toBe('error'))
    expect(state()).not.toBe('ready')

    // And yesterday's window is not still being presented as today's answer.
    expect(measurementCount()).not.toBe('2 measurements')
  })

  it('recovers on retry, without having shown stale data as current', async () => {
    await settleOn31August()
    server.failWith(500)
    await passTime(AFTER_MIDNIGHT)
    await waitFor(() => expect(state()).toBe('error'))

    server.failWith(null)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))

    await waitFor(() => expect(state()).toBe('ready'))
    await waitFor(() => expect(measurementCount()).toBe('1 measurement'))
  })

  it('still preserves the draft and the chosen date through the failure', async () => {
    await settleOn31August()
    server.failWith(500)
    await passTime(AFTER_MIDNIGHT)
    await waitFor(() => expect(state()).toBe('error'))

    // A failed read must not discard what the user was typing.
    expect(dateField().value).toBe(CHOSEN_BACKFILL)
    expect(weightField().value).toBe('77.4')
  })
})
