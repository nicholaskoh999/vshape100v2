import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import {
  createHolidayServer,
  holiday,
  type HolidayServer,
} from './holidayApiTestUtils'

/**
 * Round 11 — the Calendar month view and Holiday editor.
 *
 * Two modes only: Home (no record) and Holiday (a record). Holiday is EXEMPT,
 * and it overrides whatever weekday it lands on. Ranges never merge, split or
 * absorb one another.
 */

/** September 2026: the 1st is a Tuesday, the 5th a Saturday, the 6th a Sunday. */
const IN_SEPTEMBER = new Date(2026, 8, 10, 9, 0)

let server: HolidayServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(IN_SEPTEMBER)
  server = createHolidayServer()
  mockAuthFetch({ session: authenticatedSession, holidays: server })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

async function renderCalendar() {
  renderApp('/calendar')
  await screen.findByRole('heading', { level: 1, name: 'Calendar' })
  // Wait for the first read to settle so days carry their real type.
  await waitFor(() => expect(server.calls.length).toBeGreaterThan(0))
  return user()
}

function cell(date: string): HTMLElement {
  const el = document.querySelector(`[data-day="${date}"]`)
  if (!el) throw new Error(`no calendar cell for ${date}`)
  return el as HTMLElement
}

function typeOf(date: string): string | null {
  return cell(date).getAttribute('data-day-type')
}

function editor(): HTMLElement {
  return document.querySelector('[data-holiday-editor]') as HTMLElement
}

async function settleTypes() {
  await waitFor(() => expect(document.querySelector('[data-calendar-grid]')).not.toBeNull())
}

/* ------------------------------------------------------------------ */
/* 1. Month view                                                       */
/* ------------------------------------------------------------------ */

