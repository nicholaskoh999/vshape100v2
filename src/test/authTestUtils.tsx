import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'

import { routes } from '@/app/router/router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { SessionState } from '@/features/auth/api'
import { createMediaServer, type MediaServer } from './exerciseMediaApiTestUtils'
import { createHolidayServer, type HolidayServer } from './holidayApiTestUtils'
import { createProgressServer, type ProgressServer } from './progressApiTestUtils'
import { createTodayServer, type TodayServer } from './todayApiTestUtils'
import { createWorkoutServer, type WorkoutServer } from './workoutApiTestUtils'

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
 * Today completions, canonical exercise media, workout logs and Holiday
 * overrides are served by in-memory stand-ins so the real client, hooks and
 * engine all run; pass your own via `today` / `media` / `workouts` /
 * `holidays` to seed saved state or to make requests fail.
 */
export function mockAuthFetch(options: {
  session: SessionState | Promise<SessionState>
  onLogout?: () => void
  today?: TodayServer
  media?: MediaServer
  workouts?: WorkoutServer
  holidays?: HolidayServer
  /**
   * Notification API stand-in. Absent means the deployment has no VAPID
   * configuration, which is the honest default for a test that is not about
   * reminders: Settings reports "unavailable" and asks the browser for nothing.
   */
  notifications?: (url: string, init?: RequestInit) => Promise<Response>
  /**
   * Progress API stand-in. Absent means an account with no measurements and no
   * completed history — the honest default for a test that is not about
   * Progress, and one that never lets a page claim data it does not have.
   */
  progress?: ProgressServer
}) {
  const today = options.today ?? createTodayServer()
  const media = options.media ?? createMediaServer()
  const workouts = options.workouts ?? createWorkoutServer()
  const holidays = options.holidays ?? createHolidayServer()
  const progress = options.progress ?? createProgressServer()

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
    if (url.startsWith('/api/workouts')) {
      return workouts.handle(url, init)
    }
    if (url.startsWith('/api/holidays')) {
      return holidays.handle(url, init)
    }
    if (url.startsWith('/api/progress')) {
      return progress.handle(url, init)
    }
    if (url.startsWith('/api/notifications')) {
      if (options.notifications) return options.notifications(url, init)
      return jsonResponse({ available: false, publicKey: null })
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
