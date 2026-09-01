import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createSettingsServer, type SettingsServer } from './settingsApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'
import { fetchSettings, SettingsApiError } from '@/features/settings/settingsApi'

/**
 * Round 18 Correction 1 — the CLIENT boundary also fails closed.
 *
 * The server refuses an unreadable stored value (worker/test/settingsRoutes),
 * but the client must not depend on that having happened. It re-classifies the
 * response itself, so a value this build cannot read — a corrupt column that
 * slipped through, or a field shape from a newer schema — becomes an error
 * rather than `null`.
 *
 * That distinction is the whole bug: `null` means "no preference", which
 * resolves to the legacy 2026-08-31 and is then rendered as an authoritative
 * Day number that can be wrong by weeks.
 */

const LEGACY_DAY_PATTERN = /Day \d+ \/ 100/

/** The Foundation card's phase marker; absent when the card withholds. */
const foundationCard = () => document.querySelector('[data-foundation-phase]')
/** Proves the Progress page has finished loading before an absence is asserted. */
const bodyWeightState = () =>
  document.querySelector('[data-body-weight]')?.getAttribute('data-body-weight-state') ?? null
const BEFORE = new Date(2026, 8, 10, 12, 0, 0)

let settings: SettingsServer
let workouts: WorkoutServer

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(BEFORE)
  settings = createSettingsServer()
  workouts = createWorkoutServer()
  mockAuthFetch({ session: authenticatedSession, settings, workouts })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */
/* The parser itself                                                   */
/* ------------------------------------------------------------------ */

describe('the response parser', () => {
  it.each([
    { why: 'shape-valid but impossible', value: '2026-02-30' as unknown },
    { why: 'impossible month', value: '2026-13-01' },
    { why: 'empty string', value: '' },
    { why: 'wrong type', value: 42 },
    { why: 'boolean', value: true },
    { why: 'a future-schema object', value: { date: '2026-09-01' } },
    { why: 'a future-schema array', value: ['2026-09-01'] },
  ])('refuses $why rather than reading it as "no preference"', async ({ value }) => {
    settings.corruptRead(value)
    await expect(fetchSettings()).rejects.toBeInstanceOf(SettingsApiError)
  })

  it('still accepts the two legitimate answers', async () => {
    // Guards the refusals above from being a blanket rejection.
    settings.seed(null)
    await expect(fetchSettings()).resolves.toEqual({ foundationStartDate: null })

    settings.seed('2026-09-01')
    await expect(fetchSettings()).resolves.toEqual({ foundationStartDate: '2026-09-01' })
  })

  it.each([
    { why: 'an empty object', body: {} as unknown },
    { why: 'a null body', body: null },
    { why: 'an array', body: [] },
    { why: 'a populated array', body: [{ foundationStartDate: null }] },
    { why: 'a number', body: 42 },
    { why: 'a string', body: '2026-09-01' },
    { why: 'a boolean', body: true },
    { why: 'an object carrying some other shape', body: { error: 'server_error' } },
    { why: 'an error payload with no settings at all', body: { error: 'settings_unreadable' } },
    { why: 'a future schema that moved the field', body: { foundation: { startDate: '2026-09-01' } } },
    { why: 'a near-miss key', body: { foundation_start_date: '2026-09-01' } },
  ])('refuses $why — the required field is absent', async ({ body }) => {
    // Round 18 Correction 2. This replaced a test that asserted the OPPOSITE —
    // that an omitted field was legitimate "unset". It is not: "no preference"
    // has exactly one wire spelling, `{ foundationStartDate: null }`, so an
    // absent required field means the envelope is not one this client can read.
    // Treating it as unset resolved it to the legacy 2026-08-31 and rendered
    // that as an authoritative Day number.
    settings.corruptBody(body)
    await expect(fetchSettings()).rejects.toBeInstanceOf(SettingsApiError)
  })

  it('accepts the two valid envelopes, and only those', async () => {
    // The controls. Without these the refusals above could pass by rejecting
    // everything, which would be a different bug wearing the same green tick.
    settings.corruptBody({ foundationStartDate: null })
    await expect(fetchSettings()).resolves.toEqual({ foundationStartDate: null })

    settings.corruptBody({ foundationStartDate: '2026-09-01' })
    await expect(fetchSettings()).resolves.toEqual({ foundationStartDate: '2026-09-01' })

    // Extra keys alongside the required one are tolerated: a server that grows a
    // field must not break a client that has not learned about it yet.
    settings.corruptBody({ foundationStartDate: null, somethingNew: 1 })
    await expect(fetchSettings()).resolves.toEqual({ foundationStartDate: null })
  })

  it('does not change the D1 no-row semantics', async () => {
    // An absent ROW is still a real "no preference": the server answers it as
    // an explicit null, and that stays legitimate. Only an absent FIELD is a
    // malformed envelope.
    settings.seed(null)
    await expect(fetchSettings()).resolves.toEqual({ foundationStartDate: null })
  })
})

