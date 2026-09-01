import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_MEDIA_RATIO,
  ExerciseMedia,
} from '@/features/training/ExerciseMedia'
import type { ExerciseMediaSource } from '@/features/training/media'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'
import { createMediaServer, type MediaServer } from './exerciseMediaApiTestUtils'

/**
 * Round 19.1 — the exercise media FIT contract.
 *
 * THE REPORTED DEFECT. The frame was a fixed 16:9 box and the image was drawn
 * with `object-cover`, which crops. A SQUARE demonstration — the Incline DB
 * Press GIF — lost its top and bottom, so the bench and the lifter's arms were
 * cut out of the very thing the media exists to demonstrate.
 *
 * The rule is shared, not per page: `ExerciseMedia` is the only renderer of
 * exercise media in the app, so these assertions bind every consumer at once.
 * A page that "fixed" its own crop with local CSS while another kept cropping
 * is precisely what this file is meant to prevent.
 */

/** A square file — the shape that used to be cropped. */
const SQUARE: ExerciseMediaSource = {
  kind: 'gif',
  url: 'test://incline-db-press.gif',
  alt: 'Incline DB Press demonstration',
}

const WIDE: ExerciseMediaSource = {
  kind: 'image',
  url: 'test://wide.png',
  alt: 'Wide demonstration',
}

