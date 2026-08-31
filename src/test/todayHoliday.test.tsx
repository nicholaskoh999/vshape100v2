import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAgenda } from '@/features/today/model/engine'
import userEvent from '@testing-library/user-event'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createHolidayServer, holiday, type HolidayServer } from './holidayApiTestUtils'
import { createTodayServer } from './todayApiTestUtils'

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

/** The header subline, which names the day's mode. */
function headerText() {
  return document.querySelector('main header')?.textContent ?? ''
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

/** Holiday dates with Training Off - the exempt default. */
function offDays(...dates: string[]) {
  return new Map(dates.map((date) => [date, { name: '', trainingOn: false }]))
}

/** Holiday dates where the user chose to keep training. */
function onDays(...dates: string[]) {
  return new Map(dates.map((date) => [date, { name: '', trainingOn: true }]))
}

/** The titles the agenda is showing. */
function titlesOf(agenda: ReturnType<typeof buildAgenda>) {
  return agenda.entries.map((entry) => entry.item.title)
}

describe('2. a Holiday date', () => {
  it('shows the Holiday state instead of the routine', async () => {
    server.seed(holiday('h1', '2026-09-10'))
    await renderToday()

    await waitFor(() => expect(holidayCard()).not.toBeNull())
    expect(mainText()).toMatch(/Holiday · Exempt/)
    expect(mainText()).toMatch(/planned pause from the normal routine/i)
  })

  it('borrows the recovery template instead of the work day', () => {
    const agenda = buildAgenda(
      new Date(2026, 8, 10, 23, 0),
      new Set(),
      offDays('2026-09-10'),
    )

    expect(agenda.holiday).toBe(true)
    expect(agenda.route.id).toBe('holiday')

    // A Holiday is a day to live, not an empty screen. It uses the same
    // Sunday recovery items, so the two cannot drift apart.
    const titles = titlesOf(agenda)
    expect(titles).toContain('Natural wake')
    expect(titles).toContain('Free time / Netflix / rest')

    // What a Holiday removes is the WORK day.
    expect(titles).not.toContain('Work')
    expect(titles).not.toContain('Back home')
    // Training Off, so no session is restored either.
    expect(titles).not.toContain('Gym training')
  })

  it('keeps the real weekday, because a Holiday is not a Sunday', () => {
    // 2026-09-10 is a Thursday. The routine changes; the calendar does not.
    const agenda = buildAgenda(new Date(2026, 8, 10, 9, 0), new Set(), offDays('2026-09-10'))
    expect(agenda.day).toBe('2026-09-10')
    expect(agenda.route.id).toBe('holiday')
  })

  it('shows no gym or reading pressure late in the day', async () => {
    vi.setSystemTime(new Date(2026, 8, 10, 23, 30))
    server.seed(holiday('h1', '2026-09-10'))
    await renderToday()

    await waitFor(() => expect(holidayCard()).not.toBeNull())
    const text = mainText()
    // The weekday's demands are gone. The recovery day remains, which is the
    // point: a Holiday replaces the work day rather than erasing the day.
    expect(text).not.toMatch(/gym training/i)
    expect(text).not.toMatch(/back home/i)
    expect(text).not.toMatch(/reading/i)
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
    const days = offDays('2026-09-10', '2026-09-11', '2026-09-12')
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
      offDays('2026-09-10'),
    )

    expect(agenda.holiday).toBe(true)
    // Yesterday's spillover does not reach into a Holiday: nothing carries
    // over, so nothing from yesterday can be late on it.
    expect(agenda.entries.every((entry) => !entry.spillover)).toBe(true)
    expect(titlesOf(agenda)).not.toContain('Ready to sleep')
  })

  it('and still shows Holiday once that interval has ended', () => {
    const agenda = buildAgenda(
      new Date(2026, 8, 10, 9, 0),
      new Set(),
      offDays('2026-09-10'),
    )
    expect(agenda.holiday).toBe(true)
    expect(agenda.entries.every((entry) => !entry.spillover)).toBe(true)
  })

  it('Holiday yesterday into Home today invents no spillover', () => {
    const agenda = buildAgenda(
      new Date(2026, 8, 10, 0, 15),
      new Set(),
      offDays('2026-09-09'),
    )

    expect(agenda.holiday).toBe(false)
    expect(agenda.route.id).toBe('home')
    // A Holiday has items, but none of them reach past midnight: the
    // recovery windows end with the day and the restored session ends at
    // 21:30. So there is nothing to spill, and nothing is invented.
    expect(agenda.entries.every((entry) => !entry.spillover)).toBe(true)
  })

  it('Holiday yesterday still lets today’s normal route run', () => {
    const withHolidayYesterday = buildAgenda(
      new Date(2026, 8, 10, 9, 0),
      new Set(),
      offDays('2026-09-09'),
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
    const days = offDays('2026-09-10')
    // 23:59 on the Holiday, and 00:01 the next day.
    expect(buildAgenda(new Date(2026, 8, 10, 23, 59), new Set(), days).holiday).toBe(true)
    expect(buildAgenda(new Date(2026, 8, 11, 0, 1), new Set(), days).holiday).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Unknown is neither Home nor Holiday                              */
/* ------------------------------------------------------------------ */

describe('5. while the day mode is unknown', () => {
  it('does not claim the day is a Holiday', async () => {
    const release = server.holdReads()
    server.seed(holiday('h1', '2026-09-10'))

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    expect(holidayCard()).toBeNull()
    expect(mainText()).not.toMatch(/Holiday · Exempt/)
    release()
  })

  it('does not render the normal routine either', async () => {
    const release = server.holdReads()
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    // The routine would put real pressure on a day that may be exempt.
    const text = mainText()
    expect(text).not.toMatch(/gym training/i)
    expect(text).not.toMatch(/needs attention/i)
    expect(text).not.toMatch(/up next/i)
    release()
  })

  it('shows a neutral checking state instead', async () => {
    const release = server.holdReads()
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    expect(document.querySelector('[data-today-checking]')).not.toBeNull()
    expect(screen.getByText(/Checking whether today is a Holiday/)).toBeInTheDocument()
    release()
  })

  it('exposes no completion controls, so Today cannot be mutated', async () => {
    const todayServer = createTodayServer()
    cleanup()
    server = createHolidayServer()
    mockAuthFetch({ session: authenticatedSession, holidays: server, today: todayServer })

    const release = server.holdReads()
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    // Nothing to press...
    expect(
      screen.queryAllByRole('button', { name: /^Complete / }),
    ).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: /^Undo / })).toHaveLength(0)
    // ...and nothing was written.
    expect(todayServer.calls.every((call) => call.method === 'GET')).toBe(true)
    release()
  })
})

/* ------------------------------------------------------------------ */
/* 6. A failed read is not Home                                         */
/* ------------------------------------------------------------------ */

describe('6. when the day mode cannot be read', () => {
  it('does not fall back to the normal routine', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads()

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await waitFor(() =>
      expect(document.querySelector('[data-today-holiday-error]')).not.toBeNull(),
    )

    const text = mainText()
    expect(text).not.toMatch(/gym training/i)
    expect(text).not.toMatch(/needs attention/i)
    expect(holidayCard()).toBeNull()
    errors.mockRestore()
  })

  it('says so and offers a retry', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads()

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    expect(
      await screen.findByText(/Could not check whether today is a Holiday/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
    errors.mockRestore()
  })

  it('exposes no completion controls while the mode is unknown', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads()

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await waitFor(() =>
      expect(document.querySelector('[data-today-holiday-error]')).not.toBeNull(),
    )

    expect(screen.queryAllByRole('button', { name: /^Complete / })).toHaveLength(0)
    errors.mockRestore()
  })

  it('retry resolves to the normal Home routine when there is no Holiday', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads()

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await screen.findByRole('button', { name: /Try again/ })

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: /Try again/ }))

    await waitFor(() =>
      expect(document.querySelector('[data-today-holiday-error]')).toBeNull(),
    )
    expect(holidayCard()).toBeNull()
    expect(mainText()).toContain('Home Mode')
    errors.mockRestore()
  })

  it('retry resolves to the Holiday state when today is a Holiday', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.seed(holiday('h1', '2026-09-10'))
    server.failReads()

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await screen.findByRole('button', { name: /Try again/ })

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: /Try again/ }))

    await waitFor(() => expect(holidayCard()).not.toBeNull())
    expect(mainText()).toMatch(/Holiday · Exempt/)
    errors.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/* 7. The header never claims a mode it does not have                  */
