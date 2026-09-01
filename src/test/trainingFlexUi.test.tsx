import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import {
  createTrainingFlexServer,
  type TrainingFlexServer,
} from './trainingFlexApiTestUtils'

/**
 * Round 19.2 — Today Training Flex in the real app.
 *
 * The real router, the real hook, the real card and the real Calendar run
 * against the in-memory stand-in. What these defend:
 *
 *   the choice is offered only on a day that plans a session
 *   choosing persists, and the confirmed choice is shown back
 *   a failed save keeps the last persisted truth
 *   a choice cannot be written twice by a fast double tap
 *   AT LOCAL MIDNIGHT yesterday's choice does not become today's
 */

/** 2026-09-08 is a Tuesday, which plans a session. 23:58 local. */
const BEFORE_MIDNIGHT = new Date(2026, 8, 8, 23, 58, 0)
const AFTER_MIDNIGHT = new Date(2026, 8, 9, 0, 5, 0)
const TUESDAY = '2026-09-08'
const WEDNESDAY = '2026-09-09'
/** 2026-09-12 is a Saturday: no session, so nothing to flex. */
const SATURDAY = new Date(2026, 8, 12, 10, 0, 0)

let flex: TrainingFlexServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(BEFORE_MIDNIGHT)
  flex = createTrainingFlexServer()
  mockAuthFetch({ session: authenticatedSession, trainingFlex: flex })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

const card = () => document.querySelector('[data-training-flex]') as HTMLElement | null
const cardState = () => card()?.getAttribute('data-training-flex-state') ?? null

async function openToday() {
  renderApp('/today')
  await screen.findByRole('heading', { level: 1, name: 'Today' })
  await waitFor(() => expect(cardState()).toBe('ready'))
  return user()
}

function option(name: RegExp) {
  return screen.getByRole('radio', { name })
}

async function crossMidnight() {
  await act(async () => {
    vi.setSystemTime(AFTER_MIDNIGHT)
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
  })
}

/* ------------------------------------------------------------------ */
/* 1. When the choice is offered                                       */
/* ------------------------------------------------------------------ */