const TALL: ExerciseMediaSource = {
  kind: 'gif',
  url: 'test://tall.gif',
  alt: 'Tall demonstration',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function frameOf(container: HTMLElement) {
  return container.firstElementChild as HTMLElement
}

function ratioOf(el: HTMLElement) {
  return Number.parseFloat((el.style.aspectRatio || '0').trim())
}

/**
 * Load the image as a real file of the given intrinsic size.
 *
 * jsdom never decodes anything, so the natural dimensions are declared on the
 * element the component is actually holding, then the real `load` event is
 * fired. The component's own `adopt` logic runs — nothing is stubbed out.
 */
function loadAs(width: number, height: number) {
  const node = screen.getByRole('img') as HTMLImageElement
  Object.defineProperty(node, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(node, 'naturalHeight', { value: height, configurable: true })
  fireEvent.load(node)
  return node
}

/* ------------------------------------------------------------------ */
/* 1. Never crop, never stretch                                        */
/* ------------------------------------------------------------------ */

describe('1. the media is contained, never cropped', () => {
  it('draws with object-contain and never object-cover', () => {
    render(<ExerciseMedia media={SQUARE} />)
    const node = screen.getByRole('img')

    expect(node.className).toContain('object-contain')
    // The exact class that caused the reported defect.
    expect(node.className).not.toContain('object-cover')
  })

  it('reports its fit so a consumer cannot quietly opt out', () => {
    const { container } = render(<ExerciseMedia media={SQUARE} />)
    expect(
      container.querySelector('[data-media-fit]')?.getAttribute('data-media-fit'),
    ).toBe('contain')
  })

  it('keeps contain in every state, including before load and after failure', () => {
    const { container } = render(<ExerciseMedia media={SQUARE} />)
    expect(screen.getByRole('img').className).toContain('object-contain')

    fireEvent.error(screen.getByRole('img'))
    // The image is unmounted on failure, so the fallback is what remains.
    expect(container.querySelector('[data-media-state]')?.getAttribute('data-media-state')).toBe(
      'error',
    )
    expect(container.querySelector('img')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 2. The frame takes the media's own shape                            */
/* ------------------------------------------------------------------ */

describe('2. the frame adopts the intrinsic ratio', () => {
  it('gives a SQUARE demonstration a square frame', () => {
    // The regression case. Under the old contract this frame stayed 16:9 and
    // object-cover cut the top and bottom off the demonstration.
    const { container } = render(<ExerciseMedia media={SQUARE} />)
    expect(ratioOf(frameOf(container))).toBeCloseTo(DEFAULT_MEDIA_RATIO, 3)

    loadAs(600, 600)
    expect(ratioOf(frameOf(container))).toBeCloseTo(1, 3)
  })

  it('leaves a 16:9 demonstration at 16:9', () => {
    const { container } = render(<ExerciseMedia media={WIDE} />)
    loadAs(1920, 1080)
    expect(ratioOf(frameOf(container))).toBeCloseTo(16 / 9, 3)
  })

  it('gives a portrait demonstration a portrait frame', () => {
    const { container } = render(<ExerciseMedia media={TALL} />)
    loadAs(720, 1280)
    expect(ratioOf(frameOf(container))).toBeCloseTo(720 / 1280, 3)
  })

  it('never distorts: the frame ratio always equals the file ratio', () => {
    for (const [w, h] of [
      [600, 600],
      [1920, 1080],
      [720, 1280],
      [1000, 400],
    ]) {
      const { container } = render(<ExerciseMedia media={{ ...SQUARE, url: `test://${w}x${h}` }} />)
      loadAs(w, h)
      expect(ratioOf(frameOf(container)), `${w}x${h}`).toBeCloseTo(w / h, 3)
      cleanup()
    }
  })
})

/* ------------------------------------------------------------------ */
/* 3. Bounded, so "show all of it" is not "show an enormous one"       */
/* ------------------------------------------------------------------ */

describe('3. the frame stays bounded', () => {
  it('never exceeds the caller column and caps its height', () => {
    const { container } = render(<ExerciseMedia media={TALL} />)
    loadAs(720, 1280)
    const classes = frameOf(container).className

    // Width is the column's, so a wide file cannot overflow horizontally.
    expect(classes).toContain('w-full')
    // Height is capped for phones (svh) and for wide desktop columns (px).
    expect(classes).toMatch(/max-h-\[70svh\]/)
    expect(classes).toMatch(/sm:max-h-\[520px\]/)
    // And nothing forces a fixed height, which would squash the ratio.
    expect(classes.split(/\s+/).some((c) => /^h-/.test(c) && c !== 'h-full')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 4. A shape is never carried across sources or states                */
/* ------------------------------------------------------------------ */

describe('4. the adopted shape never leaks', () => {
  it('resets to the reservation when the source changes', () => {
    const { container, rerender } = render(<ExerciseMedia media={SQUARE} />)
    loadAs(600, 600)
    expect(ratioOf(frameOf(container))).toBeCloseTo(1, 3)

    // A different file must not inherit the previous file's shape.
    rerender(<ExerciseMedia media={WIDE} />)
    expect(ratioOf(frameOf(container))).toBeCloseTo(DEFAULT_MEDIA_RATIO, 3)

    loadAs(1920, 1080)
    expect(ratioOf(frameOf(container))).toBeCloseTo(16 / 9, 3)
  })

  it('falls back to the reservation when the load fails', () => {
    const { container } = render(<ExerciseMedia media={SQUARE} />)
    fireEvent.error(screen.getByRole('img'))
    expect(ratioOf(frameOf(container))).toBeCloseTo(DEFAULT_MEDIA_RATIO, 3)
  })

  it('ignores a load that reports no intrinsic size', () => {
    // A 0x0 decode must not produce a NaN or zero-height frame.
    const { container } = render(<ExerciseMedia media={SQUARE} />)
    loadAs(0, 0)
    expect(ratioOf(frameOf(container))).toBeCloseTo(DEFAULT_MEDIA_RATIO, 3)
  })
})

/* ------------------------------------------------------------------ */
/* 5. Preserved states                                                 */
/* ------------------------------------------------------------------ */

describe('5. the existing states still behave', () => {
  it.each([
    ['loading' as const, 'Loading current media'],
    ['error' as const, 'Media unavailable'],
  ])('keeps the %s state and its reservation', (resolution, label) => {
    const { container } = render(<ExerciseMedia media={null} resolution={resolution} />)
    expect(ratioOf(frameOf(container))).toBeCloseTo(DEFAULT_MEDIA_RATIO, 3)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('keeps the no-media fallback', () => {
    const { container } = render(<ExerciseMedia media={null} />)
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()
    expect(ratioOf(frameOf(container))).toBeCloseTo(DEFAULT_MEDIA_RATIO, 3)
  })
})

/* ------------------------------------------------------------------ */
/* 6. Every real consumer, not just the component in isolation         */
/* ------------------------------------------------------------------ */

describe('6. every consumer gets the shared contract', () => {
  let server: MediaServer

  function mount(path: string) {
    server = createMediaServer()
    server.rows.set('incline-db-press', {
      exerciseId: 'incline-db-press',
      kind: 'gif',
      url: SQUARE.url,
      alt: SQUARE.alt,
      updatedAt: 1,
    })
    mockAuthFetch({ session: authenticatedSession, media: server })
    renderApp(path)
  }

  it.each([
    ['Exercise Detail', '/exercises/incline-db-press'],
    ['the canonical media editor', '/settings/exercises/incline-db-press'],
  ])('%s renders contained, square-fitting media', async (_name, path) => {
    mount(path)

    const node = (await screen.findByRole('img', {
      name: /Incline DB Press demonstration/i,
    })) as HTMLImageElement
    expect(node.className).toContain('object-contain')
    expect(node.className).not.toContain('object-cover')

    Object.defineProperty(node, 'naturalWidth', { value: 600, configurable: true })
    Object.defineProperty(node, 'naturalHeight', { value: 600, configurable: true })
    fireEvent.load(node)

    const frame = document.querySelector('[data-media-state]')?.parentElement as HTMLElement
    await waitFor(() => expect(ratioOf(frame)).toBeCloseTo(1, 3))
  })
})
