import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { exerciseCatalog } from '@/features/training/catalog'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createMediaServer, type MediaServer } from './exerciseMediaApiTestUtils'

/**
 * Round 07 — Settings → Exercise Library and the one canonical media editor.
 *
 * The real router, the real pages, the real client and the real hooks run
 * against an in-memory stand-in for the API. Nothing here loads a real image:
 * jsdom never fetches one, and every URL is a fixture.
 */

const GIF = {
  exerciseId: 'lat-pulldown',
  kind: 'gif' as const,
  url: 'https://media.test.invalid/lat-pulldown.gif',
  alt: 'Lat Pulldown demonstration',
  updatedAt: 1,
}

const NEW_URL = 'https://media.test.invalid/lat-pulldown-v2.gif'

let server: MediaServer

beforeEach(() => {
  server = createMediaServer()
  mockAuthFetch({ session: authenticatedSession, media: server })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function user() {
  return userEvent.setup()
}

/** Render at `path` and wait for the media status line to settle. */
async function renderAt(path: string) {
  const router = renderApp(path)
  // ROUND 22. The session comes from the account's programme, so the page
  // starts on a loading header. Wait past it rather than measuring it.
  await waitFor(() => {
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).not.toBe('Loading')
  })
  return router
}

function urlField() {
  return screen.getByLabelText('Media URL')
}

function altField() {
  return screen.getByLabelText('Alt / Label')
}

function saveButton() {
  return screen.getByRole('button', { name: /media$/i })
}

/* ------------------------------------------------------------------ */
/* Settings entry                                                      */
/* ------------------------------------------------------------------ */

describe('Settings entry', () => {
  it('offers an Exercise Library action', async () => {
    await renderAt('/settings')
    const entry = await screen.findByRole('link', { name: 'Exercise Library' })
    expect(entry).toHaveAttribute('href', '/settings/exercises')
  })

  it('is keyboard reachable and navigates on Enter', async () => {
    const router = await renderAt('/settings')
    const entry = await screen.findByRole('link', { name: 'Exercise Library' })

    entry.focus()
    expect(entry).toHaveFocus()
    await user().keyboard('{Enter}')

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/exercises'),
    )
  })
})

/* ------------------------------------------------------------------ */
/* The library list                                                    */
/* ------------------------------------------------------------------ */

describe('Exercise Library', () => {
  it('lists every exercise exactly once', async () => {
    await renderAt('/settings/exercises')
    const rows = await screen.findAllByRole('link', { name: /^Edit settings for / })
    expect(rows).toHaveLength(exerciseCatalog.length)
  })

  it('shows Lat Pulldown once, not once per training day', async () => {
    await renderAt('/settings/exercises')
    const rows = await screen.findAllByRole('link', { name: 'Edit settings for Lat Pulldown' })
    expect(rows).toHaveLength(1)
    expect(screen.getAllByText('Lat Pulldown')).toHaveLength(1)
  })

  it('summarises where an exercise is used', async () => {
    await renderAt('/settings/exercises')
    const row = await screen.findByRole('link', { name: 'Edit settings for Lat Pulldown' })
    expect(within(row).getByText('Used in Monday · Wednesday · Thursday')).toBeInTheDocument()

    const single = screen.getByRole('link', { name: 'Edit settings for Dead Bug' })
    expect(within(single).getByText('Used in Wednesday')).toBeInTheDocument()
  })

  it('reports media status per exercise once it is known', async () => {
    server.rows.set(GIF.exerciseId, GIF)
    await renderAt('/settings/exercises')

    const withMedia = await screen.findByRole('link', { name: 'Edit settings for Lat Pulldown' })
    await waitFor(() => expect(within(withMedia).getByText('Media set')).toBeInTheDocument())

    const without = screen.getByRole('link', { name: 'Edit settings for Plank' })
    expect(within(without).getByText('No media')).toBeInTheDocument()
  })

  it('never claims "No media" before the server has answered', async () => {
    const release = server.holdReads()
    await renderAt('/settings/exercises')
    // ROUND 22. The rows come from the account's programme, which resolves
    // independently of the media read being held here — so wait for a row to
    // exist before asserting what it says about media.
    await screen.findByRole('link', { name: 'Edit settings for Plank' })
    // The row shows "Checking" while the read is outstanding.
    expect(screen.getAllByText('Checking').length).toBeGreaterThan(0)
    expect(screen.queryByText('No media')).not.toBeInTheDocument()
    release()
    await waitFor(() => expect(screen.getAllByText('No media').length).toBeGreaterThan(0))
  })

  it('surfaces a load failure with a retry rather than a false empty', async () => {
    server.failReads(1)
    await renderAt('/settings/exercises')

    await screen.findByText('Media status could not be loaded.')
    await user().click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() =>
      expect(screen.queryByText('Media status could not be loaded.')).not.toBeInTheDocument(),
    )
  })

  it('opens the canonical editor for a row', async () => {
    const router = await renderAt('/settings/exercises')
    await user().click(
      await screen.findByRole('link', { name: 'Edit settings for Lat Pulldown' }),
    )

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/exercises/lat-pulldown'),
    )
  })
})