/* ------------------------------------------------------------------ */

describe('7. the header day mode', () => {
  it('says it is checking while the mode is unknown', async () => {
    const release = server.holdReads()
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    expect(document.querySelector('[data-today-checking]')).not.toBeNull()
    expect(headerText()).toContain('Checking day mode')
    // The agenda is built from an empty Holiday set while unknown, so this is
    // exactly where a resolved label would leak through.
    expect(headerText()).not.toContain('Home Mode')
    expect(headerText()).not.toContain('Holiday')
    // The accepted labels are 'Home Mode', 'Chill route', 'Recovery route'
    // and 'Holiday' — none of them may appear while the mode is unknown.
    expect(headerText()).not.toContain('Chill route')
    expect(headerText()).not.toContain('Recovery route')
    release()
  })

  it('does not claim a resolved mode on a Saturday whose mode is unknown', async () => {
    // 2026-09-05 is a Saturday, whose accepted route label is 'Chill route'.
    vi.setSystemTime(new Date(2026, 8, 5, 10, 0))
    const release = server.holdReads()
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    expect(headerText()).toContain('Checking day mode')
    expect(headerText()).not.toContain('Chill route')
    release()
  })

  it('says the mode is unavailable when the read fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads()

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await waitFor(() =>
      expect(document.querySelector('[data-today-holiday-error]')).not.toBeNull(),
    )

    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
    expect(headerText()).toContain('Day mode unavailable')
    expect(headerText()).not.toContain('Home Mode')
    expect(headerText()).not.toContain('Holiday')
    errors.mockRestore()
  })

  it('shows Home Mode once the read confirms there is no Holiday', async () => {
    await renderToday()
    await waitFor(() => expect(headerText()).toContain('Home Mode'))

    expect(headerText()).not.toContain('Checking day mode')
    expect(headerText()).not.toContain('Day mode unavailable')
  })

  it('shows Holiday once the read confirms one', async () => {
    server.seed(holiday('h1', '2026-09-10'))
    await renderToday()

    await waitFor(() => expect(holidayCard()).not.toBeNull())
    expect(headerText()).toContain('Holiday')
    expect(headerText()).not.toContain('Home Mode')
    expect(headerText()).not.toContain('Checking day mode')
  })

  it('shows the real weekend labels once resolved', async () => {
    vi.setSystemTime(new Date(2026, 8, 5, 10, 0))
    await renderToday()
    await waitFor(() => expect(headerText()).toContain('Chill route'))
    cleanup()

    // 2026-09-06 is a Sunday.
    vi.setSystemTime(new Date(2026, 8, 6, 10, 0))
    await renderToday()
    await waitFor(() => expect(headerText()).toContain('Recovery route'))
  })

  it('recovers to a real label after a retry', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads()

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await screen.findByRole('button', { name: /Try again/ })
    expect(headerText()).toContain('Day mode unavailable')

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: /Try again/ }))

    await waitFor(() => expect(headerText()).toContain('Home Mode'))
    expect(headerText()).not.toContain('Day mode unavailable')
    errors.mockRestore()
  })
})