describe('1. the choice appears only where it means something', () => {
  it('is offered on a day that plans a session', async () => {
    await openToday()
    expect(card()).not.toBeNull()
    expect(option(/Do scheduled workout/i)).toBeInTheDocument()
    expect(option(/Recovery today/i)).toBeInTheDocument()
    expect(option(/Nintendo Fitness Boxing 2/i)).toBeInTheDocument()
  })

  it('is NOT offered on a Saturday, which plans no session', async () => {
    vi.setSystemTime(SATURDAY)
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    // Nothing to flex away from, so the card would be clutter implying a
    // session that does not exist.
    await waitFor(() => expect(card()).toBeNull())
  })

  it('does not add a top-level navigation destination', async () => {
    await openToday()
    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0]
    expect(within(nav).queryByText(/recovery|boxing|flex/i)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 2. Choosing, and being told what was chosen                         */
/* ------------------------------------------------------------------ */

describe('2. a choice persists and is shown back', () => {
  it('defaults to the scheduled workout when nothing is chosen', async () => {
    await openToday()
    expect(option(/Do scheduled workout/i)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Today is the scheduled Foundation session/i)).toBeInTheDocument()
  })

  it.each([
    [/Recovery today/i, 'recovery', /Today is Recovery today/i],
    [/Nintendo Fitness Boxing 2/i, 'fitness_boxing_2', /Today is Nintendo Fitness Boxing 2/i],
  ])('records %s and confirms it', async (label, stored, confirmation) => {
    const u = await openToday()
    await u.click(option(label))

    await waitFor(() => expect(flex.stored.get(TUESDAY)).toBe(stored))
    await waitFor(() => expect(option(label)).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByText(confirmation)).toBeInTheDocument()
    // The consequence is stated, because the honest answer is reassuring.
    expect(screen.getByText(/streak is unaffected/i)).toBeInTheDocument()
  })

  it('sends no identity — the account is the session', async () => {
    const u = await openToday()
    await u.click(option(/Recovery today/i))
    await waitFor(() => expect(flex.stored.get(TUESDAY)).toBe('recovery'))

    const write = flex.calls.find((call) => call.method === 'PUT')!
    expect(Object.keys(write.body as object).sort()).toEqual(['date', 'kind'])
  })

  it('goes back to the scheduled workout by clearing, not by storing a third kind', async () => {
    flex.seed(TUESDAY, 'recovery')
    const u = await openToday()
    expect(option(/Recovery today/i)).toHaveAttribute('aria-checked', 'true')

    await u.click(option(/Do scheduled workout/i))
    await waitFor(() => expect(flex.stored.has(TUESDAY)).toBe(false))
    expect(option(/Do scheduled workout/i)).toHaveAttribute('aria-checked', 'true')
  })

  it('reads a previously saved choice on load', async () => {
    flex.seed(TUESDAY, 'fitness_boxing_2')
    await openToday()
    expect(option(/Nintendo Fitness Boxing 2/i)).toHaveAttribute('aria-checked', 'true')
  })
})

/* ------------------------------------------------------------------ */
/* 3. States                                                           */
/* ------------------------------------------------------------------ */

describe('3. busy, error and duplicate-write behaviour', () => {
  it('keeps the last persisted truth when a save fails', async () => {
    flex.seed(TUESDAY, 'recovery')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const u = await openToday()

    flex.failWrites(1)
    await u.click(option(/Nintendo Fitness Boxing 2/i))

    await screen.findByRole('alert')
    // Unchanged on the server AND on screen: a failed save changes nothing.
    expect(flex.stored.get(TUESDAY)).toBe('recovery')
    expect(option(/Recovery today/i)).toHaveAttribute('aria-checked', 'true')
    errors.mockRestore()
  })

  it('cannot be written twice by a fast double click', async () => {
    const u = await openToday()
    const release = flex.hold()

    await u.click(option(/Recovery today/i))
    // Second click while the first is still in flight.
    await u.click(option(/Nintendo Fitness Boxing 2/i))

    await act(async () => {
      release()
      await Promise.resolve()
    })

    await waitFor(() => expect(flex.stored.get(TUESDAY)).toBe('recovery'))
    expect(flex.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
  })

  it('reports a failed load and recovers on retry', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    flex.failReads(1)
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    await waitFor(() => expect(cardState()).toBe('error'))
    const u = user()
    await u.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(cardState()).toBe('ready'))
    errors.mockRestore()
  })

  it('refuses an unreadable response rather than showing "no choice"', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A kind this build does not recognise must not read as an unresolved day.
    flex.corruptRead({ choices: [{ date: TUESDAY, kind: 'yoga' }] }, 9)
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await waitFor(() => expect(cardState()).toBe('error'))
    errors.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/* 4. Midnight                                                         */
/* ------------------------------------------------------------------ */

describe('4. yesterday’s choice does not become today’s', () => {
  it('drops the previous day’s Recovery when the local day turns', async () => {
    const u = await openToday()
    await u.click(option(/Recovery today/i))
    await waitFor(() => expect(flex.stored.get(TUESDAY)).toBe('recovery'))
    expect(option(/Recovery today/i)).toHaveAttribute('aria-checked', 'true')

    await crossMidnight()

    // Wednesday is its own day: the scheduled workout stands again.
    await waitFor(() =>
      expect(option(/Do scheduled workout/i)).toHaveAttribute('aria-checked', 'true'),
    )
    expect(option(/Recovery today/i)).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/Today is the scheduled Foundation session/i)).toBeInTheDocument()

    // Tuesday's record is untouched — the day was resolved, and stays resolved.
    expect(flex.stored.get(TUESDAY)).toBe('recovery')
    expect(flex.stored.has(WEDNESDAY)).toBe(false)
  })

  it('reads the NEW day, and writes to it', async () => {
    const u = await openToday()
    await crossMidnight()
    await waitFor(() => expect(cardState()).toBe('ready'))

    await u.click(option(/Nintendo Fitness Boxing 2/i))
    await waitFor(() => expect(flex.stored.get(WEDNESDAY)).toBe('fitness_boxing_2'))
    // The write went to Wednesday, never back to Tuesday.
    expect(flex.stored.has(TUESDAY)).toBe(false)
  })

  it('picks up a choice already saved for the new day', async () => {
    flex.seed(WEDNESDAY, 'recovery')
    await openToday()
    expect(option(/Do scheduled workout/i)).toHaveAttribute('aria-checked', 'true')

    await crossMidnight()
    await waitFor(() =>
      expect(option(/Recovery today/i)).toHaveAttribute('aria-checked', 'true'),
    )
  })
})

/* ------------------------------------------------------------------ */
/* 5. Calendar                                                         */
/* ------------------------------------------------------------------ */

describe('5. the Calendar distinguishes the three truths', () => {
  async function openCalendar() {
    renderApp('/calendar')
    await screen.findByRole('heading', { level: 1, name: 'Calendar' })
    await waitFor(() =>
      expect(document.querySelector('[data-calendar-grid][data-resolved="true"]')).not.toBeNull(),
    )
  }

  const cell = (date: string) =>
    document.querySelector(`[data-day="${date}"]`) as HTMLElement | null

  it('marks a Recovery day and a Fitness Boxing day differently from a plain training day', async () => {
    flex.seed(TUESDAY, 'recovery')
    flex.seed('2026-09-10', 'fitness_boxing_2')
    await openCalendar()

    await waitFor(() =>
      expect(cell(TUESDAY)?.getAttribute('data-day-flex')).toBe('recovery'),
    )
    expect(cell('2026-09-10')?.getAttribute('data-day-flex')).toBe('fitness_boxing_2')
    // An ordinary training day carries no mark at all.
    expect(cell('2026-09-11')?.getAttribute('data-day-flex')).toBeNull()

    // And each is still the weekday it always was — the programme is unchanged.
    expect(cell(TUESDAY)?.getAttribute('data-day-type')).toBe('training')
  })

  it('names the choice for a screen reader', async () => {
    flex.seed(TUESDAY, 'fitness_boxing_2')
    await openCalendar()
    await waitFor(() =>
      expect(cell(TUESDAY)?.getAttribute('aria-label')).toMatch(/Nintendo Fitness Boxing 2/),
    )
  })

  it('never marks a weekend, which had no session to resolve', async () => {
    flex.seed('2026-09-12', 'recovery')
    await openCalendar()
    await waitFor(() => expect(cell('2026-09-12')).not.toBeNull())
    expect(cell('2026-09-12')?.getAttribute('data-day-flex')).toBeNull()
  })
})