/* ------------------------------------------------------------------ */
/* The editor                                                          */
/* ------------------------------------------------------------------ */

describe('the media editor', () => {
  it('loads the no-media state honestly', async () => {
    await renderAt('/settings/exercises/lat-pulldown')

    expect(
      screen.getByRole('heading', { name: 'Lat Pulldown', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Used in Monday · Wednesday · Thursday')).toBeInTheDocument()

    await screen.findByText('No media set yet.')
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()
    // No fake URL is prefilled...
    expect(urlField()).toHaveValue('')
    // ...but a sensible description is.
    expect(altField()).toHaveValue('Lat Pulldown demonstration')
    expect(screen.queryByRole('button', { name: /Remove media/ })).not.toBeInTheDocument()
  })

  it('shows a loading state before claiming anything', async () => {
    const release = server.holdReads()
    await renderAt('/settings/exercises/lat-pulldown')

    expect(screen.getAllByText('Loading current media').length).toBeGreaterThan(0)
    expect(screen.queryByText('Media coming soon')).not.toBeInTheDocument()
    release()
    await screen.findByText('No media set yet.')
  })

  it('loads existing media into the form and the preview', async () => {
    server.rows.set(GIF.exerciseId, GIF)
    await renderAt('/settings/exercises/lat-pulldown')

    await screen.findByText('Media set for this exercise.')
    expect(urlField()).toHaveValue(GIF.url)
    expect(altField()).toHaveValue(GIF.alt)
    expect(screen.getByRole('radio', { name: 'GIF' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('img')).toHaveAttribute('src', GIF.url)
    expect(screen.getByRole('button', { name: /Replace media/ })).toBeInTheDocument()
  })

  it('lets the media type be switched to Image and back to GIF', async () => {
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('No media set yet.')
    const u = user()

    await u.click(screen.getByRole('radio', { name: 'Image' }))
    expect(screen.getByRole('radio', { name: 'Image' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'GIF' })).toHaveAttribute('aria-checked', 'false')

    await u.type(urlField(), NEW_URL)
    await u.click(saveButton())

    await screen.findByText('Saved')
    expect(server.rows.get('lat-pulldown')?.kind).toBe('image')

    await u.click(screen.getByRole('radio', { name: 'GIF' }))
    await u.click(screen.getByRole('button', { name: /Replace media/ }))
    await waitFor(() => expect(server.rows.get('lat-pulldown')?.kind).toBe('gif'))
  })

  it('previews a valid draft without writing anything', async () => {
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('No media set yet.')

    await user().type(urlField(), NEW_URL)

    expect(screen.getByRole('img')).toHaveAttribute('src', NEW_URL)
    // Nothing was persisted by typing.
    expect(server.rows.size).toBe(0)
    expect(server.calls.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('will not save an unsafe or malformed URL', async () => {
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('No media set yet.')
    const u = user()

    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'not a url', '/relative.gif']) {
      await u.clear(urlField())
      await u.type(urlField(), url)

      expect(saveButton()).toBeDisabled()
      expect(screen.getByText('Enter an absolute http:// or https:// address.')).toBeInTheDocument()
      // No unsafe URL ever reaches the preview either.
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    }
    expect(server.rows.size).toBe(0)
  })

  it('will not save blank alt text', async () => {
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('No media set yet.')
    const u = user()

    await u.type(urlField(), NEW_URL)
    await u.clear(altField())

    expect(saveButton()).toBeDisabled()
    expect(
      screen.getByText('Describe what the media shows — this cannot be blank.'),
    ).toBeInTheDocument()
  })

  it('reports saving and then saved, and persists the record', async () => {
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('No media set yet.')
    const u = user()

    await u.type(urlField(), NEW_URL)
    const release = server.hold()
    await u.click(saveButton())

    expect(await screen.findByText('Saving…')).toBeInTheDocument()
    release()

    await screen.findByText('Saved')
    expect(server.rows.get('lat-pulldown')).toMatchObject({
      kind: 'gif',
      url: NEW_URL,
      alt: 'Lat Pulldown demonstration',
    })
  })

  it('replaces an existing record instead of adding one', async () => {
    server.rows.set(GIF.exerciseId, GIF)
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('Media set for this exercise.')
    const u = user()

    await u.clear(urlField())
    await u.type(urlField(), NEW_URL)
    await u.click(screen.getByRole('button', { name: /Replace media/ }))

    await screen.findByText('Saved')
    expect(server.rows.size).toBe(1)
    expect(server.rows.get('lat-pulldown')?.url).toBe(NEW_URL)
  })

  it('ignores a second click while a save is in flight', async () => {
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('No media set yet.')
    const u = user()

    await u.type(urlField(), NEW_URL)
    const button = saveButton()
    const release = server.hold()
    await u.click(button)
    await u.click(button)
    await u.click(button)
    release()

    await screen.findByText('Saved')
    expect(server.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
  })

  it('stays recoverable after a save failure', async () => {
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('No media set yet.')
    const u = user()

    await u.type(urlField(), NEW_URL)
    server.failMutations(1)
    await u.click(saveButton())

    await screen.findByText('Could not save media. Nothing was changed.')
    expect(server.rows.size).toBe(0)
    // The draft survives, so the user can simply try again.
    expect(urlField()).toHaveValue(NEW_URL)

    await u.click(saveButton())
    await screen.findByText('Saved')
    expect(server.rows.get('lat-pulldown')?.url).toBe(NEW_URL)
  })

  it('reports removing and then removed, and falls back honestly', async () => {
    server.rows.set(GIF.exerciseId, GIF)
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('Media set for this exercise.')
    const u = user()

    const release = server.hold()
    await u.click(screen.getByRole('button', { name: /Remove media/ }))
    expect(await screen.findByText('Removing…')).toBeInTheDocument()
    release()

    await screen.findByText('Removed')
    // The record is gone — not replaced with a blank one.
    expect(server.rows.size).toBe(0)
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(urlField()).toHaveValue('')
    expect(screen.queryByRole('button', { name: /Remove media/ })).not.toBeInTheDocument()
  })

  it('keeps the record when a remove fails', async () => {
    server.rows.set(GIF.exerciseId, GIF)
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('Media set for this exercise.')

    server.failMutations(1)
    await user().click(screen.getByRole('button', { name: /Remove media/ }))

    await screen.findByText('Could not remove media. Nothing was changed.')
    expect(server.rows.size).toBe(1)
    expect(screen.getByRole('img')).toHaveAttribute('src', GIF.url)
  })

  it('surfaces a load failure with a retry', async () => {
    server.failReads(1)
    await renderAt('/settings/exercises/lat-pulldown')

    await screen.findByText('Current media could not be loaded.')
    // No broken-image glyph, and no false "coming soon".
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Media unavailable')).toBeInTheDocument()

    server.rows.set(GIF.exerciseId, GIF)
    await user().click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Media set for this exercise.')
  })

  it('reads and writes one canonical record for the exercise slug alone', async () => {
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('No media set yet.')

    await user().type(urlField(), NEW_URL)
    await user().click(saveButton())
    await screen.findByText('Saved')

    // Every request is keyed by the slug — no session ever appears in a URL.
    for (const call of server.calls) {
      expect(call.url).not.toMatch(/monday|wednesday|thursday/)
    }
    expect(server.calls.filter((c) => c.method === 'PUT')[0].url).toBe(
      '/api/exercise-media/lat-pulldown',
    )
  })

  it('handles an unknown exercise without crashing', async () => {
    await renderAt('/settings/exercises/not-an-exercise')
    expect(
      screen.getByRole('heading', { name: 'Exercise not found', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Media URL')).not.toBeInTheDocument()
  })

  it('labels every control accessibly', async () => {
    await renderAt('/settings/exercises/lat-pulldown')
    await screen.findByText('No media set yet.')

    expect(screen.getByRole('radiogroup', { name: 'Media type' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'GIF' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Image' })).toBeInTheDocument()
    expect(urlField()).toBeInTheDocument()
    expect(altField()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save media/ })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to Exercise Library' }),
    ).toHaveAttribute('href', '/settings/exercises')
  })
})
