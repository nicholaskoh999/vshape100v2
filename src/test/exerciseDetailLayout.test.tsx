import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createMediaServer, type MediaServer } from './exerciseMediaApiTestUtils'

/**
 * Round 09 — Exercise Detail media layout.
 *
 * The media and the prescriptions share ONE measured column: fluid up to a
 * comfortable desktop cap, then held there. jsdom applies no stylesheet, so
 * these assert the layout *contract* the classes express — parsed as numbers
 * rather than matched as strings, so the intent survives a change of value.
 *
 * Real rendered widths were measured separately against the running app.
 */

const GIF = {
  exerciseId: 'lat-pulldown',
  kind: 'gif' as const,
  url: 'https://media.test.invalid/lat-pulldown.gif',
  alt: 'Lat Pulldown demonstration',
  updatedAt: 1,
}

/** The accepted desktop range for the column, in px. */
const MIN_DESKTOP_WIDTH = 680
const MAX_DESKTOP_WIDTH = 720
/** The accepted vertical gap between the media and the prescriptions, in px. */
const MIN_GAP = 16
const MAX_GAP = 20

const ROOT_FONT_SIZE = 16
/** Tailwind's spacing unit: 1 = 0.25rem. */
const SPACING_UNIT = 4

let server: MediaServer

beforeEach(() => {
  server = createMediaServer()
  mockAuthFetch({ session: authenticatedSession, media: server })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function renderDetail(path = '/exercises/lat-pulldown') {
  renderApp(path)
  await screen.findByRole('heading', { level: 1 })
}

/** The single measured column holding the media and the prescriptions. */
function column(): HTMLElement | null {
  return document.querySelector('[data-exercise-detail-column]')
}

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean)
}

/** The media's 16:9 frame — the element carrying the state marker. */
function mediaFrame(): HTMLElement | null {
  const marker = document.querySelector('[data-media-state]')
  return marker?.parentElement ?? null
}

/** Read a length utility like `max-w-[44rem]` / `max-w-[704px]` as px. */
function arbitraryLengthPx(classes: string[], prefix: string): number | null {
  const match = classes.find((c) => c.startsWith(`${prefix}-[`) && c.endsWith(']'))
  if (!match) return null
  const raw = match.slice(prefix.length + 2, -1)
  if (raw.endsWith('rem')) return Number.parseFloat(raw) * ROOT_FONT_SIZE
  if (raw.endsWith('px')) return Number.parseFloat(raw)
  return null
}

/** Read `gap-4` / `md:gap-5` as px. */
function gapPx(cls: string): number | null {
  const match = /^(?:[a-z]+:)?gap-(\d+(?:\.\d+)?)$/.exec(cls)
  return match ? Number.parseFloat(match[1]) * SPACING_UNIT : null
}

/* ------------------------------------------------------------------ */
/* The measured column                                                 */
/* ------------------------------------------------------------------ */

