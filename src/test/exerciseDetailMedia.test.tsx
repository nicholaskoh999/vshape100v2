import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createMediaServer, type MediaServer } from './exerciseMediaApiTestUtils'

/**
 * Round 07 — Exercise Detail reads the canonical record.
 *
 * /exercises/:id hydrates the one shared media record for that stable slug,
 * so Lat Pulldown shows the same media whichever day it was opened from. It
 * has no editor of its own: the "Edit media" action goes to the canonical
 * editor in Settings.
 *
 * Nothing here loads a real image — every URL is a fixture and jsdom never
 * fetches one.
 */

const GIF = {
  exerciseId: 'lat-pulldown',
  kind: 'gif' as const,
  url: 'https://media.test.invalid/lat-pulldown.gif',
  alt: 'Lat Pulldown demonstration',
  updatedAt: 1,
}

let server: MediaServer

beforeEach(() => {
  server = createMediaServer()
  mockAuthFetch({ session: authenticatedSession, media: server })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderDetail(path: string) {
  const router = renderApp(path)
  await screen.findByRole('heading', { level: 1 })
  return router
}

function mediaState() {
  return document
    .querySelector('[data-media-state]')
    ?.getAttribute('data-media-state')
}

/* ------------------------------------------------------------------ */
/* Hydration                                                           */
/* ------------------------------------------------------------------ */

describe('canonical media on Exercise Detail', () => {
  it('fetches the record by the stable exercise id', async () => {
    await renderDetail('/exercises/lat-pulldown')
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0))

    expect(server.calls[0]).toMatchObject({
      method: 'GET',
      exerciseId: 'lat-pulldown',
      url: '/api/exercise-media/lat-pulldown',
    })
  })

  it('renders saved media through ExerciseMedia', async () => {
    server.rows.set(GIF.exerciseId, GIF)
    await renderDetail('/exercises/lat-pulldown')

    const image = await screen.findByRole('img')
    expect(image).toHaveAttribute('src', GIF.url)
    expect(image).toHaveAttribute('alt', GIF.alt)
    expect(screen.queryByText('Media coming soon')).not.toBeInTheDocument()
  })

  it('shows the same record whichever day the exercise was opened from', async () => {
    server.rows.set(GIF.exerciseId, GIF)

    for (const from of ['monday', 'wednesday', 'thursday']) {
      await renderDetail(`/exercises/lat-pulldown?from=${from}`)
      expect(await screen.findByRole('img')).toHaveAttribute('src', GIF.url)
      cleanup()
    }

    // One canonical key was requested each time — never a per-day one.
    for (const call of server.calls) {
      expect(call.exerciseId).toBe('lat-pulldown')
      expect(call.url).not.toMatch(/monday|wednesday|thursday/)
    }
  })

  it('falls back to "Media coming soon" when no record exists', async () => {
    await renderDetail('/exercises/plank')

    await waitFor(() => expect(mediaState()).toBe('empty'))
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('does not claim "Media coming soon" while the read is in flight', async () => {
    const release = server.holdReads()
    await renderDetail('/exercises/lat-pulldown')

    expect(mediaState()).toBe('loading')
    expect(screen.queryByText('Media coming soon')).not.toBeInTheDocument()

    release()
    await waitFor(() => expect(mediaState()).toBe('empty'))
  })

  it('handles a failed read without a broken image or a crash', async () => {
    server.failReads(1)
    await renderDetail('/exercises/lat-pulldown')

    await waitFor(() => expect(mediaState()).toBe('error'))
    expect(screen.getByText('Media unavailable')).toBeInTheDocument()
    // No <img> in the media frame at all, so the browser has no broken-image
    // glyph to draw...
    expect(document.querySelector('[data-media-state] img')).toBeNull()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    // ...and the rest of the page is still there.
    expect(
      screen.getByRole('heading', { name: 'Lat Pulldown', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Media coming soon')).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* Edit media shortcut                                                 */
/* ------------------------------------------------------------------ */

describe('the Edit media shortcut', () => {
  it('routes to the one canonical editor', async () => {
    const router = await renderDetail('/exercises/lat-pulldown')

    const edit = screen.getByRole('link', { name: 'Edit media for Lat Pulldown' })
    expect(edit).toHaveAttribute('href', '/settings/exercises/lat-pulldown')

    await userEvent.setup().click(edit)
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/exercises/lat-pulldown'),
    )
    expect(await screen.findByLabelText('Media URL')).toBeInTheDocument()
  })

  it('goes to the same editor from every day the exercise is trained', async () => {
    for (const from of ['monday', 'wednesday', 'thursday']) {
      await renderDetail(`/exercises/lat-pulldown?from=${from}`)
      expect(
        screen.getByRole('link', { name: 'Edit media for Lat Pulldown' }),
      ).toHaveAttribute('href', '/settings/exercises/lat-pulldown')
      cleanup()
    }
  })

  it('carries no editor of its own', async () => {
    server.rows.set(GIF.exerciseId, GIF)
    await renderDetail('/exercises/lat-pulldown')
    await screen.findByRole('img')

    expect(screen.queryByLabelText('Media URL')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save media/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove media/ })).not.toBeInTheDocument()
    // Only the read was made — the page never writes.
    expect(server.calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('is absent for an unknown exercise', async () => {
    await renderDetail('/exercises/not-an-exercise')
    expect(
      screen.getByRole('heading', { name: 'Exercise not found', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Edit media for/ })).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ */
/* Accepted return navigation must still hold                          */
/* ------------------------------------------------------------------ */

describe('return navigation is unchanged', () => {
  it('returns to the session it was opened from', async () => {
    await renderDetail('/exercises/lat-pulldown?from=monday')
    const back = screen.getByRole('link', { name: 'Back to Monday' })
    expect(back).toHaveAttribute('href', '/training/monday')
  })

  it('returns to Training when opened directly', async () => {
    await renderDetail('/exercises/lat-pulldown')
    expect(screen.getByRole('link', { name: 'Back to Training' })).toHaveAttribute(
      'href',
      '/training',
    )
  })

  it('falls back to Training for a hostile origin', async () => {
    for (const from of [
      'https://evil.example.com',
      '//evil.example.com',
      '../../admin',
      'nope',
      '',
    ]) {
      await renderDetail(`/exercises/lat-pulldown?from=${encodeURIComponent(from)}`)
      expect(screen.getByRole('link', { name: 'Back to Training' })).toHaveAttribute(
        'href',
        '/training',
      )
      cleanup()
    }
  })
})
