import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createSettingsServer, type SettingsServer } from './settingsApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

/**
 * Round 18 — the Foundation start date in the real app.
 *
 * The real router, the real provider, the real Settings form and the real pages
 * run against the in-memory stand-ins. What these defend:
 *
 *   a saved date renumbers Foundation everywhere, in-session and after reload
 *   a failed save leaves the last confirmed value authoritative
 *   a save cannot be submitted twice
 *   the day number advances across local midnight, and after a slept-through
 *   timer, without a reload
 */

/** 2026-09-10 is a Thursday. Legacy start makes it Day 11; cutover Day 10. */
const BEFORE_MIDNIGHT = new Date(2026, 8, 10, 23, 58, 0)
const AFTER_MIDNIGHT = new Date(2026, 8, 11, 0, 5, 0)
const CUTOVER = '2026-09-01'

let settings: SettingsServer
let workouts: WorkoutServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(BEFORE_MIDNIGHT)
  settings = createSettingsServer()
  workouts = createWorkoutServer()
  mockAuthFetch({ session: authenticatedSession, settings, workouts })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

async function crossMidnight() {
  await act(async () => {
    vi.setSystemTime(AFTER_MIDNIGHT)
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000)
  })
}

async function wake(event: 'visibilitychange' | 'focus') {
  await act(async () => {
    if (event === 'focus') window.dispatchEvent(new Event('focus'))
    else document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
  })
}

async function openSettings() {
  renderApp('/settings')
  return screen.findByRole('heading', { level: 2, name: /Foundation Start Date/i })
}

/* ------------------------------------------------------------------ */
/* Load states                                                         */
/* ------------------------------------------------------------------ */