describe('the exercise detail column', () => {
  it('wraps the media and the prescriptions in exactly one column', async () => {
    await renderDetail()
    expect(document.querySelectorAll('[data-exercise-detail-column]')).toHaveLength(1)
  })

  it('caps the column inside the accepted desktop width', async () => {
    await renderDetail()
    const width = arbitraryLengthPx(classesOf(column()!), 'max-w')

    expect(width).not.toBeNull()
    expect(width!).toBeGreaterThanOrEqual(MIN_DESKTOP_WIDTH)
    expect(width!).toBeLessThanOrEqual(MAX_DESKTOP_WIDTH)
  })

  it('stays fluid below the cap rather than fixing a width', async () => {
    const classes = classesOf((await renderDetail(), column()!))

    expect(classes).toContain('w-full')
    // A fixed width would stop the column shrinking on a narrow screen, which
    // is what produces horizontal overflow.
    expect(classes.some((c) => /^w-\[/.test(c))).toBe(false)
    expect(classes.some((c) => /^min-w-\[/.test(c))).toBe(false)
  })

  it('gives the media and the prescriptions the same width and left edge', async () => {
    await renderDetail()
    const kids = [...column()!.children]

    // Both are laid out by the same element, so neither can drift wider than
    // the other or sit at a different left edge.
    expect(kids).toHaveLength(2)
    expect(kids[0].contains(document.querySelector('[data-media-state]'))).toBe(true)
    expect(kids[1].textContent).toContain('Monday')
    // Nothing re-centres or re-sizes a child out of the shared column.
    for (const kid of kids) {
      expect(classesOf(kid).some((c) => /^(mx-auto|w-\[|max-w-)/.test(c))).toBe(false)
    }
  })

  it('separates them by the accepted vertical gap at every breakpoint', async () => {
    await renderDetail()
    const gaps = classesOf(column()!)
      .map(gapPx)
      .filter((g): g is number => g !== null)

    expect(gaps.length).toBeGreaterThan(0)
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(MIN_GAP)
      expect(gap).toBeLessThanOrEqual(MAX_GAP)
    }
  })

  it('lays the column out vertically', async () => {
    await renderDetail()
    const classes = classesOf(column()!)
    expect(classes).toContain('flex')
    expect(classes).toContain('flex-col')
  })
})

/* ------------------------------------------------------------------ */
/* The media box itself                                                */
/* ------------------------------------------------------------------ */

describe('the media box', () => {
  it('preserves 16:9', async () => {
    await renderDetail()
    expect(classesOf(mediaFrame()!)).toContain('aspect-video')
  })

  it('fills the column width', async () => {
    await renderDetail()
    expect(classesOf(mediaFrame()!)).toContain('w-full')
  })

  it('sets no fixed height, so height still follows width', async () => {
    await renderDetail()
    const classes = classesOf(mediaFrame()!)

    // A height utility here would break the ratio the aspect box maintains.
    expect(classes.some((c) => /^h-/.test(c) && c !== 'h-full')).toBe(false)
    expect(classes.some((c) => /^(min-h-|max-h-)/.test(c))).toBe(false)
  })

  it('keeps the ratio in every media state', async () => {
    // No media set.
    await renderDetail()
    await waitFor(() => expect(document.querySelector('[data-media-state]')).not.toBeNull())
    expect(classesOf(mediaFrame()!)).toContain('aspect-video')
    expect(column()).not.toBeNull()
    cleanup()

    // Saved media.
    server.rows.set(GIF.exerciseId, GIF)
    await renderDetail()
    await waitFor(() => expect(document.querySelector('[data-media-state]')).not.toBeNull())
    expect(classesOf(mediaFrame()!)).toContain('aspect-video')
    expect(classesOf(column()!)).toContain('w-full')
    cleanup()

    // Failed read — the column must not collapse or duplicate.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    server.failReads(10)
    await renderDetail()
    await waitFor(() => expect(mediaState()).toBe('error'))
    expect(classesOf(mediaFrame()!)).toContain('aspect-video')
    expect(document.querySelectorAll('[data-exercise-detail-column]')).toHaveLength(1)
    errors.mockRestore()
  })
})

function mediaState() {
  return document.querySelector('[data-media-state]')?.getAttribute('data-media-state')
}

/* ------------------------------------------------------------------ */
/* Regressions                                                         */
/* ------------------------------------------------------------------ */

describe('layout regressions', () => {
  it('holds whether the exercise is trained on one day or three', async () => {
    // Three appearances.
    await renderDetail('/exercises/lat-pulldown')
    const many = [...column()!.children][1]
    expect(many.textContent).toContain('Monday')
    expect(many.textContent).toContain('Wednesday')
    expect(many.textContent).toContain('Thursday')
    const manyClasses = classesOf(column()!)
    cleanup()

    // One appearance — same column contract, no special-casing.
    await renderDetail('/exercises/one-arm-db-row')
    expect([...column()!.children]).toHaveLength(2)
    expect(classesOf(column()!)).toEqual(manyClasses)
  })

  it('renders no column for an unknown exercise', async () => {
    renderApp('/exercises/not-an-exercise')
    expect(
      await screen.findByRole('heading', { name: 'Exercise not found' }),
    ).toBeInTheDocument()
    expect(column()).toBeNull()
  })

  it('keeps the contextual return and the Edit media shortcut', async () => {
    await renderDetail('/exercises/lat-pulldown?from=monday')

    expect(screen.getByRole('link', { name: 'Back to Monday' })).toHaveAttribute(
      'href',
      '/training/monday',
    )
    expect(
      screen.getByRole('link', { name: 'Edit media for Lat Pulldown' }),
    ).toHaveAttribute('href', '/settings/exercises/lat-pulldown')
    // The actions live in the header, not inside the measured column.
    expect(column()!.textContent).not.toContain('Edit media')
  })
})
