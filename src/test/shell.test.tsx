import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'

// Round 02 put every app route behind the auth guard, so the shell tests now
// run as a signed-in user. Auth behaviour itself is covered in auth.test.tsx.
beforeEach(() => {
  mockAuthFetch({ session: authenticatedSession })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  return renderApp(path)
}

describe('routing', () => {
  it('redirects / to /today', async () => {
    const router = renderAt('/')
    expect(
      // This is the FIRST render in this file, so it pays the worker's
      // cold-start cost — module evaluation plus the auth bootstrap — before
      // Today can paint. Testing Library's 1s default is enough on an idle
      // machine and not always enough when the whole suite is running in
      // parallel on a loaded one. The wait is widened rather than the
      // behaviour changed: every later assertion in this file keeps the
      // default, and this one still fails if the redirect does not happen.
      await screen.findByRole('heading', { name: 'Today' }, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/today')
  })

  it('keeps /login outside the guarded shell', async () => {
    const router = renderAt('/login')
    await screen.findByRole('heading', { name: 'Today' })
    // An authenticated visitor is moved off the login screen.
    expect(router.state.location.pathname).toBe('/today')
  })

  it.each([
    ['/today', 'Today'],
    ['/training', 'Training'],
    ['/progress', 'Progress'],
    ['/calendar', 'Calendar'],
    ['/achievements', 'Achievements'],
    ['/settings', 'Settings'],
  ])('resolves %s', async (path, heading) => {
    renderAt(path)
    expect(
      await screen.findByRole('heading', { name: heading }),
    ).toBeInTheDocument()
  })

  it('resolves the nested training session shell', async () => {
    renderAt('/training/monday')
    expect(
      await screen.findByRole('heading', { name: 'Back Width + Biceps' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Lat Pulldown')).toBeInTheDocument()
  })

  it('resolves the nested exercise detail shell', async () => {
    renderAt('/exercises/lat-pulldown')
    expect(
      await screen.findByRole('heading', { name: 'Lat Pulldown' }),
    ).toBeInTheDocument()
  })

  it('shows a not-found shell for unknown URLs', async () => {
    renderAt('/nope')
    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
  })

  it('shows a friendly shell for an unknown training session', async () => {
    renderAt('/training/someday')
    expect(
      await screen.findByRole('heading', { name: 'Session not found' }),
    ).toBeInTheDocument()
  })
})

describe('mobile bottom navigation', () => {
  it('offers the five accepted items', async () => {
    renderAt('/today')
    // jsdom renders every breakpoint variant; the bottom nav is the one
    // that owns the More button.
    const navs = await screen.findAllByRole('navigation', { name: 'Primary' })
    const bottomNav = navs.find((nav) =>
      within(nav).queryByRole('button', { name: /More/ }),
    )
    expect(bottomNav).toBeDefined()
    for (const label of ['Today', 'Training', 'Progress', 'Calendar', 'More']) {
      expect(within(bottomNav!).getByText(label)).toBeInTheDocument()
    }
  })

  it('opens the More sheet with Achievements and Settings', async () => {
    const user = userEvent.setup()
    renderAt('/today')
    await user.click(await screen.findByRole('button', { name: /More/ }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('link', { name: /Achievements/ }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('link', { name: /Settings/ }),
    ).toBeInTheDocument()
  })

  it('navigates to Settings from the More sheet', async () => {
    const user = userEvent.setup()
    const router = renderAt('/today')
    await user.click(await screen.findByRole('button', { name: /More/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('link', { name: /Settings/ }))
    expect(router.state.location.pathname).toBe('/settings')
  })
})

describe('training navigation', () => {
  it('links every weekday session from the training page', async () => {
    renderAt('/training')
    for (const focus of [
      'Back Width + Biceps',
      'Upper Chest + Shoulders + Triceps',
      'Light Back + Rear Delts + Core',
      'Back Thickness + Chest + Biceps',
      'Upper Chest + Shoulders + Arms',
    ]) {
      expect(await screen.findByText(focus)).toBeInTheDocument()
    }
  })

  it('navigates from session to exercise detail', async () => {
    const user = userEvent.setup()
    const router = renderAt('/training/friday')
    // Rows expand in place; the detail link lives in the expanded panel.
    await user.click(await screen.findByRole('button', { name: /Hammer Curl/ }))
    await user.click(await screen.findByRole('link', { name: 'Open exercise details' }))
    expect(router.state.location.pathname).toBe('/exercises/hammer-curl')
  })
})