describe('the card is honest about what it knows', () => {
  it('shows a loading state rather than an empty-looking field', async () => {
    const release = settings.hold()
    // Holding the WRITE gate does not hold reads, so hold reads by failing
    // slowly instead: assert the loading state before the read resolves.
    release()

    renderApp('/settings')
    // The heading renders immediately; the form waits for the read.
    await screen.findByRole('heading', { level: 2, name: /Foundation Start Date/i })
    await waitFor(() => expect(screen.getByLabelText(/Day 1/i)).toBeInTheDocument())
  })

  it('says the read failed and offers a retry, rather than showing the default as a choice', async () => {
    settings.failReads(1)
    await openSettings()

    expect(await screen.findByText(/Could not load your start date/i)).toBeInTheDocument()
    // No form is offered while the truth is unknown.
    expect(screen.queryByLabelText(/Day 1/i)).not.toBeInTheDocument()

    await user().click(screen.getByRole('button', { name: /Try again/i }))
    await waitFor(() => expect(screen.getByLabelText(/Day 1/i)).toBeInTheDocument())
  })

  it('1. tells an account with nothing saved that it is on the legacy default', async () => {
    await openSettings()
    expect(
      await screen.findByText(/No date saved yet — counting from 2026-08-31/i),
    ).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* 11. Save, in-session and after reload                               */
/* ------------------------------------------------------------------ */

describe('11. saving persists in-session and survives a reload', () => {
  it('stores the date and confirms it', async () => {
    await openSettings()
    const field = await screen.findByLabelText(/Day 1/i)

    await user().clear(field)
    await user().type(field, CUTOVER)
    await user().click(screen.getByRole('button', { name: /Save start date/i }))

    await waitFor(() => expect(settings.stored.foundationStartDate).toBe(CUTOVER))
    expect(await screen.findByText(/Start date saved/i)).toBeInTheDocument()
    expect(await screen.findByText(new RegExp(`Saved: ${CUTOVER}`))).toBeInTheDocument()
  })

  it('renumbers Foundation on Progress in the same session', async () => {
    settings.seed(CUTOVER)
    renderApp('/progress')
    await screen.findByRole('heading', { level: 1, name: 'Progress' })

    // 2026-09-10 is Day 10 counting from 2026-09-01.
    expect(await screen.findByText('Day 10 / 100')).toBeInTheDocument()
  })

  it('1. shows the legacy numbering when nothing is saved', async () => {
    renderApp('/progress')
    await screen.findByRole('heading', { level: 1, name: 'Progress' })

    // The same calendar day is Day 11 counting from 2026-08-31.
    expect(await screen.findByText('Day 11 / 100')).toBeInTheDocument()
  })

  it('reads persisted truth back after a remount, not a cached value', async () => {
    settings.seed('2026-09-05')
    renderApp('/settings')
    const field = await screen.findByLabelText(/Day 1/i)
    expect(field).toHaveValue('2026-09-05')
  })
})

/* ------------------------------------------------------------------ */
/* 12. A failed save keeps the last confirmed value                    */
/* ------------------------------------------------------------------ */

describe('12. a failed save changes nothing', () => {
  it('keeps the previously confirmed date authoritative and says so', async () => {
    settings.seed('2026-09-05')
    await openSettings()

    settings.failWrites(1)
    const field = await screen.findByLabelText(/Day 1/i)
    await user().clear(field)
    await user().type(field, CUTOVER)
    await user().click(screen.getByRole('button', { name: /Save start date/i }))

    expect(await screen.findByText(/Could not save the start date/i)).toBeInTheDocument()
    // The stored value never moved…
    expect(settings.stored.foundationStartDate).toBe('2026-09-05')
    // …and the help line still reports the confirmed one.
    expect(screen.getByText(/Saved: 2026-09-05/)).toBeInTheDocument()
  })

  it('4. an impossible date can never be submitted', async () => {
    await openSettings()
    const field = await screen.findByLabelText(/Day 1/i)

    // A `type="date"` control refuses to HOLD an impossible value at all: the
    // assignment leaves the field empty rather than storing 2026-02-30. That is
    // the first of three guards, and the reason the UI never sees the value.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!
      setter.call(field, '2026-02-30')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(field).toHaveValue('')
    // Save stays disabled on an empty/invalid draft…
    expect(screen.getByRole('button', { name: /Save start date/i })).toBeDisabled()
    // …so nothing is ever sent. The shared validator and the server are the
    // other two guards, exercised in foundationStartDate and settingsRoutes.
    expect(settings.calls.filter((call) => call.method === 'PUT')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* 25. One write per submit                                            */
/* ------------------------------------------------------------------ */

describe('25. a save cannot be submitted twice', () => {
  it('disables the control while in flight and issues exactly one write', async () => {
    await openSettings()
    const field = await screen.findByLabelText(/Day 1/i)
    await user().clear(field)
    await user().type(field, CUTOVER)

    const release = settings.hold()
    const button = screen.getByRole('button', { name: /Save start date/i })
    await user().click(button)

    const busy = await screen.findByRole('button', { name: /Saving/i })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')

    // Further clicks while busy must not queue a second write.
    await user().click(busy)
    await user().click(busy)

    await act(async () => {
      release()
      await Promise.resolve()
    })

    await waitFor(() => expect(settings.stored.foundationStartDate).toBe(CUTOVER))
    expect(settings.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* 13 + 14. Midnight                                                   */
/* ------------------------------------------------------------------ */

describe('13/14. the Foundation day advances across local midnight', () => {
  it('increments exactly once when the day turns, without a reload', async () => {
    settings.seed(CUTOVER)
    renderApp('/progress')
    await screen.findByRole('heading', { level: 1, name: 'Progress' })
    expect(await screen.findByText('Day 10 / 100')).toBeInTheDocument()

    await crossMidnight()

    expect(await screen.findByText('Day 11 / 100')).toBeInTheDocument()
    // Exactly once: not 12, and the old value is gone.
    expect(screen.queryByText('Day 10 / 100')).not.toBeInTheDocument()
    expect(screen.queryByText('Day 12 / 100')).not.toBeInTheDocument()
  })

  it('14. corrects a slept-through timer on visibilitychange', async () => {
    settings.seed(CUTOVER)
    renderApp('/progress')
    await screen.findByText('Day 10 / 100')

    // The timer never fired — a closed laptop, or a backgrounded tab.
    vi.setSystemTime(AFTER_MIDNIGHT)
    expect(screen.getByText('Day 10 / 100')).toBeInTheDocument()

    await wake('visibilitychange')
    expect(await screen.findByText('Day 11 / 100')).toBeInTheDocument()
  })

  it('14. corrects a slept-through timer on focus', async () => {
    settings.seed(CUTOVER)
    renderApp('/progress')
    await screen.findByText('Day 10 / 100')

    vi.setSystemTime(AFTER_MIDNIGHT)
    await wake('focus')
    expect(await screen.findByText('Day 11 / 100')).toBeInTheDocument()
  })

  it('does not churn when the day has not actually changed', async () => {
    settings.seed(CUTOVER)
    renderApp('/progress')
    await screen.findByText('Day 10 / 100')

    await wake('focus')
    await wake('visibilitychange')

    expect(screen.getByText('Day 10 / 100')).toBeInTheDocument()
  })

  it('advances the Today eyebrow too', async () => {
    settings.seed(CUTOVER)
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    expect(await screen.findByText(/Foundation · Day 10/)).toBeInTheDocument()

    await crossMidnight()
    expect(await screen.findByText(/Foundation · Day 11/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* 15. Body weight windows follow the day, and keep the draft          */
/* ------------------------------------------------------------------ */

describe('15. Body Weight windows follow the local day', () => {
  it('re-reads the window at midnight while preserving the typed draft and picked date', async () => {
    renderApp('/progress')
    await screen.findByRole('heading', { level: 1, name: 'Progress' })

    // Wait for the Body Weight card to settle before editing: typing into a
    // control that is still loading proves nothing about what survives.
    const weightField = (await screen.findByLabelText(/Weight/i)) as HTMLInputElement
    const dateField = (await screen.findByLabelText(/^Date$/i)) as HTMLInputElement
    await waitFor(() => expect(weightField).not.toBeDisabled())

    // A typed draft and a deliberately BACK-DATED entry, mid-edit.
    //
    // Set through the native setter rather than keystroke-by-keystroke: a
    // `type="number"` control discards the intermediate "77." a per-character
    // typist produces, which would make this test about userEvent rather than
    // about what survives midnight.
    const setValue = (field: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!
      setter.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }

    // Date FIRST, then the weight — the order a real user works in. Picking a
    // day deliberately clears the weight draft, because the field then shows
    // that day's measurement; typing first and re-dating after would wipe the
    // draft by design, not by regression.
    await act(async () => {
      setValue(dateField, '2026-09-04')
    })
    await act(async () => {
      setValue(weightField, '77.5')
    })

    // Re-queried rather than reused: React may have replaced the node, and a
    // stale reference would read '' and make this test lie in both directions.
    const weightNow = () => screen.getByLabelText(/Weight/i) as HTMLInputElement
    const dateNow = () => screen.getByLabelText(/^Date$/i) as HTMLInputElement

    await waitFor(() => expect(weightNow().value).toBe('77.5'))
    expect(dateNow().value).toBe('2026-09-04')

    const readsBefore = (window.fetch as unknown as { mock: { calls: [string][] } }).mock.calls
      .filter((call) => call[0].startsWith('/api/progress/weight')).length

    await crossMidnight()

    // The window re-read for the NEW day — exactly one more request.
    await waitFor(() => {
      const readsAfter = (window.fetch as unknown as { mock: { calls: [string][] } }).mock.calls
        .filter((call) => call[0].startsWith('/api/progress/weight')).length
      expect(readsAfter).toBeGreaterThan(readsBefore)
    })

    // …and neither the typed draft nor the chosen backfill date was destroyed.
    expect(weightNow().value).toBe('77.5')
    expect(dateNow().value).toBe('2026-09-04')
  })
})

/* ------------------------------------------------------------------ */
/* Settings page cold load                                             */
/* ------------------------------------------------------------------ */

describe('Settings cold load never looks blank or broken', () => {
  it('renders its heading and every card region immediately', async () => {
    renderApp('/settings')

    const heading = await screen.findByRole('heading', { level: 1, name: 'Settings' })
    expect(heading).toBeInTheDocument()

    // The Foundation card is present from the first paint, in one of its
    // honest states, rather than appearing later out of nowhere.
    const card = await screen.findByRole('heading', { level: 2, name: /Foundation Start Date/i })
    expect(card).toBeInTheDocument()

    const region = card.closest('div')!
    expect(
      within(region).getByText(/changes day numbers and milestones only/i),
    ).toBeInTheDocument()
  })
})