describe('1. month view', () => {
  it('replaces the placeholder with a real month', async () => {
    await renderCalendar()

    expect(screen.getByText('September 2026')).toBeInTheDocument()
    // The Round 01 placeholders are gone.
    expect(screen.queryByText('Month view')).toBeNull()
    expect(screen.queryByText(/arrives with Holiday persistence/)).toBeNull()
  })

  it('navigates to the previous and next month', async () => {
    const u = await renderCalendar()

    await u.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(await screen.findByText('August 2026')).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Next month' }))
    await u.click(screen.getByRole('button', { name: 'Next month' }))
    expect(await screen.findByText('October 2026')).toBeInTheDocument()
  })

  it('crosses a year boundary', async () => {
    const u = await renderCalendar()
    for (let i = 0; i < 4; i += 1) {
      await u.click(screen.getByRole('button', { name: 'Next month' }))
    }
    expect(await screen.findByText('January 2027')).toBeInTheDocument()
  })

  it('marks weekdays, Saturday and Sunday distinctly', async () => {
    await renderCalendar()
    await settleTypes()

    // 2026-09-10 is a Thursday, the 5th a Saturday, the 6th a Sunday.
    expect(typeOf('2026-09-10')).toBe('training')
    expect(typeOf('2026-09-05')).toBe('saturday')
    expect(typeOf('2026-09-06')).toBe('sunday')
  })

  it('shows a month with no Holiday as entirely normal', async () => {
    await renderCalendar()
    await settleTypes()
    expect(document.querySelectorAll('[data-day-type="holiday"]')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Holiday override                                                 */
/* ------------------------------------------------------------------ */

describe('2. Holiday overrides the day type', () => {
  it('renders a stored range as Holiday', async () => {
    server.seed(holiday('h1', '2026-09-10', '2026-09-14'))
    await renderCalendar()

    await waitFor(() => expect(typeOf('2026-09-10')).toBe('holiday'))
    for (const date of ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']) {
      expect(typeOf(date), date).toBe('holiday')
    }
    // Inclusive: the days either side are untouched.
    expect(typeOf('2026-09-09')).toBe('training')
    expect(typeOf('2026-09-15')).toBe('training')
  })

  it('overrides a Saturday and a Sunday', async () => {
    server.seed(holiday('h1', '2026-09-05', '2026-09-06'))
    await renderCalendar()

    // Holiday replaces the weekend types rather than sitting beside them.
    await waitFor(() => expect(typeOf('2026-09-05')).toBe('holiday'))
    expect(typeOf('2026-09-06')).toBe('holiday')
  })

  it('shows a single-day Holiday', async () => {
    // 2026-09-09 is a Wednesday, with weekdays either side.
    server.seed(holiday('h1', '2026-09-09'))
    await renderCalendar()

    await waitFor(() => expect(typeOf('2026-09-09')).toBe('holiday'))
    expect(typeOf('2026-09-08')).toBe('training')
    expect(typeOf('2026-09-10')).toBe('training')
  })
})

/* ------------------------------------------------------------------ */
/* 3. Loading and failure                                              */
/* ------------------------------------------------------------------ */

describe('3. load states', () => {
  it('says it is loading rather than claiming the month is Home', async () => {
    const release = server.holdReads()
    renderApp('/calendar')
    await screen.findByRole('heading', { level: 1, name: 'Calendar' })

    expect(screen.getByText(/Loading your calendar/)).toBeInTheDocument()
    release()
    await waitFor(() => expect(screen.queryByText(/Loading your calendar/)).toBeNull())
  })

  it('reports a failed load and recovers on retry', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads()
    server.seed(holiday('h1', '2026-09-10'))

    renderApp('/calendar')
    await screen.findByRole('heading', { level: 1, name: 'Calendar' })
    expect(await screen.findByText(/Could not load your calendar/)).toBeInTheDocument()

    await user().click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(typeOf('2026-09-10')).toBe('holiday'))
    errors.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/* 4. Selection                                                        */
/* ------------------------------------------------------------------ */

describe('4. selection', () => {
  it('selects a single day', async () => {
    const u = await renderCalendar()
    await u.click(cell('2026-09-09'))

    expect(within(editor()).getByText('9 Sep 2026')).toBeInTheDocument()
    expect(within(editor()).getByText(/1 day/)).toBeInTheDocument()
  })

  it('selects a range from two clicks', async () => {
    const u = await renderCalendar()
    await u.click(cell('2026-09-10'))
    expect(within(editor()).getByText(/pick a second day/)).toBeInTheDocument()

    await u.click(cell('2026-09-14'))
    expect(within(editor()).getByText('10 Sep 2026 – 14 Sep 2026')).toBeInTheDocument()
    expect(within(editor()).getByText(/5 days/)).toBeInTheDocument()
  })

  it('orders a backwards range', async () => {
    const u = await renderCalendar()
    await u.click(cell('2026-09-14'))
    await u.click(cell('2026-09-10'))
    expect(within(editor()).getByText('10 Sep 2026 – 14 Sep 2026')).toBeInTheDocument()
  })

  it('marks the selected days', async () => {
    const u = await renderCalendar()
    await u.click(cell('2026-09-09'))
    await u.click(cell('2026-09-11'))

    expect(cell('2026-09-10').getAttribute('aria-selected')).toBe('true')
    expect(cell('2026-09-12').getAttribute('aria-selected')).toBe('false')
  })
})

/* ------------------------------------------------------------------ */
/* 5. Save, edit, delete                                               */
/* ------------------------------------------------------------------ */

describe('5. saving a Holiday', () => {
  it('saves a single day and the calendar reflects it', async () => {
    const u = await renderCalendar()
    await u.click(cell('2026-09-09'))
    await u.click(screen.getByRole('button', { name: /Save Holiday/ }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    await waitFor(() => expect(typeOf('2026-09-09')).toBe('holiday'))
    expect([...server.rows.values()][0]).toMatchObject({
      startDate: '2026-09-09',
      endDate: '2026-09-09',
    })
  })

  it('saves an inclusive range', async () => {
    const u = await renderCalendar()
    await u.click(cell('2026-09-10'))
    await u.click(cell('2026-09-14'))
    await u.click(screen.getByRole('button', { name: /Save Holiday/ }))

    await screen.findByText('Saved')
    await waitFor(() => expect(typeOf('2026-09-14')).toBe('holiday'))
    expect(typeOf('2026-09-10')).toBe('holiday')
    expect(typeOf('2026-09-15')).toBe('training')
  })

  it('shows saving progress', async () => {
    const u = await renderCalendar()
    await u.click(cell('2026-09-09'))
    const release = server.hold()
    await u.click(screen.getByRole('button', { name: /Save Holiday/ }))

    expect(await screen.findByText('Saving…')).toBeInTheDocument()
    release()
    await screen.findByText('Saved')
  })

  it('reports an overlap conflict and changes nothing', async () => {
    server.seed(holiday('h1', '2026-09-10', '2026-09-14'))
    const u = await renderCalendar()
    await waitFor(() => expect(typeOf('2026-09-10')).toBe('holiday'))

    // Start outside the range so this is a new selection, then extend into it.
    await u.click(cell('2026-09-08'))
    await u.click(cell('2026-09-11'))
    await u.click(screen.getByRole('button', { name: /Save Holiday/ }))

    expect(await screen.findByText(/overlaps an existing Holiday/)).toBeInTheDocument()
    expect(screen.getByText(/10 Sep 2026 – 14 Sep 2026/)).toBeInTheDocument()
    // Nothing merged, nothing added.
    expect(server.rows.size).toBe(1)
    expect(typeOf('2026-09-08')).toBe('training')
  })

  it('keeps previous state visible when a save fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const u = await renderCalendar()
    server.failMutations()

    await u.click(cell('2026-09-09'))
    await u.click(screen.getByRole('button', { name: /Save Holiday/ }))

    expect(await screen.findByText(/Could not save that change/)).toBeInTheDocument()
    expect(server.rows.size).toBe(0)
    expect(typeOf('2026-09-09')).toBe('training')
    errors.mockRestore()
  })
})

describe('6. editing and deleting', () => {
  it('opens a stored Holiday for editing when clicked', async () => {
    server.seed(holiday('h1', '2026-09-10', '2026-09-14'))
    const u = await renderCalendar()
    await waitFor(() => expect(typeOf('2026-09-10')).toBe('holiday'))

    await u.click(cell('2026-09-11'))
    expect(within(editor()).getByText('10 Sep 2026 – 14 Sep 2026')).toBeInTheDocument()
    expect(within(editor()).getByText(/editing a saved Holiday/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Update Holiday/ })).toBeInTheDocument()
  })

  it('shortens a range', async () => {
    server.seed(holiday('h1', '2026-09-10', '2026-09-14'))
    const u = await renderCalendar()
    await waitFor(() => expect(typeOf('2026-09-10')).toBe('holiday'))

    await u.click(cell('2026-09-11')) // open for editing
    await u.click(cell('2026-09-10')) // new anchor
    await u.click(cell('2026-09-11'))
    await u.click(screen.getByRole('button', { name: /Save Holiday|Update Holiday/ }))

    await screen.findByText('Saved')
    await waitFor(() => expect(typeOf('2026-09-14')).toBe('training'))
    expect(typeOf('2026-09-11')).toBe('holiday')
    expect(server.rows.size).toBe(1)
  })

  it('extends a range without conflicting with itself', async () => {
    server.seed(holiday('h1', '2026-09-10', '2026-09-12'))
    const u = await renderCalendar()
    await waitFor(() => expect(typeOf('2026-09-10')).toBe('holiday'))

    await u.click(cell('2026-09-11')) // open for editing
    await u.click(cell('2026-09-10')) // re-anchor
    await u.click(cell('2026-09-16'))
    await u.click(screen.getByRole('button', { name: /Update Holiday|Save Holiday/ }))

    // Extending over its own days must not be a false overlap.
    await screen.findByText('Saved')
    await waitFor(() => expect(typeOf('2026-09-16')).toBe('holiday'))
    expect(server.rows.size).toBe(1)
  })

  it('deletes a Holiday and the dates revert to normal', async () => {
    server.seed(holiday('h1', '2026-09-10', '2026-09-14'))
    const u = await renderCalendar()
    await waitFor(() => expect(typeOf('2026-09-10')).toBe('holiday'))

    await u.click(cell('2026-09-11'))
    await u.click(screen.getByRole('button', { name: /Delete/ }))

    expect(await screen.findByText('Removed')).toBeInTheDocument()
    await waitFor(() => expect(typeOf('2026-09-11')).toBe('training'))
    expect(typeOf('2026-09-10')).toBe('training')
    expect(server.rows.size).toBe(0)
  })

  it('offers no delete for an unsaved selection', async () => {
    const u = await renderCalendar()
    await u.click(cell('2026-09-09'))
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('leaves other ranges alone when deleting one', async () => {
    server.seed(holiday('h1', '2026-09-01', '2026-09-02'))
    server.seed(holiday('h2', '2026-09-10', '2026-09-12'))
    const u = await renderCalendar()
    await waitFor(() => expect(typeOf('2026-09-01')).toBe('holiday'))

    await u.click(cell('2026-09-01'))
    await u.click(screen.getByRole('button', { name: /Delete/ }))
    await screen.findByText('Removed')

    await waitFor(() => expect(typeOf('2026-09-01')).toBe('training'))
    expect(typeOf('2026-09-10')).toBe('holiday')
  })
})

/* ------------------------------------------------------------------ */
/* 7. Structure                                                        */
/* ------------------------------------------------------------------ */

describe('7. structure', () => {
  it('renders a labelled grid of whole weeks', async () => {
    await renderCalendar()
    const grid = screen.getByRole('grid', { name: 'Month' })
    const cells = within(grid).getAllByRole('gridcell')
    expect(cells.length % 7).toBe(0)
  })

  it('gives every day an accessible label', async () => {
    await renderCalendar()
    expect(cell('2026-09-10')).toHaveAttribute('aria-label', '2026-09-10 · Training')
  })

  it('uses no fixed pixel widths that would overflow a narrow screen', async () => {
    await renderCalendar()
    const fixed = [...document.querySelectorAll('main *')].filter((el) =>
      /(^|\s)w-\[\d+px\]/.test(el.className.toString()),
    )
    expect(fixed).toHaveLength(0)
  })

  it('describes Holiday as exempt, never as missed', async () => {
    server.seed(holiday('h1', '2026-09-10'))
    await renderCalendar()
    await waitFor(() => expect(typeOf('2026-09-10')).toBe('holiday'))

    const text = document.querySelector('main')?.textContent ?? ''
    expect(text).toMatch(/exempt/i)
    // "not missed" is the point being made, so only a claim that a day WAS
    // missed is banned.
    expect(text).toMatch(/not missed/i)
    expect(text.replace(/not missed/gi, '')).not.toMatch(/missed/i)
    for (const banned of [/failed/i, /streak/i, /cheat/i]) {
      expect(text, String(banned)).not.toMatch(banned)
    }
  })
})
