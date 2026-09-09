import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminPage } from '@/features/admin/AdminPage'
import { AuthContext, type AuthValue } from '@/features/auth/AuthContext'
import type { AdminOverview } from '@shared/admin'

/**
 * ADMIN LITE SPIKE — the page.
 *
 * WHAT THESE DEFEND, IN ONE SENTENCE EACH:
 *
 *   an Unknown is shown as Unknown, and a real zero as 0
 *   a refusal shows a refusal and NOT a page of green ticks
 *   the Danger Zone has no control in it at all — no button, no link, no form
 *   Day 1 cannot be written without a deliberate confirmation
 *
 * The real page, the real client and the real contract parser run together; only
 * `fetch` is stood in for.
 */

const USER = { email: 'owner@example.invalid', name: 'Owner', picture: null }

const auth: AuthValue = {
  status: 'authenticated',
  user: USER,
  endReason: null,
  signOutNotice: null,
  refresh: async () => {},
  logout: async () => {},
  isLoggingOut: false,
}

function overview(patch: Partial<AdminOverview> = {}): AdminOverview {
  return {
    system: {
      api: 'healthy',
      d1: 'healthy',
      cron: 'unknown',
      cronReason: 'no_observed_sweep',
      cronLastSweepAt: null,
      buildSha: null,
      migrationLevel: null,
    },
    account: {
      foundation: { status: 'set', date: '2026-08-31' },
      programme: { status: 'seed' },
      pushDevices: 1,
      activeSessions: 2,
    },
    activity: {
      workoutOccurrences: 0,
      workoutSets: 0,
      bodyWeightEntries: 0,
      todayCompletions: 0,
      workoutCorrections: 0,
      trainingFlex: 0,
    },
    maintenance: {
      state: 'off',
      enforced: false,
      controllable: false,
      reason: 'no_persistent_store',
    },
    dangerZone: { freshActivityReset: { available: false, managedBy: 'round25-operator' } },
    ...patch,
  }
}

type Reply = { status?: number; body: unknown }

let calls: { url: string; init?: RequestInit }[] = []

/** Stand in for the server: one reply for the overview, one for the write. */
function server(replies: { overview: Reply; write?: Reply }) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const reply = url.includes('foundation-start') ? (replies.write ?? { body: {} }) : replies.overview
      const status = reply.status ?? 200
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => reply.body,
      } as Response
    }),
  )
}

