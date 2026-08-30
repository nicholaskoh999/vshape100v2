import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'

import { routes } from '@/app/router/router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { SessionState } from '@/features/auth/api'
import { createMediaServer, type MediaServer } from './exerciseMediaApiTestUtils'
import { createTodayServer, type TodayServer } from './todayApiTestUtils'

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
 * Stub `fetch` for the app's own endpoints. `session` may be a value or a
 * promise, which lets a test hold the bootstrap open and assert that nothing
 * protected has rendered yet.
 *
 * Today completions and canonical exercise media are served by in-memory
 * stand-ins so the real client, hooks and engine all run; pass your own via
 * `today` / `media` to seed saved state or to make requests fail.
 */
export function mockAuthFetch(options: {
  session: SessionState | Promise<SessionState>
  onLogout?: () => void
  today?: TodayServer
  media?: MediaServer
}) {
  const today = options.today ?? createTodayServer()
  const media = options.media ?? createMediaServer()

  const handler: FetchHandler = async (url, init) => {
    if (url.startsWith('/api/auth/session')) {
      return jsonResponse(await options.session)
    }
    if (url.startsWith('/api/auth/logout')) {
      options.onLogout?.()
      return jsonResponse({ authenticated: false })
    }
    if (url.startsWith('/api/today/completions')) {
      return today.handle(url, init)
    }
    if (url.startsWith('/api/exercise-media')) {
      return media.handle(url, init)
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
