import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchHolidays, HolidayApiError } from '@/features/calendar/holidayApi'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createHolidayServer, type HolidayServer } from './holidayApiTestUtils'

/**
 * Round 13 correction 1 - the Holiday read fails closed.
 *
 * Two of the fields on a Holiday decide things a default must never decide:
 *
 *   `source`     grants or withholds permission to rename, move and delete.
 *                Guessing "custom" would hand the editor a canonical company
 *                date.
 *   `trainingOn` decides whether the day is a scheduled training day at all.
 *                Guessing false would discard an explicit Training On and can
 *                turn a day that WAS trained into a missed one.
 *
 * The dangerous failure is quieter than either: silently dropping an
 * unreadable Holiday from an otherwise successful list. That converts "we
 * cannot read this" into "there is no Holiday here" - a RESOLVED empty span,
 * which is exactly what makes Today claim Home, the Calendar become
 * actionable, and Achievements judge the day.
 *
 * So a malformed row fails the whole read, and that failure travels through
 * the existing error state.
 */

/** A well-formed company record, as the server sends it. */
const VALID_COMPANY = {
  id: 'company:2026-09-16',
  startDate: '2026-09-16',
  endDate: '2026-09-16',
  name: 'Malaysia Day',
  source: 'company',
  trainingOn: false,
  createdAt: 0,
  updatedAt: 0,
}

/** A well-formed custom record. */
const VALID_CUSTOM = {
  id: 'holiday-1',
  startDate: '2026-09-21',
  endDate: '2026-09-23',
  name: 'Family trip',
  source: 'custom',
  trainingOn: true,
  createdAt: 1,
  updatedAt: 2,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The same record with one field removed entirely. */
function without(record: Record<string, unknown>, field: string) {
  const copy = { ...record }
  delete copy[field]
  return copy
}

/** Make the next Holiday list read answer 200 with exactly this body. */
function serveList(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(body)),
  )
}

