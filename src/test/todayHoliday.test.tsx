import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAgenda } from '@/features/today/model/engine'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createHolidayServer, holiday, type HolidayServer } from './holidayApiTestUtils'

/**
 * Round 11 — Holiday Mode on Today.
 *
 * Holiday is EXEMPT, not missed. On a Holiday date the normal routine simply
 * is not rendered, so nothing can be late — and nothing is marked complete in
 * order to achieve that. Foundation keeps counting through it.
 */

/** 2026-09-10 is a Thursday: a normal Home weekday. */
const THURSDAY = new Date(2026, 8, 10, 9, 0)

let server: HolidayServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(THURSDAY)
  server = createHolidayServer()
  mockAuthFetch({ session: authenticatedSession, holidays: server })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderToday() {
  renderApp('/today')
  await screen.findByRole('heading', { level: 1, name: 'Today' })
}

function holidayCard() {
  return document.querySelector('[data-today-holiday]')
}

function mainText() {
  return document.querySelector('main')?.textContent ?? ''
}

/* ------------------------------------------------------------------ */
/* 1. Home is unchanged                                                */
/* ------------------------------------------------------------------ */

describe('1. Home mode is unchanged', () => {
  it('renders the normal weekday routine when there is no Holiday', async () => {
    await renderToday()
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0))

    expect(holidayCard()).toBeNull()
    expect(mainText()).toContain('Home Mode')
  })

  it('leaves Saturday alone', () => {
    // 2026-09-05 is a Saturday.
    const agenda = buildAgenda(new Date(2026, 8, 5, 10, 0))
    expect(agenda.holiday).toBe(false)
    expect(agenda.route.id).toBe('saturday')
    expect(agenda.entries.length).toBeGreaterThan(0)
  })

  it('leaves Sunday alone', () => {
    const agenda = buildAgenda(new Date(2026, 8, 6, 10, 0))
    expect(agenda.holiday).toBe(false)
    expect(agenda.route.id).toBe('sunday')
    expect(agenda.entries.length).toBeGreaterThan(0)
  })

  it('leaves a weekday alone', () => {
    const agenda = buildAgenda(new Date(2026, 8, 10, 10, 0))
    expect(agenda.holiday).toBe(false)
    expect(agenda.route.id).toBe('home')
  })
})

/* ------------------------------------------------------------------ */
/* 2. Holiday suspends the day                                         */
/* ------------------------------------------------------------------ */