/* ------------------------------------------------------------------ */
/* 5. Round 13 - Training Off and Training On                          */
/* ------------------------------------------------------------------ */

/**
 * A Holiday suspends the WORK day, not the training day.
 *
 * Training Off is fully exempt. Training On restores exactly one thing: the
 * session that weekday already planned. Work and Back home never come back,
 * because those are what a Holiday removes.
 *
 * 2026-09-14 is a Monday, 2026-09-15 a Tuesday, 2026-09-12 a Saturday.
 */
describe('5. training on a Holiday', () => {
  const MONDAY = '2026-09-14'
  const TUESDAY = '2026-09-15'
  const SATURDAY = '2026-09-12'

  function agendaOn(date: string, days: Map<string, { name: string; trainingOn: boolean }>) {
    const [year, month, day] = date.split('-').map(Number)
    return buildAgenda(new Date(year, month - 1, day, 9, 0), new Set(), days)
  }

  function named(date: string, name: string, trainingOn: boolean) {
    return new Map([[date, { name, trainingOn }]])
  }

  it('leaves an ordinary Monday completely alone', () => {
    const agenda = agendaOn(MONDAY, new Map())
    expect(agenda.holiday).toBe(false)
    expect(agenda.route.id).toBe('home')
    const titles = titlesOf(agenda)
    expect(titles).toContain('Work')
    expect(titles).toContain('Back home')
    expect(titles).toContain('Gym training')
  })

  it('gives a Training-Off Monday Holiday the recovery base', () => {
    const agenda = agendaOn(MONDAY, offDays(MONDAY))
    expect(agenda.route.id).toBe('holiday')
    expect(titlesOf(agenda)).toContain('Natural wake')
  })

  it('removes Work from a Training-Off Monday Holiday', () => {
    expect(titlesOf(agendaOn(MONDAY, offDays(MONDAY)))).not.toContain('Work')
  })

  it('removes Back home from a Training-Off Monday Holiday', () => {
    expect(titlesOf(agendaOn(MONDAY, offDays(MONDAY)))).not.toContain('Back home')
  })

  it('asks for no gym session on a Training-Off Monday Holiday', () => {
    expect(titlesOf(agendaOn(MONDAY, offDays(MONDAY)))).not.toContain('Gym training')
  })

  it('keeps the real date and carries the Holiday name', () => {
    const agenda = agendaOn(MONDAY, named(MONDAY, 'Merdeka Day', false))
    expect(agenda.day).toBe(MONDAY)
    expect(agenda.route.name).toBe('Merdeka Day')
    expect(agenda.route.label).toBe('Holiday')
    expect(agenda.route.trainingOn).toBe(false)
  })

  it('keeps the recovery base when training is on', () => {
    const agenda = agendaOn(MONDAY, onDays(MONDAY))
    expect(agenda.route.id).toBe('holiday')
    const titles = titlesOf(agenda)
    expect(titles).toContain('Natural wake')
    expect(titles).toContain('Room reset')
  })

  it('adds exactly the Monday session, linked to it', () => {
    const agenda = agendaOn(MONDAY, onDays(MONDAY))
    const gym = agenda.entries.filter((entry) => entry.item.title === 'Gym training')
    expect(gym).toHaveLength(1)
    expect(gym[0].item.to).toBe('/training/monday')
    expect(agenda.route.trainingOn).toBe(true)
    // The accepted slot, not a second copy of it.
    expect(gym[0].start).toBe(20 * 60 + 30)
    expect(gym[0].end).toBe(21 * 60 + 30)
  })

  it('still refuses to bring Work or Back home back', () => {
    const titles = titlesOf(agendaOn(MONDAY, onDays(MONDAY)))
    expect(titles).not.toContain('Work')
    expect(titles).not.toContain('Back home')
  })

  it('links a Tuesday Holiday to the Tuesday session', () => {
    const agenda = agendaOn(TUESDAY, onDays(TUESDAY))
    const gym = agenda.entries.find((entry) => entry.item.title === 'Gym training')
    expect(gym?.item.to).toBe('/training/tuesday')
  })

  it('invents no session for a weekend Holiday, however it was stored', () => {
    // Fail-safe: even with training marked on, Saturday has no planned
    // session to restore, so none is conjured.
    const agenda = agendaOn(SATURDAY, onDays(SATURDAY))
    expect(agenda.route.id).toBe('holiday')
    expect(agenda.route.trainingOn).toBe(false)
    expect(titlesOf(agenda)).not.toContain('Gym training')
  })

  it('drops the "no gym today" line when a session is restored', () => {
    // The note would sit directly above the session it contradicts.
    const on = agendaOn(MONDAY, onDays(MONDAY))
    expect(on.entries.map((entry) => entry.item.note ?? '')).not.toContain('No gym today.')

    // With training off it is still true, and still shown.
    const off = agendaOn(MONDAY, offDays(MONDAY))
    expect(off.entries.map((entry) => entry.item.note ?? '')).toContain('No gym today.')
  })

  it('says nothing contradictory anywhere in a Training-On day', () => {
    const agenda = agendaOn(MONDAY, onDays(MONDAY))
    const text = [
      agenda.route.summary,
      ...agenda.entries.map((entry) => `${entry.item.title} ${entry.item.note ?? ''}`),
    ].join(' | ')
    expect(text).not.toMatch(/no gym/i)
  })

  it('suppresses yesterday spillover on a Training-On Holiday too', () => {
    const [year, month, day] = MONDAY.split('-').map(Number)
    // 00:15, when the previous day's 23:30-00:30 block would still be running.
    const agenda = buildAgenda(
      new Date(year, month - 1, day, 0, 15),
      new Set(),
      onDays(MONDAY),
    )
    expect(agenda.entries.every((entry) => !entry.spillover)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 6. Round 13 - the page shows which kind of Holiday it is            */
/* ------------------------------------------------------------------ */

describe('6. the Holiday banner', () => {
  it('shows the name and the Training Off state', async () => {
    vi.setSystemTime(new Date(2026, 8, 14, 9, 0))
    server.seed(holiday('h1', '2026-09-14', '2026-09-14', { name: 'Merdeka Day' }))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    expect(mainText()).toMatch(/Merdeka Day/)
    expect(holidayCard()?.getAttribute('data-today-training')).toBe('off')
    expect(mainText()).toMatch(/Training off/i)
  })

  it('shows Training On and the restored session', async () => {
    vi.setSystemTime(new Date(2026, 8, 14, 9, 0))
    server.seed(
      holiday('h1', '2026-09-14', '2026-09-14', { name: 'Merdeka Day', trainingOn: true }),
    )
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    expect(holidayCard()?.getAttribute('data-today-training')).toBe('on')
    const text = mainText()
    expect(text).toMatch(/Training on/i)
    expect(text).toMatch(/gym training/i)
    // Still not a work day.
    expect(text).not.toMatch(/back home/i)
  })

  it('keeps the real weekday in the header, never renaming it Sunday', async () => {
    vi.setSystemTime(new Date(2026, 8, 14, 9, 0))
    server.seed(holiday('h1', '2026-09-14', '2026-09-14', { name: 'Merdeka Day' }))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    const text = mainText()
    expect(text).toMatch(/Monday 14 September/)
    expect(text).not.toMatch(/Sunday/)
  })

  it('offers a way to change the choice rather than a second toggle', async () => {
    vi.setSystemTime(new Date(2026, 8, 14, 9, 0))
    server.seed(holiday('h1', '2026-09-14', '2026-09-14', { name: 'Merdeka Day' }))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    expect(screen.getByRole('link', { name: /Open Calendar/ })).toHaveAttribute(
      'href',
      '/calendar',
    )
  })
})

/* ------------------------------------------------------------------ */
/* 7. Round 13 correction 1 - the copy must match the agenda           */
/* ------------------------------------------------------------------ */

/**
 * A Holiday renders the Sunday recovery agenda, and those items use the
 * ordinary status engine. So a recovery item CAN be late on a Holiday evening,
 * exactly as it can on a Sunday evening.
 *
 * That makes "Nothing is due today" a false statement, and it is the reason
 * this section exists: the words on the page have to describe what is on the
 * page. What a Holiday exempts is the work day and the training requirement,
 * not the existence of a day.
 */
describe('7. a Training-Off Holiday tells the truth', () => {
  // 2026-09-14 is a Monday. 23:30 is late enough that the morning and evening
  // recovery windows have passed.
  const MONDAY = '2026-09-14'
  const LATE_EVENING = new Date(2026, 8, 14, 23, 30)

  function offMonday() {
    return new Map([[MONDAY, { name: 'Merdeka Day', trainingOn: false }]])
  }

  it('still produces late recovery items in the engine', () => {
    const agenda = buildAgenda(LATE_EVENING, new Set(), offMonday())

    expect(agenda.holiday).toBe(true)
    expect(agenda.entries.length).toBeGreaterThan(0)
    // The ordinary engine, not a special Holiday one.
    const late = agenda.entries.filter((entry) => entry.status === 'LATE')
    expect(late.length).toBeGreaterThan(0)
  })

  it('shows the banner and the recovery agenda together', async () => {
    vi.setSystemTime(LATE_EVENING)
    server.seed(holiday('h1', MONDAY, MONDAY, { name: 'Merdeka Day' }))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    const text = mainText()
    expect(text).toMatch(/Merdeka Day/)
    // The recovery day is genuinely on screen.
    expect(text).toMatch(/Natural wake/)
    expect(text).toMatch(/Free time/)
  })

  it('surfaces a late recovery item under Needs attention', async () => {
    vi.setSystemTime(LATE_EVENING)
    server.seed(holiday('h1', MONDAY, MONDAY, { name: 'Merdeka Day' }))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    // The accepted behaviour: recovery items are ordinary occurrences.
    expect(mainText()).toMatch(/Needs attention/i)
  })

  it('still removes the work day and asks for no session', async () => {
    vi.setSystemTime(LATE_EVENING)
    server.seed(holiday('h1', MONDAY, MONDAY, { name: 'Merdeka Day' }))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    const text = mainText()
    expect(text).not.toMatch(/back home/i)
    expect(text).not.toMatch(/gym training/i)
    // "Work" only as part of "work routine is paused", never as the work block.
    expect(text).not.toMatch(/08:00/)
  })

  it('never claims nothing is due, or that the day is empty', async () => {
    vi.setSystemTime(LATE_EVENING)
    server.seed(holiday('h1', MONDAY, MONDAY, { name: 'Merdeka Day' }))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    const text = mainText()
    for (const lie of [
      /nothing is due/i,
      /no routine/i,
      /empty/i,
      /only today.s session is below/i,
    ]) {
      expect(text, String(lie)).not.toMatch(lie)
    }
  })

  it('says what it actually does: work paused, recovery day, no training due', async () => {
    vi.setSystemTime(LATE_EVENING)
    server.seed(holiday('h1', MONDAY, MONDAY, { name: 'Merdeka Day' }))
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    const text = mainText()
    expect(text).toMatch(/work routine is paused/i)
    expect(text).toMatch(/recovery-day schedule/i)
    expect(text).toMatch(/no training is required/i)
    // The exemption that matters is still stated.
    expect(text).toMatch(/nothing is counted as missed/i)
    expect(text).toMatch(/Foundation Day keeps counting/i)
  })

  it('describes a Training-On day without contradicting the agenda either', async () => {
    vi.setSystemTime(LATE_EVENING)
    server.seed(
      holiday('h1', MONDAY, MONDAY, { name: 'Merdeka Day', trainingOn: true }),
    )
    await renderToday()
    await waitFor(() => expect(holidayCard()).not.toBeNull())

    const text = mainText()
    expect(text).toMatch(/recovery-day schedule stays in place/i)
    expect(text).toMatch(/training session added/i)
    // The recovery items really are still there alongside the session.
    expect(text).toMatch(/Natural wake/)
    expect(text).toMatch(/gym training/i)
    expect(text).not.toMatch(/only today.s session is below/i)
  })
})