function renderAdmin() {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <AdminPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const writes = () => calls.filter((call) => call.url.includes('foundation-start'))

/** The status card for one subsystem: name, chip and note, and nothing else. */
const systemCard = (name: string) =>
  screen.getByText(name).closest('div')?.parentElement as HTMLElement

/**
 * Put a real date into the control.
 *
 * The field opens holding the CURRENT Day 1, so it is cleared first — typing
 * into it otherwise appends, which a `type="date"` input refuses to hold, and
 * the test would then be passing for the wrong reason.
 */
async function setNewDay1(user: ReturnType<typeof userEvent.setup>, value: string) {
  const field = screen.getByLabelText('New Day 1')
  await user.clear(field)
  await user.type(field, value)
  return field
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ */

describe('1. the page shows what is known, and says so when nothing is', () => {
  it('A. renders the four subsystems with the server’s own words', async () => {
    server({ overview: { body: overview() } })
    renderAdmin()

    await screen.findByText('App')
    // Three of the four are proven; the scheduler is not, and says Unknown.
    expect(screen.getAllByText('Healthy')).toHaveLength(3)
    expect(within(systemCard('Cron')).getByText('Unknown')).toBeInTheDocument()
    expect(within(systemCard('Cron')).queryByText('Healthy')).not.toBeInTheDocument()
    expect(
      within(systemCard('Cron')).getByText(
        /No reminder has been due, so there is nothing to prove it ran/,
      ),
    ).toBeInTheDocument()
  })

  it('B. a failed D1 read is shown as an Error, not softened', async () => {
    server({ overview: { body: overview({ system: { ...overview().system, d1: 'error' } }) } })
    renderAdmin()

    await screen.findByText('D1')
    expect(within(systemCard('D1')).getByText('Error')).toBeInTheDocument()
    expect(within(systemCard('D1')).getByText(/did not answer a trivial read/)).toBeInTheDocument()
  })

  it('C. an unreadable count reads Unknown — and a real zero reads 0', async () => {
    server({
      overview: {
        body: overview({
          activity: {
            workoutOccurrences: 12,
            // Could not be read. THE WHOLE POINT: this must not become "0".
            workoutSets: null,
            bodyWeightEntries: 0,
            todayCompletions: 4,
            workoutCorrections: null,
            trainingFlex: 0,
          },
        }),
      },
    })
    renderAdmin()

    const activity = await screen.findByRole('region', { name: 'Activity' })
    const row = (label: string) =>
      within(activity).getByText(label).closest('div') as HTMLElement

    expect(within(row('Workouts')).getByText('12')).toBeInTheDocument()
    expect(within(row('Sets')).getByText('Unknown')).toBeInTheDocument()
    expect(within(row('Weight entries')).getByText('0')).toBeInTheDocument()
    expect(within(row('Corrections')).getByText('Unknown')).toBeInTheDocument()

    // Anti-vacuity: an Unknown row must not ALSO be rendering a zero somewhere.
    expect(within(row('Sets')).queryByText('0')).not.toBeInTheDocument()
  })

  it('D. an absent build SHA and migration level read Unknown, never invented', async () => {
    server({ overview: { body: overview() } })
    renderAdmin()

    await screen.findByText('Build')
    for (const label of ['Build', 'D1 migration level']) {
      const row = screen.getByText(label).closest('div') as HTMLElement
      expect(within(row).getByText('Unknown')).toBeInTheDocument()
    }
  })
})

describe('2. a refusal is a refusal', () => {
  it('A. a 403 shows the refusal and no system, account or activity data', async () => {
    server({ overview: { status: 403, body: { error: 'forbidden' } } })
    renderAdmin()

    await screen.findByText('Not available for this account')
    for (const label of ['App', 'D1', 'Workouts', 'Foundation Day 1', 'Fresh Activity Reset']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument()
  })

  it('B. an unreadable envelope shows nothing rather than a status that might be wrong', async () => {
    // A body that is not the shape this client speaks — an error payload, a
    // proxy page, a newer schema. All of them must fail closed.
    server({ overview: { body: { system: 'fine' } } })
    renderAdmin()

    await screen.findByText('Status could not be read')
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument()
  })

  it('C. a server error keeps the page empty and offers Refresh', async () => {
    server({ overview: { status: 500, body: { error: 'server_error' } } })
    renderAdmin()

    await screen.findByText('Could not load system status')
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument()
  })
})

describe('3. the danger zone is display only', () => {
  it('A. explains the reset, names its owner, and contains no control at all', async () => {
    server({ overview: { body: overview() } })
    const { container } = renderAdmin()

    await screen.findByText('Fresh Activity Reset')
    const zone = container.querySelector('[data-admin-danger-zone]') as HTMLElement
    expect(zone).toBeTruthy()

    expect(
      within(zone).getByText('Clears activity history while preserving configuration.'),
    ).toBeInTheDocument()
    expect(within(zone).getByText(/Managed separately/)).toBeInTheDocument()

    // The claim that matters: nothing in this region can be pressed.
    expect(zone.querySelectorAll('button')).toHaveLength(0)
    expect(zone.querySelectorAll('a')).toHaveLength(0)
    expect(zone.querySelectorAll('input')).toHaveLength(0)
    expect(zone.querySelectorAll('form')).toHaveLength(0)
  })

  it('B. maintenance offers no working switch, and says why', async () => {
    server({ overview: { body: overview() } })
    renderAdmin()

    await screen.findByText('Maintenance mode')
    expect(screen.getByText('OFF')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Turn on/ })).toBeDisabled()
    expect(screen.getByText(/Designed, not wired/)).toBeInTheDocument()
  })
})

describe('4. Day 1 cannot be changed by accident', () => {
  it('A. editing then saving asks for a confirmation, and writes NOTHING yet', async () => {
    server({ overview: { body: overview() } })
    renderAdmin()
    const user = userEvent.setup()

    await screen.findByText('Foundation Day 1')
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    await setNewDay1(user, '2026-09-14')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // The confirmation names both dates.
    await screen.findByText('Confirm Day 1')
    expect(
      screen.getByText(/Change Foundation Day 1 from 2026-08-31 to 2026-09-14/),
    ).toBeInTheDocument()
    expect(screen.getByText(/this is not the Fresh Activity Reset/)).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
  })

  it('B. backing out of the confirmation writes nothing', async () => {
    server({ overview: { body: overview() } })
    renderAdmin()
    const user = userEvent.setup()

    await screen.findByText('Foundation Day 1')
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    await setNewDay1(user, '2026-09-14')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Confirm Day 1')
    await user.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(screen.queryByText('Confirm Day 1')).not.toBeInTheDocument())
    expect(writes()).toHaveLength(0)
  })

  it('C. confirming sends an explicit confirm flag and adopts what the SERVER stored', async () => {
    server({
      overview: { body: overview() },
      // The server re-read the row and returned a DIFFERENT date from the one
      // typed. The page must show the stored one.
      write: { body: { foundation: { status: 'set', date: '2026-09-15' } } },
    })
    renderAdmin()
    const user = userEvent.setup()

    await screen.findByText('Foundation Day 1')
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    await setNewDay1(user, '2026-09-14')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Confirm Day 1')
    await user.click(screen.getByRole('button', { name: /Confirm change/ }))

    await screen.findByText('Day 1 saved.')
    expect(writes()).toHaveLength(1)
    expect(writes()[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(writes()[0].init?.body))).toEqual({
      foundationStartDate: '2026-09-14',
      confirm: true,
    })
    expect(screen.getByText('2026-09-15')).toBeInTheDocument()
    expect(screen.queryByText('2026-09-14')).not.toBeInTheDocument()
  })

  it('D. an impossible calendar date cannot be submitted', async () => {
    server({ overview: { body: overview() } })
    renderAdmin()
    const user = userEvent.setup()

    await screen.findByText('Foundation Day 1')
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    // A `type="date"` control refuses to HOLD an impossible value at all, so
    // the field is left empty rather than storing 2026-02-30 — the first of
    // three guards, and the reason the UI never sees the value.
    const field = await setNewDay1(user, '2026-02-30')
    expect((field as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(writes()).toHaveLength(0)
  })

  it('E. a refused write leaves the previously stored date on screen', async () => {
    server({
      overview: { body: overview() },
      write: { status: 403, body: { error: 'forbidden' } },
    })
    renderAdmin()
    const user = userEvent.setup()

    await screen.findByText('Foundation Day 1')
    await user.click(screen.getByRole('button', { name: /Edit/ }))
    await setNewDay1(user, '2026-09-14')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Confirm Day 1')
    await user.click(screen.getByRole('button', { name: /Confirm change/ }))

    await screen.findByText(/not allowed to change Day 1/)
    // The authoritative value is untouched.
    expect(screen.getByText('2026-08-31')).toBeInTheDocument()
  })

  it('F. an unreadable stored date is reported, never replaced with a default', async () => {
    server({
      overview: {
        body: overview({
          account: { ...overview().account, foundation: { status: 'unreadable' } },
        }),
      },
    })
    renderAdmin()

    await screen.findByText('Foundation Day 1')
    expect(screen.getByText(/stored value could not be read/)).toBeInTheDocument()
    expect(screen.queryByText('2026-08-31')).not.toBeInTheDocument()
  })
})
