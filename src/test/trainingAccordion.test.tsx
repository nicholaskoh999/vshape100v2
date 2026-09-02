import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { trainingSessions } from '@/features/training/sessions'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'

/**
 * Round 05 — the in-session exercise accordion.
 *
 * Rows expand in place; nothing navigates until the user follows the detail
 * link. Everything shown must come from the *session's own* entry, never from
 * a slug lookup that would return another day's prescription.
 */

beforeEach(() => {
  mockAuthFetch({ session: authenticatedSession })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openSession(sessionId: string) {
  const user = userEvent.setup()
  const router = renderApp(`/training/${sessionId}`)
  // ROUND 22. The session comes from the account's programme, so the page
  // starts on a loading header. Wait past it rather than measuring it.
  await waitFor(() => {
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).not.toBe('Loading')
  })
  return { router, user }
}

/** Every compact row trigger, in list order (nav buttons excluded). */
function triggers() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      'button[aria-controls^="exercise-panel-"]',
    ),
  ]
}

function trigger(name: string) {
  return screen.getByRole('button', { name: new RegExp(name) })
}

/** The panel a trigger says it controls. */
function panelOf(button: HTMLElement) {
  const id = button.getAttribute('aria-controls')
  return id ? document.getElementById(id) : null
}

/** Wait for collapse animations to finish so exactly one panel remains. */
async function settledPanels(count: number) {
  return waitFor(() => {
    const panels = screen.queryAllByRole('region')
    expect(panels).toHaveLength(count)
    return panels
  })
}

describe('1. compact by default', () => {
  it('renders every exercise collapsed', async () => {
    await openSession('monday')

    const rows = triggers()
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.queryAllByRole('region')).toHaveLength(0)
    expect(
      screen.queryByRole('link', { name: 'Open exercise details' }),
    ).not.toBeInTheDocument()
  })

  it('still shows the compact summary for scanning', async () => {
    await openSession('monday')
    expect(trigger('Lat Pulldown')).toHaveTextContent('4 × 10–15 · BAND 20kg')
    expect(trigger('One-Arm DB Row')).toHaveTextContent('3 × 8–12 · DB + Bench Flat')
  })
})

describe('2–5. accordion behaviour', () => {
  it('2. expands the activated exercise', async () => {
    const { user } = await openSession('monday')
    await user.click(trigger('Lat Pulldown'))

    const panels = await settledPanels(1)
    expect(within(panels[0]).getByText('4 × 10–15')).toBeInTheDocument()
  })

  it('3. marks the expanded trigger aria-expanded="true"', async () => {
    const { user } = await openSession('monday')
    await user.click(trigger('Lat Pulldown'))

    expect(trigger('Lat Pulldown')).toHaveAttribute('aria-expanded', 'true')
    // ...and every other row stays false.
    for (const row of triggers().filter((r) => r !== trigger('Lat Pulldown'))) {
      expect(row).toHaveAttribute('aria-expanded', 'false')
    }
  })

  it('4. collapses when the same exercise is activated again', async () => {
    const { user } = await openSession('monday')
    await user.click(trigger('Lat Pulldown'))
    expect(trigger('Lat Pulldown')).toHaveAttribute('aria-expanded', 'true')

    await user.click(trigger('Lat Pulldown'))
    expect(trigger('Lat Pulldown')).toHaveAttribute('aria-expanded', 'false')
    await settledPanels(0)
  })

  it('5. opening another exercise closes the first', async () => {
    const { user } = await openSession('monday')
    await user.click(trigger('Lat Pulldown'))
    await user.click(trigger('One-Arm DB Row'))

    expect(trigger('Lat Pulldown')).toHaveAttribute('aria-expanded', 'false')
    expect(trigger('One-Arm DB Row')).toHaveAttribute('aria-expanded', 'true')

    // Exactly one panel survives, and it is the new one.
    const panels = await settledPanels(1)
    expect(panels[0]).toBe(panelOf(trigger('One-Arm DB Row')))
    expect(within(panels[0]).getByText('3 × 8–12')).toBeInTheDocument()
  })

  it('nothing navigates just from expanding', async () => {
    const { router, user } = await openSession('monday')
    await user.click(trigger('Lat Pulldown'))
    await user.click(trigger('Face Pull'))
    await user.click(trigger('Face Pull'))

    expect(router.state.location.pathname).toBe('/training/monday')
    expect(router.state.location.search).toBe('')
  })
})

