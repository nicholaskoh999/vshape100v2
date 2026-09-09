/*
 * ROUND 27 — the Settings Admin entry (VT-13) and the Prep Week note (VT-02).
 *
 * Driven through the real router, the real Foundation provider and the real
 * pages, against the in-memory stand-ins. The Foundation date is SEEDED, never
 * assumed, and every countdown assertion below is derived from a seeded date
 * and a faked clock rather than from a number written into the test — the same
 * rule the component itself follows.
 *
 * WHAT THESE DEFEND:
 *
 *   Settings offers a real internal link to /admin, and that link changes
 *   nothing about who /admin will actually serve
 *   the prep note counts down from the account's own Foundation date
 *   it never shows Day 0, and never a negative day
 *   on Day 1 it is GONE, and the normal Foundation state has taken over
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createSettingsServer, type SettingsServer } from './settingsApiTestUtils'

/** The account's Day 1 for every case below. A Monday. */
const DAY_1 = '2026-09-14'

let settings: SettingsServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  settings = createSettingsServer()
  settings.seed(DAY_1)
  mockAuthFetch({ session: authenticatedSession, settings })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

/** Set the local clock to a calendar day, mid-morning. */
function setDay(year: number, monthIndex: number, day: number) {
  vi.setSystemTime(new Date(year, monthIndex, day, 10, 0, 0, 0))
}

/**
 * Put the clock `n` local days BEFORE Day 1, derived from `DAY_1` itself.
 *
 * Deliberately not a hand-written calendar date per case. Counting back from
 * the seeded start date is the same arithmetic the page does, so a test cannot
 * quietly disagree with it about which day is "8 days before" — and month
 * boundaries take care of themselves.
 */
function setDaysBefore(n: number) {
  const [year, month, day] = DAY_1.split('-').map(Number)
  vi.setSystemTime(new Date(year, month - 1, day - n, 10, 0, 0, 0))
}

/** The Today eyebrow, as rendered. */
function eyebrow(): string {
  return document.body.textContent ?? ''
}

/**
 * Render Today and WAIT FOR THE ACCOUNT'S FOUNDATION DATE.
 *
 * The heading appears before the settings read resolves, and until it does the
 * page deliberately knows no start date — so asserting straight after the
 * heading would be asserting against a page that has not been told what
 * Foundation is yet. The eyebrow is the readiness signal: it says a bare
 * "Foundation" while loading, and once it knows it names the phase — a day
 * number, Prep week, or a plain "starts in N days" when Day 1 is further out
 * than a week.
 */
async function renderToday() {
  renderApp('/today')
  await screen.findByRole('heading', { name: 'Today', level: 1 })
  await waitFor(() =>
    expect(document.body.textContent ?? '').toMatch(
      /Foundation · Day \d+|Foundation · Prep week|Foundation starts in \d+ days?/,
    ),
  )
}

/** The prep note if it is on screen, else null. Call only after renderToday. */
function prepNote(): HTMLElement | null {
  return screen.queryByRole('group', { name: /until Foundation Day 1/ })
}

/* ================================================================== */
/* 1. VT-13 — Admin is reachable from Settings                         */
/* ================================================================== */