async function readSpan() {
  return fetchHolidays({ from: '2026-09-01', to: '2026-09-30' })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* 1. Valid payloads still parse                                       */
/* ------------------------------------------------------------------ */

describe('1. well-formed Holidays', () => {
  it('parses a company record with its permissions intact', async () => {
    serveList({ from: '2026-09-01', to: '2026-09-30', holidays: [VALID_COMPANY] })
    const records = await readSpan()

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      id: 'company:2026-09-16',
      name: 'Malaysia Day',
      source: 'company',
      trainingOn: false,
    })
  })

  it('parses a custom record, training and all', async () => {
    serveList({ from: '2026-09-01', to: '2026-09-30', holidays: [VALID_CUSTOM] })
    const records = await readSpan()

    expect(records[0]).toMatchObject({
      source: 'custom',
      name: 'Family trip',
      trainingOn: true,
    })
  })

  it('accepts a genuinely empty span', async () => {
    serveList({ from: '2026-09-01', to: '2026-09-30', holidays: [] })
    await expect(readSpan()).resolves.toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* 2. Permission-bearing truth is never guessed                        */
/* ------------------------------------------------------------------ */

describe('2. source must be stated', () => {
  it('fails rather than assuming a missing source is custom', async () => {
    serveList({ holidays: [without(VALID_COMPANY, 'source')] })

    await expect(readSpan()).rejects.toBeInstanceOf(HolidayApiError)
  })

  it('fails on an unrecognised source rather than falling back', async () => {
    for (const source of ['COMPANY', 'user', '', null, 1, true]) {
      serveList({ holidays: [{ ...VALID_COMPANY, source }] })
      await expect(readSpan(), JSON.stringify(source)).rejects.toBeInstanceOf(
        HolidayApiError,
      )
    }
  })

  it('never yields a record that claims to be custom', async () => {
    // The failure mode this exists to prevent: a company date arriving
    // unreadable and being handed to the editor as the user's own.
    serveList({ holidays: [without(VALID_COMPANY, 'source')] })

    const records = await readSpan().catch(() => null)
    expect(records).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 3. Schedule-bearing truth is never guessed                          */
/* ------------------------------------------------------------------ */

describe('3. trainingOn must be stated', () => {
  it('fails rather than assuming a missing preference is Off', async () => {
    serveList({ holidays: [without(VALID_CUSTOM, 'trainingOn')] })

    await expect(readSpan()).rejects.toBeInstanceOf(HolidayApiError)
  })

  it('fails on a non-boolean preference', async () => {
    for (const trainingOn of ['true', 1, 0, null, 'on']) {
      serveList({ holidays: [{ ...VALID_CUSTOM, trainingOn }] })
      await expect(readSpan(), JSON.stringify(trainingOn)).rejects.toBeInstanceOf(
        HolidayApiError,
      )
    }
  })
})

/* ------------------------------------------------------------------ */
/* 4. The rest of the shape                                            */
/* ------------------------------------------------------------------ */

describe('4. every required field', () => {
  it('fails on a missing or malformed field', async () => {
    const broken: Record<string, unknown>[] = [
      { ...VALID_CUSTOM, id: '' },
      { ...VALID_CUSTOM, id: 42 },
      { ...VALID_CUSTOM, startDate: '2026-9-1' },
      { ...VALID_CUSTOM, startDate: '2026-02-30' },
      { ...VALID_CUSTOM, endDate: undefined },
      // End before start is not a range anyone drew.
      { ...VALID_CUSTOM, startDate: '2026-09-23', endDate: '2026-09-21' },
      { ...VALID_CUSTOM, name: null },
      { ...VALID_CUSTOM, createdAt: '1' },
      { ...VALID_CUSTOM, updatedAt: null },
    ]

    for (const row of broken) {
      serveList({ holidays: [row] })
      await expect(readSpan(), JSON.stringify(row)).rejects.toBeInstanceOf(HolidayApiError)
    }
  })

  it('fails when the list itself is not a list', async () => {
    for (const holidays of [undefined, null, {}, 'none', 7]) {
      serveList({ from: '2026-09-01', to: '2026-09-30', holidays })
      await expect(readSpan(), JSON.stringify(holidays)).rejects.toBeInstanceOf(
        HolidayApiError,
      )
    }
  })
})

/* ------------------------------------------------------------------ */
/* 5. One bad row fails the whole span                                 */
/* ------------------------------------------------------------------ */

describe('5. a malformed row is not merely dropped', () => {
  it('fails the read even when every other row is valid', async () => {
    serveList({
      holidays: [VALID_COMPANY, { ...VALID_CUSTOM, source: undefined }, VALID_CUSTOM],
    })

    await expect(readSpan()).rejects.toBeInstanceOf(HolidayApiError)
  })

  it('does not return the readable rows and quietly lose the rest', async () => {
    // Returning 2 of 3 would present a span as fully known while a Holiday in
    // it had been silently discarded.
    serveList({
      holidays: [VALID_COMPANY, { ...VALID_CUSTOM, trainingOn: 'yes' }, VALID_CUSTOM],
    })

    const records = await readSpan().catch(() => 'failed')
    expect(records).toBe('failed')
  })
})

/* ------------------------------------------------------------------ */
/* 6. The failure reaches the pages                                    */
/* ------------------------------------------------------------------ */

/**
 * A Holiday server whose list read answers 200 with an unreadable Holiday.
 *
 * This is the case a permissive parser would turn into a resolved empty span,
 * so these assert the opposite: the pages stay unresolved.
 */
function malformedServer(): HolidayServer {
  const server = createHolidayServer()
  const real = server.handle
  server.handle = async (url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      // Valid HTTP, unreadable content.
      return jsonResponse({ holidays: [{ ...VALID_COMPANY, source: 'mystery' }] })
    }
    return real(url, init)
  }
  return server
}

describe('6. pages stay unresolved', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 14, 9, 0))
  })

  it('Today does not fall back to Home', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAuthFetch({ session: authenticatedSession, holidays: malformedServer() })

    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await waitFor(() =>
      expect(document.querySelector('[data-today-holiday-error]')).not.toBeNull(),
    )

    const text = document.querySelector('main')?.textContent ?? ''
    expect(text).toMatch(/Day mode unavailable/)
    expect(text).not.toMatch(/Home Mode/)
    errors.mockRestore()
  })

  it('Calendar stays non-actionable rather than showing an empty month', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAuthFetch({ session: authenticatedSession, holidays: malformedServer() })

    renderApp('/calendar')
    await screen.findByRole('heading', { level: 1, name: 'Calendar' })
    await waitFor(() =>
      expect(document.querySelector('main')?.textContent).toMatch(
        /Could not load your calendar/,
      ),
    )

    // No grid to draw on, and nothing to rename, move or delete.
    expect(document.querySelector('[data-calendar-grid]')).toBeNull()
    expect(screen.queryByRole('button', { name: /Save Holiday|Update Holiday/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Delete$/ })).toBeNull()
    expect(document.querySelector('[data-holiday-training-control]')).toBeNull()
    errors.mockRestore()
  })

  it('Achievements states no streak from unreadable Holiday truth', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAuthFetch({ session: authenticatedSession, holidays: malformedServer() })

    renderApp('/achievements')
    await screen.findByRole('heading', { level: 1, name: 'Achievements' })
    await waitFor(() =>
      expect(
        document.querySelector('[data-streak-summary]')?.getAttribute('data-streak-state'),
      ).toBe('unavailable'),
    )

    const summary = document.querySelector('[data-streak-summary]')?.textContent ?? ''
    expect(summary).toMatch(/rest days cannot be told from missed ones/)
    expect(summary).not.toMatch(/Current streak/)
    errors.mockRestore()
  })
})