describe('6–7. keyboard', () => {
  it('6. Enter opens and closes the focused exercise', async () => {
    const { user } = await openSession('monday')
    const row = trigger('Lat Pulldown')
    row.focus()
    expect(row).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(trigger('Lat Pulldown')).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Enter}')
    expect(trigger('Lat Pulldown')).toHaveAttribute('aria-expanded', 'false')
  })

  it('7. Space opens and closes the focused exercise', async () => {
    const { user } = await openSession('monday')
    trigger('Lat Pulldown').focus()

    await user.keyboard('[Space]')
    expect(trigger('Lat Pulldown')).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('[Space]')
    expect(trigger('Lat Pulldown')).toHaveAttribute('aria-expanded', 'false')
  })

  it('is reachable by Tab and keeps focus on the trigger when opening', async () => {
    const { user } = await openSession('monday')
    const first = triggers()[0]

    // Tab forward until the first exercise trigger takes focus.
    for (let i = 0; i < 60 && document.activeElement !== first; i += 1) {
      await user.tab()
    }
    expect(first).toHaveFocus()

    await user.keyboard('{Enter}')
    // Opening must not steal focus away from the trigger.
    expect(first).toHaveFocus()
    expect(first).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not move focus when another row is opened', async () => {
    const { user } = await openSession('monday')
    await user.click(trigger('Lat Pulldown'))

    const second = trigger('One-Arm DB Row')
    second.focus()
    await user.keyboard('{Enter}')

    expect(second).toHaveFocus()
  })
})

describe('8–9. ARIA wiring', () => {
  it('8. aria-controls resolves to the panel that opened', async () => {
    const { user } = await openSession('monday')
    const row = trigger('Lat Pulldown')
    const panelId = row.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()

    await user.click(row)
    const panel = panelOf(trigger('Lat Pulldown'))
    expect(panel).not.toBeNull()
    expect(panel).toHaveAttribute('id', panelId as string)
    expect(within(panel as HTMLElement).getByText('4 × 10–15')).toBeInTheDocument()
  })

  it('9. the panel is labelled by its own trigger', async () => {
    const { user } = await openSession('monday')
    await user.click(trigger('Lat Pulldown'))

    const row = trigger('Lat Pulldown')
    const panel = panelOf(row) as HTMLElement
    expect(panel).toHaveAttribute('aria-labelledby', row.id)
    expect(row.id).toBeTruthy()
    // The region is therefore reachable by the exercise's own name.
    expect(screen.getByRole('region', { name: /Lat Pulldown/ })).toBe(panel)
  })

  it('gives every row a unique, stable pair of ids', async () => {
    await openSession('monday')
    const ids = triggers().flatMap((row) => [row.id, row.getAttribute('aria-controls')!])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(Boolean)).toBe(true)
  })

  it('keeps ids unique across a session that repeats no slug', async () => {
    await openSession('friday')
    const all = [...document.querySelectorAll('[id]')].map((el) => el.id)
    expect(new Set(all).size).toBe(all.length)
  })

  it('uses a real button, not a div with handlers', async () => {
    await openSession('monday')
    for (const row of triggers()) {
      expect(row.tagName).toBe('BUTTON')
      expect(row).toHaveAttribute('type', 'button')
    }
  })
})