/* ------------------------------------------------------------------ */
/* What the user actually sees                                         */
/* ------------------------------------------------------------------ */

describe('the app given an unreadable stored value', () => {
  it('shows the error state and NO Foundation day number', async () => {
    settings.corruptRead('2026-02-30', 99)
    renderApp('/settings')

    await screen.findByRole('heading', { level: 2, name: /Foundation Start Date/i })
    // The card reports it cannot answer...
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // ...and above all does not present the legacy date as the saved truth.
    expect(screen.queryByText(/2026-08-31/)).not.toBeInTheDocument()
    expect(screen.queryByText(LEGACY_DAY_PATTERN)).not.toBeInTheDocument()
  })

  it('withholds the Foundation day on Progress rather than guessing', async () => {
    settings.corruptRead('2026-02-30', 99)
    renderApp('/progress')

    await screen.findByRole('heading', { name: 'Progress' })
    // Wait for the page to SETTLE before asserting an absence. Without this the
    // assertion could pass merely because nothing had rendered yet, which is how
    // a test stops discriminating without anyone noticing.
    await waitFor(() => expect(bodyWeightState()).toBe('ready'))

    // The Foundation card renders nothing at all when the start date is
    // unavailable, so its phase marker is the positive signal that it withheld.
    expect(foundationCard()).toBeNull()
    expect(screen.queryByText(LEGACY_DAY_PATTERN)).not.toBeInTheDocument()
  })

  it('leaves Training usable — the refusal is contained', async () => {
    // A corrupt display preference must not take the schedule down with it.
    settings.corruptRead('2026-02-30', 99)
    renderApp('/training')

    expect(await screen.findByRole('heading', { name: 'Training' })).toBeInTheDocument()
    expect(await screen.findByText(/Back Width \+ Biceps/i)).toBeInTheDocument()
  })

  it('recovers on retry once the value reads cleanly', async () => {
    // One corrupt read, then a healthy one: the error must not be sticky.
    settings.corruptRead('2026-02-30', 1)
    settings.seed('2026-09-01')
    renderApp('/settings')

    await screen.findByRole('heading', { level: 2, name: /Foundation Start Date/i })
    const retry = await screen.findByRole('button', { name: /try again/i })
    retry.click()

    await waitFor(() => {
      expect(screen.getByText(/Saved: 2026-09-01/)).toBeInTheDocument()
    })
  })
})

/* ------------------------------------------------------------------ */
/* Correction 2 — a malformed envelope in the real app                 */
/* ------------------------------------------------------------------ */

describe('the app given an envelope with the field missing', () => {
  it('shows the error state and never the legacy date', async () => {
    settings.corruptBody({}, 99)
    renderApp('/settings')

    await screen.findByRole('heading', { level: 2, name: /Foundation Start Date/i })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // The exact failure this correction is for: {} must not become 2026-08-31.
    expect(screen.queryByText(/2026-08-31/)).not.toBeInTheDocument()
    expect(screen.queryByText(LEGACY_DAY_PATTERN)).not.toBeInTheDocument()
  })

  it('withholds the Foundation day on Progress', async () => {
    settings.corruptBody({ error: 'server_error' }, 99)
    renderApp('/progress')

    await screen.findByRole('heading', { name: 'Progress' })
    await waitFor(() => expect(bodyWeightState()).toBe('ready'))

    expect(foundationCard()).toBeNull()
    expect(screen.queryByText(LEGACY_DAY_PATTERN)).not.toBeInTheDocument()
  })

  it('leaves Training usable — the refusal is contained', async () => {
    settings.corruptBody(null, 99)
    renderApp('/training')

    expect(await screen.findByRole('heading', { name: 'Training' })).toBeInTheDocument()
    expect(await screen.findByText(/Back Width \+ Biceps/i)).toBeInTheDocument()
  })

  it('recovers once a well-formed envelope arrives', async () => {
    settings.corruptBody({}, 1)
    settings.seed('2026-09-01')
    renderApp('/settings')

    await screen.findByRole('heading', { level: 2, name: /Foundation Start Date/i })
    const retry = await screen.findByRole('button', { name: /try again/i })
    retry.click()

    await waitFor(() => {
      expect(screen.getByText(/Saved: 2026-09-01/)).toBeInTheDocument()
    })
  })
})
