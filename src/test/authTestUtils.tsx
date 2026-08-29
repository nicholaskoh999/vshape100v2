import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'

import { routes } from '@/app/router/router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { SessionState } from '@/features/auth/api'

export const testUser = {
  email: 'person@example.com',
  name: 'Test Person',
  picture: null,
}

export const authenticatedSession: SessionState = {
  authenticated: true,
  user: testUser,
}

export const signedOutSession: SessionState = { authenticated: false, reason: null }

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Stub `fetch` for the auth endpoints. `sessionResponse` may be a value or a
 * promise, which lets a test hold the bootstrap open and assert that nothing
 * protected has rendered yet.
 */
export function mockAuthFetch(options: {
  session: SessionState | Promise<SessionState>
  onLogout?: () => void
}) {
  const handler: FetchHandler = async (url) => {
    if (url.startsWith('/api/auth/session')) {
      return jsonResponse(await options.session)
    }
    if (url.startsWith('/api/auth/logout')) {
      options.onLogout?.()
      return jsonResponse({ authenticated: false })
    }
    throw new Error(`Unexpected fetch in test: ${url}`)
  }

  const spy = vi.fn(handler)
  vi.stubGlobal('fetch', spy)
  return spy
}

/** Render the real route tree at `path` behind the real auth provider. */
export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return router
}