describe('10–13. the prescription always comes from this session', () => {
  it.each([
    ['monday', 'Monday', '4 × 10–15', 'BAND 20kg'],
    ['wednesday', 'Wednesday', '2 × 15–20', null],
    ['thursday', 'Thursday', '4 × 10–15', null],
  ])(
    '%s Lat Pulldown shows that day’s entry',
    async (sessionId, _day, sets, equipment) => {
      const { user } = await openSession(sessionId)
      await user.click(trigger('Lat Pulldown'))

      const panel = within((await settledPanels(1))[0])
      expect(panel.getByText('Prescribed')).toBeInTheDocument()
      expect(panel.getByText(sets)).toBeInTheDocument()

      if (equipment) {
        expect(panel.getByText('Equipment')).toBeInTheDocument()
        expect(panel.getByText(equipment)).toBeInTheDocument()
      } else {
        // No equipment in the session data means no invented equipment text.
        expect(panel.queryByText('Equipment')).not.toBeInTheDocument()
      }
    },
  )

  it('13. never falls back to the first occurrence of the slug', async () => {
    // Monday is the first session carrying Lat Pulldown and the only one with
    // equipment, so a slug lookup would leak "BAND 20kg" into Thursday.
    const first = trainingSessions.find((session) =>
      session.exercises.some((exercise) => exercise.id === 'lat-pulldown'),
    )
    expect(first?.id).toBe('monday')

    const { user } = await openSession('thursday')
    await user.click(trigger('Lat Pulldown'))

    const panel = within((await settledPanels(1))[0])
    expect(panel.queryByText('BAND 20kg')).not.toBeInTheDocument()
    expect(panel.queryByText('Equipment')).not.toBeInTheDocument()
    expect(panel.getByText('4 × 10–15')).toBeInTheDocument()
  })

  it('matches the session data exactly, row by row', async () => {
    for (const session of trainingSessions) {
      const { user } = await openSession(session.id)
      for (const [index, exercise] of session.exercises.entries()) {
        const rows = triggers()
        await user.click(rows[index])
        const panel = within((await settledPanels(1))[0])
        expect(panel.getByText(exercise.sets)).toBeInTheDocument()
        if (exercise.equipment) {
          expect(panel.getByText(exercise.equipment)).toBeInTheDocument()
        } else {
          expect(panel.queryByText('Equipment')).not.toBeInTheDocument()
        }
        await user.click(rows[index])
      }
      cleanupRender()
    }
    /*
      This one opens and closes every exercise of every session — around forty
      render-and-settle cycles — and takes close to four seconds on an idle
      machine against Vitest's five-second default. It has always been the
      slowest test in the suite by an order of magnitude, and it began timing
      out once Round 15 added enough files for the parallel run to eat its
      remaining margin. The budget is raised because the test is slow, not
      because it is unreliable: nothing it asserts has changed.
    */
  }, 30_000)
})

describe('14–15. Open exercise details carries this session', () => {
  it.each([
    ['monday', 'lat-pulldown', 'Back Width + Biceps'],
    ['thursday', 'lat-pulldown', 'Back Thickness + Chest + Biceps'],
    ['wednesday', 'lat-pulldown', 'Light Back + Rear Delts + Core'],
  ])('from %s', async (sessionId, slug) => {
    const { router, user } = await openSession(sessionId)
    await user.click(trigger('Lat Pulldown'))

    const link = (await settledPanels(1))[0].querySelector('a') as HTMLAnchorElement
    expect(link).toHaveAttribute('href', `/exercises/${slug}?from=${sessionId}`)
    expect(link).toHaveTextContent('Open exercise details')

    await user.click(link)
    expect(router.state.location.pathname).toBe(`/exercises/${slug}`)
    expect(router.state.location.search).toBe(`?from=${sessionId}`)
  })
})

describe('19. session-not-found is unchanged', () => {
  it('shows the friendly shell and no exercise rows', async () => {
    await openSession('someday')
    expect(
      screen.getByRole('heading', { name: 'Session not found' }),
    ).toBeInTheDocument()
    expect(triggers()).toHaveLength(0)
  })
})

/** Tear down between iterations of the data-driven sweep. */
function cleanupRender() {
  document.body.innerHTML = ''
}
