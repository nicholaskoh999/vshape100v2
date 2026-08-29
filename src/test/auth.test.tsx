import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as authApi from '@/features/auth/api'
import {
  authenticatedSession,
  mockAuthFetch,
  renderApp,
  signedOutSession,
} from './authTestUtils'

beforeEach(() => {
  vi.spyOn(authApi, 'navigateToGoogle').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('route guard', () => {
  it('sends an unauthenticated visitor from a protected route to /login', async () => {
    mockAuthFetch({ session: signedOutSession })
    const router = renderApp('/today')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(await screen.findByText('Build your foundation.')).toBeInTheDocument()
  })

  it('preserves the intended destination in ?next=', async () => {
    mockAuthFetch({ session: signedOutSession })
    const router = renderApp('/training/monday')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe('?next=%2Ftraining%2Fmonday')
  })

  it('does not add ?next= for the default destination', async () => {
    mockAuthFetch({ session: signedOutSession })
    const router = renderApp('/today')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe('')
  })

  it('lets an authenticated user through to the protected route', async () => {
    mockAuthFetch({ session: authenticatedSession })
    const router = renderApp('/training/monday')

    expect(await screen.findByRole('heading', { name: 'Back Width + Biceps' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/training/monday')
  })

  it('never flashes protected content while the session is resolving', async () => {
    // Hold the session request open so the app stays in bootstrap.
    let release: (value: typeof authenticatedSession) => void = () => {}
    const pending = new Promise<typeof authenticatedSession>((resolve) => {
      release = resolve
    })
    mockAuthFetch({ session: pending })

    renderApp('/today')

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument()

    release(authenticatedSession)
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
  })

  it('keeps the user out when the session request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const router = renderApp('/progress')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})

describe('login screen', () => {
  it('shows the brand, CTA and trusted-device option', async () => {
    mockAuthFetch({ session: signedOutSession })
    renderApp('/login')

    expect(await screen.findByRole('button', { name: /Continue with Google/ })).toBeInTheDocument()
    expect(screen.getByText('Build your foundation.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Trust this device/ })).toBeInTheDocument()
    expect(screen.getByText('Stay signed in for 30 days')).toBeInTheDocument()
    expect(screen.getByText(/Private · Personal/)).toBeInTheDocument()
  })

  it('does not render the app navigation shell', async () => {
    mockAuthFetch({ session: signedOutSession })
    renderApp('/login')

    await screen.findByRole('button', { name: /Continue with Google/ })
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /More/ })).not.toBeInTheDocument()
  })

  it('redirects an already-authenticated user away from /login', async () => {
    mockAuthFetch({ session: authenticatedSession })
    const router = renderApp('/login')

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })

  it('honours a safe ?next= when an authenticated user opens /login', async () => {
    mockAuthFetch({ session: authenticatedSession })
    const router = renderApp('/login?next=%2Fcalendar')

    await waitFor(() => expect(router.state.location.pathname).toBe('/calendar'))
  })

  it('ignores an external ?next= and falls back to /today', async () => {
    mockAuthFetch({ session: authenticatedSession })
    const router = renderApp('/login?next=https%3A%2F%2Fevil.example.com')

    await waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })

  it('starts the Google flow and shows a pending state', async () => {
    const user = userEvent.setup()
    mockAuthFetch({ session: signedOutSession })
    renderApp('/login?next=%2Fprogress')

    await user.click(await screen.findByRole('button', { name: /Continue with Google/ }))

    expect(authApi.navigateToGoogle).toHaveBeenCalledWith('/api/auth/google/start?next=%2Fprogress')
    expect(await screen.findByText('Taking you to Google')).toBeInTheDocument()
  })

  it('asks for a trusted session when the box is checked', async () => {
    const user = userEvent.setup()
    mockAuthFetch({ session: signedOutSession })
    renderApp('/login')

    await user.click(await screen.findByRole('checkbox', { name: /Trust this device/ }))
    await user.click(screen.getByRole('button', { name: /Continue with Google/ }))

    expect(authApi.navigateToGoogle).toHaveBeenCalledWith('/api/auth/google/start?trust=1')
  })

  it.each([
    ['unauthorized', 'That Google account is not authorized.'],
    ['expired', 'Your sign-in expired. Try again.'],
    ['failed', "We couldn't complete sign-in. Try again."],
  ])('shows a calm message for the %s error', async (code, message) => {
    mockAuthFetch({ session: signedOutSession })
    renderApp(`/login?error=${code}`)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
  })

  it('explains an expired session reported by the server', async () => {
    mockAuthFetch({ session: { authenticated: false, reason: 'expired' } })
    renderApp('/login')

    expect(await screen.findByRole('alert')).toHaveTextContent('Your sign-in expired. Try again.')
  })

  it('shows no error on a clean first visit', async () => {
    mockAuthFetch({ session: signedOutSession })
    renderApp('/login')

    await screen.findByRole('button', { name: /Continue with Google/ })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('logout', () => {
  it('revokes the session and returns to the login screen', async () => {
    const user = userEvent.setup()
    const onLogout = vi.fn()
    mockAuthFetch({ session: authenticatedSession, onLogout })
    const router = renderApp('/settings')

    await user.click(await screen.findByRole('button', { name: /Sign out/ }))

    expect(onLogout).toHaveBeenCalled()
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(await screen.findByRole('button', { name: /Continue with Google/ })).toBeInTheDocument()
  })

  it('shows the signed-in account on Settings', async () => {
    mockAuthFetch({ session: authenticatedSession })
    renderApp('/settings')

    expect(await screen.findByText('person@example.com')).toBeInTheDocument()
    expect(screen.getByText('Test Person')).toBeInTheDocument()
  })
})

describe('auth client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('treats a non-OK session response as signed out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(authApi.fetchSession()).resolves.toEqual({
      authenticated: false,
      reason: null,
    })
  })

  it('builds the start URL without noise for the default destination', () => {
    expect(authApi.googleStartUrl('/today', false)).toBe('/api/auth/google/start')
    expect(authApi.googleStartUrl('/today', true)).toBe('/api/auth/google/start?trust=1')
    expect(authApi.googleStartUrl('/calendar', true)).toBe(
      '/api/auth/google/start?next=%2Fcalendar&trust=1',
    )
  })

  it('sends the logout request as a same-origin POST', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)

    await authApi.postLogout()

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/logout')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
  })
})

describe('unrendered by default', () => {
  it('does not call the session endpoint more than once on bootstrap', async () => {
    const spy = mockAuthFetch({ session: authenticatedSession })
    renderApp('/today')

    await screen.findByRole('heading', { name: 'Today' })
    const sessionCalls = spy.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/auth/session'),
    )
    expect(sessionCalls).toHaveLength(1)
  })
})

// Guards against the provider being dropped from the tree.
describe('useAuth misuse', () => {
  it('fails loudly outside the provider', async () => {
    const { RequireAuth } = await import('@/features/auth/RequireAuth')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<RequireAuth />)).toThrow(/AuthProvider/)
    spy.mockRestore()
  })
})