describe('1. Settings offers an Admin entry', () => {
  beforeEach(() => setDay(2026, 8, 14))

  it('A. renders one Admin link, in the System section, below Training', async () => {
    renderApp('/settings')
    await screen.findByRole('heading', { name: 'Settings', level: 1 })

    const system = await screen.findByRole('list', { name: 'System' })
    const link = within(system).getByRole('link', { name: 'Admin' })
    expect(link).toHaveAttribute('href', '/admin')

    // Exactly one, and it is not duplicated into the Training list.
    expect(screen.getAllByRole('link', { name: 'Admin' })).toHaveLength(1)
    const training = screen.getByRole('list', { name: 'Training set-up' })
    expect(within(training).queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('B. navigates in-app rather than opening a new tab', async () => {
    renderApp('/settings')
    const link = await screen.findByRole('link', { name: 'Admin' })

    // A new tab would need one of these. The row is an ordinary router Link.
    expect(link).not.toHaveAttribute('target')
    expect(link).not.toHaveAttribute('rel')
  })

  it('C. clicking it lands on the real Admin route', async () => {
    const router = renderApp('/settings')
    const person = user()

    await person.click(await screen.findByRole('link', { name: 'Admin' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
    await screen.findByRole('heading', { name: 'Admin', level: 1 })
  })

  it('D. does NOT appear in the app navigation — Settings only', async () => {
    renderApp('/settings')
    await screen.findByRole('heading', { name: 'Settings', level: 1 })

    for (const nav of screen.getAllByRole('navigation')) {
      expect(within(nav).queryByRole('link', { name: /Admin/ })).toBeNull()
    }
  })

  it('E. the link is not an entitlement: the server still decides', async () => {
    // The stand-in serves no /api/admin route, so the page's read fails and the
    // page shows a refusal rather than a screen of facts. That is the whole
    // point of the row being a link and not a permission.
    const router = renderApp('/settings')
    await user().click(await screen.findByRole('link', { name: 'Admin' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))

    await screen.findByRole('heading', { name: 'Admin', level: 1 })
    // No system facts are rendered client-side on the strength of the link.
    await waitFor(() => expect(screen.queryByText('Healthy')).toBeNull())
  })
})

/* ================================================================== */
/* 2. VT-02 — the Prep Week countdown                                  */
/* ================================================================== */

describe('2. the prep note counts down to Day 1', () => {
  it('A. several days before: names the real remaining count', async () => {
    setDay(2026, 8, 9) // 2026-09-09, five days before 2026-09-14
    await renderToday()

    const note = prepNote()
    expect(note).not.toBeNull()
    expect(within(note!).getByText('Prep week')).toBeInTheDocument()
    expect(within(note!).getByText('5 days until Foundation Day 1')).toBeInTheDocument()
  })

  it('B. the count is derived from the date, not written into the page', async () => {
    // Same account, three different days, three different numbers.
    for (const [day, expected] of [
      [8, '6 days until Foundation Day 1'],
      [11, '3 days until Foundation Day 1'],
      [13, '1 day until Foundation Day 1'],
    ] as const) {
      setDay(2026, 8, day)
      await renderToday()
      expect(screen.getByText(expected), `day ${day}`).toBeInTheDocument()
      cleanup()
    }
  })

  it('C. one day before: singular "1 day", never "1 days"', async () => {
    setDay(2026, 8, 13)
    await renderToday()

    expect(screen.getByText('1 day until Foundation Day 1')).toBeInTheDocument()
    expect(screen.queryByText('1 days until Foundation Day 1')).toBeNull()
  })

  it('D. it says the training already counts, and never that it will be cleared', async () => {
    setDay(2026, 8, 10)
    await renderToday()

    const note = prepNote()!
    expect(within(note).getByText(/Your training still counts/)).toBeInTheDocument()
    // Nothing in the note may imply a second reset. Round 25 happened once.
    expect(note.textContent ?? '').not.toMatch(/reset|clear|wipe|delet|erase|start over/i)
  })
})

/* ================================================================== */
/* 3. VT-02 — the boundary, which is the part that can go wrong        */
/* ================================================================== */

/* ================================================================== */
/* 2b. CORRECTION 1 — Prep Week is a WINDOW, not the whole upcoming    */
/*     phase                                                          */
/* ================================================================== */

describe('2b. Prep Week is the last seven days, and nothing before that', () => {
  /*
   * The gap this closes: `upcoming` only means Day 1 has not arrived. The
   * start date is editable, so it is equally true a month out — and the first
   * cut would have rendered "PREP WEEK · 30 days until Foundation Day 1".
   */

  it('A. SEVEN days before is the first day of Prep Week', async () => {
    setDaysBefore(7)
    await renderToday()

    expect(prepNote()).not.toBeNull()
    expect(screen.getByText('7 days until Foundation Day 1')).toBeInTheDocument()
    expect(eyebrow()).toContain('Foundation · Prep week')
  })

  it('B. EIGHT days before is NOT Prep Week, and says so truthfully', async () => {
    setDaysBefore(8)
    await renderToday()

    expect(prepNote()).toBeNull()
    expect(screen.queryByText('Prep week')).toBeNull()
    expect(screen.queryByText(/until Foundation Day 1/)).toBeNull()

    // The eyebrow is now the only thing that can speak, and it is truthful.
    expect(eyebrow()).toContain('Foundation starts in 8 days')
    expect(eyebrow()).not.toContain('Prep week')
  })

  it('C. THIRTY days before is not Prep Week either', async () => {
    setDaysBefore(30)
    await renderToday()

    expect(prepNote()).toBeNull()
    expect(screen.queryByText('Prep week')).toBeNull()
    expect(eyebrow()).toContain('Foundation starts in 30 days')
    expect(eyebrow()).not.toContain('Prep week')
  })

  it('D. the far-out eyebrow counts down for real, day by day', async () => {
    // Derived from the seeded date, so the numbers cannot be coincidences.
    for (const [before, expected] of [
      [9, 'Foundation starts in 9 days'],
      [14, 'Foundation starts in 14 days'],
      [60, 'Foundation starts in 60 days'],
    ] as const) {
      setDaysBefore(before)
      await renderToday()
      expect(eyebrow(), `${before} days before`).toContain(expected)
      expect(eyebrow(), `${before} days before`).not.toContain('Prep week')
      cleanup()
    }
  })

  it('E. the boundary flips exactly between 8 and 7, not somewhere near it', async () => {
    setDaysBefore(8)
    await renderToday()
    expect(prepNote(), 'day 8 must be outside').toBeNull()
    cleanup()

    setDaysBefore(7)
    await renderToday()
    expect(prepNote(), 'day 7 must be inside').not.toBeNull()
  })

  it('F. no window, near or far, ever prints a zero or a negative count', async () => {
    for (const before of [60, 30, 9, 8, 7, 3, 1]) {
      setDaysBefore(before)
      await renderToday()

      const body = eyebrow()
      expect(body, `${before} before`).not.toMatch(/\b0 days? until Foundation/)
      expect(body, `${before} before`).not.toMatch(/starts in 0 days?\b/)
      expect(body, `${before} before`).not.toMatch(/-\d+ days?/)
      cleanup()
    }
  })
})

describe('3. Day 1 and after', () => {
  it('A. ON Foundation Day 1 the prep note is gone', async () => {
    setDay(2026, 8, 14)
    await renderToday()

    expect(prepNote()).toBeNull()
    expect(screen.queryByText('Prep week')).toBeNull()
    expect(screen.queryByText(/until Foundation Day 1/)).toBeNull()
  })

  it('B. ON Day 1 the normal Foundation state has taken over', async () => {
    setDay(2026, 8, 14)
    await renderToday()

    // The eyebrow names the day, and the Foundation metric is a real 1.
    expect(screen.getByText('Foundation · Day 1')).toBeInTheDocument()
    const metric = screen.getByText('Foundation day').closest('div') as HTMLElement
    expect(within(metric).getByText('1')).toBeInTheDocument()
  })

  it('C. well after Day 1 it stays gone', async () => {
    setDay(2026, 9, 20) // 2026-10-20
    await renderToday()

    expect(prepNote()).toBeNull()
    expect(screen.queryByText('Prep week')).toBeNull()
  })

  it('D. no Day 0 and no negative day, across the whole boundary', async () => {
    // Two days before, one before, the day itself, and the day after.
    for (const day of [12, 13, 14, 15]) {
      setDay(2026, 8, day)
      await renderToday()

      const body = document.body.textContent ?? ''
      expect(body, `day ${day}`).not.toMatch(/\b0 days? until Foundation/)
      expect(body, `day ${day}`).not.toMatch(/-\d+ days? until Foundation/)
      expect(body, `day ${day}`).not.toMatch(/Day 0\b/)

      cleanup()
    }
  })
})