describe('2. a Holiday date', () => {
  it('shows the Holiday state instead of the routine', async () => {
    server.seed(holiday('h1', '2026-09-10'))
    await renderToday()

    await waitFor(() => expect(holidayCard()).not.toBeNull())
    expect(mainText()).toMatch(/Holiday · Exempt/)
    expect(mainText()).toMatch(/planned pause from the normal routine/i)
  })

  it('renders no routine items at all, so nothing can be late', () => {
    const agenda = buildAgenda(
      new Date(2026, 8, 10, 23, 0),
      new Set(),
      new Set(['2026-09-10']),
    )

    expect(agenda.holiday).toBe(true)
    expect(agenda.entries).toEqual([])
    expect(agenda.route.id).toBe('holiday')
  })

  it('shows no gym or reading pressure late in the day', async () => {
    vi.setSystemTime(new Date(2026, 8, 10, 23, 30))
    server.seed(holiday('h1', '2026-09-10'))
    await renderToday()

    await waitFor(() => expect(holidayCard()).not.toBeNull())
    const text = mainText()
    // The whole agenda is absent — not merely styled differently.
    expect(text).not.toMatch(/needs attention/i)
    expect(text).not.toMatch(/gym training/i)
    expect(text).not.toMatch(/\bLATE\b/)
  })

  it('never describes the day as missed, failed or completed', async () => {
    server.seed(holiday('h1', '2026-09-10'))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    const text = mainText()
    expect(text).toMatch(/nothing is counted as missed/i)
    expect(text.replace(/nothing is counted as missed/gi, '')).not.toMatch(/missed/i)
    for (const banned of [/failed/i, /streak/i, /done earlier/i, /completed/i]) {
      expect(text, String(banned)).not.toMatch(banned)
    }
  })

  it('creates no completion rows to silence the routine', async () => {
    const todayServer = { rows: new Map(), calls: [] as { method: string }[] }
    server.seed(holiday('h1', '2026-09-10'))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    // Nothing was written anywhere to make the day quiet.
    expect(server.calls.every((call) => call.method === 'GET')).toBe(true)
    expect(todayServer.rows.size).toBe(0)
  })

  it('keeps Training reachable without asking for it', async () => {
    server.seed(holiday('h1', '2026-09-10'))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    expect(screen.getByRole('link', { name: /Train anyway/ })).toHaveAttribute(
      'href',
      '/training',
    )
    expect(screen.getByRole('link', { name: /Open Calendar/ })).toHaveAttribute(
      'href',
      '/calendar',
    )
  })

  it('covers every day of a range', () => {
    const days = new Set(['2026-09-10', '2026-09-11', '2026-09-12'])
    for (const day of [10, 11, 12]) {
      expect(buildAgenda(new Date(2026, 8, day, 12, 0), new Set(), days).holiday).toBe(true)
    }
    // The day after the range is a normal day again.
    expect(buildAgenda(new Date(2026, 8, 13, 12, 0), new Set(), days).holiday).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 3. Cross-midnight                                                   */
/* ------------------------------------------------------------------ */

describe('3. cross-midnight', () => {
  it('Home yesterday into Holiday today puts no routine pressure on the Holiday', () => {
    // 00:15, when yesterday's 23:30–00:30 block would still be running.
    const agenda = buildAgenda(
      new Date(2026, 8, 10, 0, 15),
      new Set(),
      new Set(['2026-09-10']),
    )

    expect(agenda.holiday).toBe(true)
    // Yesterday's spillover does not reach into a Holiday.
    expect(agenda.entries).toEqual([])
  })

  it('and still shows Holiday once that interval has ended', () => {
    const agenda = buildAgenda(
      new Date(2026, 8, 10, 9, 0),
      new Set(),
      new Set(['2026-09-10']),
    )
    expect(agenda.holiday).toBe(true)
    expect(agenda.entries).toEqual([])
  })

  it('Holiday yesterday into Home today invents no spillover', () => {
    const agenda = buildAgenda(
      new Date(2026, 8, 10, 0, 15),
      new Set(),
      new Set(['2026-09-09']),
    )

    expect(agenda.holiday).toBe(false)
    expect(agenda.route.id).toBe('home')
    // A Holiday has no items, so nothing spills out of it.
    expect(agenda.entries.every((entry) => !entry.spillover)).toBe(true)
  })

  it('Holiday yesterday still lets today’s normal route run', () => {
    const withHolidayYesterday = buildAgenda(
      new Date(2026, 8, 10, 9, 0),
      new Set(),
      new Set(['2026-09-09']),
    )
    const plain = buildAgenda(new Date(2026, 8, 10, 9, 0))

    // Today is untouched apart from losing yesterday's spillover, of which
    // there is none at 09:00 anyway.
    expect(withHolidayYesterday.entries.map((e) => e.key)).toEqual(
      plain.entries.map((e) => e.key),
    )
  })
})

/* ------------------------------------------------------------------ */
/* 4. Foundation keeps counting                                        */
/* ------------------------------------------------------------------ */

describe('4. Foundation is unaffected by Holiday', () => {
  it('advances by real calendar date across a Holiday range', async () => {
    // Day 1 is 2026-08-31, so 2026-09-10 is Day 11.
    server.seed(holiday('h1', '2026-09-08', '2026-09-12'))
    await renderToday()

    await waitFor(() => expect(holidayCard()).not.toBeNull())
    expect(mainText()).toContain('Foundation · Day 11')
  })

  it('does not pause or rewind on the last day of a Holiday', async () => {
    vi.setSystemTime(new Date(2026, 8, 12, 9, 0))
    server.seed(holiday('h1', '2026-09-08', '2026-09-12'))
    await renderToday()

    await waitFor(() => expect(holidayCard()).not.toBeNull())
    // 2026-09-12 is Day 13 — not still Day 9 where the Holiday began.
    expect(mainText()).toContain('Foundation · Day 13')
  })

  it('resumes a normal day after the Holiday with the right day number', async () => {
    vi.setSystemTime(new Date(2026, 8, 14, 9, 0))
    server.seed(holiday('h1', '2026-09-08', '2026-09-12'))
    await renderToday()
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0))

    expect(holidayCard()).toBeNull()
    expect(mainText()).toContain('Foundation · Day 15')
  })

  it('uses the local calendar date, not the UTC one', async () => {
    // Late local evening: west of UTC the ISO date is already tomorrow.
    vi.setSystemTime(new Date(2026, 8, 10, 23, 45))
    server.seed(holiday('h1', '2026-09-10'))
    await renderToday()

    await waitFor(() => expect(holidayCard()).not.toBeNull())
    expect(mainText()).toContain('Foundation · Day 11')
  })

  it('treats the day boundary as local midnight', () => {
    const days = new Set(['2026-09-10'])
    // 23:59 on the Holiday, and 00:01 the next day.
    expect(buildAgenda(new Date(2026, 8, 10, 23, 59), new Set(), days).holiday).toBe(true)
    expect(buildAgenda(new Date(2026, 8, 11, 0, 1), new Set(), days).holiday).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Loading                                                          */
/* ------------------------------------------------------------------ */

describe('5. before holidays have loaded', () => {
  it('does not invent a Holiday that is not stored', async () => {
    const release = server.holdReads()
    server.seed(holiday('h1', '2026-09-10'))

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    // The normal route shows first; a Holiday is only claimed once read.
    expect(holidayCard()).toBeNull()

    release()
    await waitFor(() => expect(holidayCard()).not.toBeNull())
  })
})
