import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExerciseMedia } from '@/features/training/ExerciseMedia'
import { isImageKind, type ExerciseMediaSource } from '@/features/training/media'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'

/**
 * Round 06 — the exercise media renderer.
 *
 * Nothing here touches the network: jsdom never loads an image, so the tests
 * drive the real DOM `load` / `error` events themselves. No test asset is a
 * real file and no production data supplies a media URL.
 */

const GIF: ExerciseMediaSource = {
  kind: 'gif',
  url: 'test://lat-pulldown.gif',
  alt: 'Lat Pulldown demonstration',
}

const IMAGE: ExerciseMediaSource = {
  kind: 'image',
  url: 'test://face-pull.png',
  alt: 'Face Pull demonstration',
}

/** The frame's current state, as the component reports it. */
function mediaState(container: HTMLElement) {
  return container
    .querySelector('[data-media-state]')
    ?.getAttribute('data-media-state')
}

function img() {
  return screen.queryByRole('img')
}

describe('no media', () => {
  it('shows a clean fallback and renders no image at all', () => {
    const { container } = render(<ExerciseMedia media={null} />)

    expect(mediaState(container)).toBe('empty')
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()
    expect(img()).not.toBeInTheDocument()
    // No broken-image element is left behind for the browser to render.
    expect(container.querySelector('img')).toBeNull()
  })

  it('treats undefined the same as null', () => {
    const { container } = render(<ExerciseMedia media={undefined} />)
    expect(mediaState(container)).toBe('empty')
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()
  })

  it('still holds the aspect-ratio box so the page does not reflow', () => {
    const { container } = render(<ExerciseMedia media={null} />)
    const frame = container.firstElementChild as HTMLElement
    expect(frame.className).toContain('aspect-video')
    expect(frame.className).toContain('w-full')
  })
})

describe('the media contract', () => {
  it('serves an image source through the image pipeline', () => {
    render(<ExerciseMedia media={IMAGE} />)
    const node = img() as HTMLImageElement

    expect(node).toHaveAttribute('src', IMAGE.url)
    expect(node).toHaveAttribute('alt', IMAGE.alt)
  })

  it('serves a gif source through the same pipeline', () => {
    render(<ExerciseMedia media={GIF} />)
    const node = img() as HTMLImageElement

    expect(node.tagName).toBe('IMG')
    expect(node).toHaveAttribute('src', GIF.url)
    expect(node).toHaveAttribute('alt', GIF.alt)
  })

  it('keeps the kind distinction available for future formats', () => {
    // Both go through <img> today; the type still separates them so a video
    // kind can branch later without reshaping call sites.
    expect(isImageKind('gif')).toBe(true)
    expect(isImageKind('image')).toBe(true)
  })

  it('requests lazy loading and async decoding', () => {
    render(<ExerciseMedia media={GIF} />)
    expect(img()).toHaveAttribute('loading', 'lazy')
    expect(img()).toHaveAttribute('decoding', 'async')
  })
})

describe('load lifecycle', () => {
  it('shows the skeleton until the media has loaded', () => {
    const { container } = render(<ExerciseMedia media={GIF} />)

    expect(mediaState(container)).toBe('loading')
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    // The image is mounted (so it can start loading) but not yet revealed.
    expect(img()).toBeInTheDocument()
  })

  it('reveals the media once it loads and drops the skeleton', () => {
    const { container } = render(<ExerciseMedia media={GIF} />)
    fireEvent.load(img() as HTMLImageElement)

    expect(mediaState(container)).toBe('ready')
    expect(container.querySelector('.animate-pulse')).toBeNull()
    expect(img()).toHaveAttribute('src', GIF.url)
  })

  it('falls back on a load error and removes the broken image', () => {
    const { container } = render(<ExerciseMedia media={GIF} />)
    fireEvent.error(img() as HTMLImageElement)

    expect(mediaState(container)).toBe('error')
    expect(screen.getByText('Media unavailable')).toBeInTheDocument()
    // Nothing broken is left on screen.
    expect(img()).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('distinguishes an error from having no media at all', () => {
    const { container } = render(<ExerciseMedia media={GIF} />)
    fireEvent.error(img() as HTMLImageElement)

    expect(screen.getByText('Media unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Media coming soon')).not.toBeInTheDocument()
    expect(mediaState(container)).toBe('error')
  })
})

describe('state never carries across a source change', () => {
  it('does not keep a stale "ready" when the url changes', () => {
    const { container, rerender } = render(<ExerciseMedia media={GIF} />)
    fireEvent.load(img() as HTMLImageElement)
    expect(mediaState(container)).toBe('ready')

    rerender(<ExerciseMedia media={IMAGE} />)

    // The new source starts from scratch: skeleton up, nothing claimed loaded.
    expect(mediaState(container)).toBe('loading')
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(img()).toHaveAttribute('src', IMAGE.url)
  })

  it('does not keep a stale "error" when the url changes', () => {
    const { container, rerender } = render(<ExerciseMedia media={GIF} />)
    fireEvent.error(img() as HTMLImageElement)
    expect(mediaState(container)).toBe('error')

    rerender(<ExerciseMedia media={IMAGE} />)

    expect(mediaState(container)).toBe('loading')
    expect(screen.queryByText('Media unavailable')).not.toBeInTheDocument()
    expect(img()).toHaveAttribute('src', IMAGE.url)
  })

  it('recovers from media → none → media', () => {
    const { container, rerender } = render(<ExerciseMedia media={GIF} />)
    fireEvent.error(img() as HTMLImageElement)

    rerender(<ExerciseMedia media={null} />)
    expect(mediaState(container)).toBe('empty')
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()

    rerender(<ExerciseMedia media={GIF} />)
    expect(mediaState(container)).toBe('loading')
    expect(img()).toBeInTheDocument()
  })

  it('keeps state when the same source re-renders', () => {
    const { container, rerender } = render(<ExerciseMedia media={GIF} />)
    fireEvent.load(img() as HTMLImageElement)

    rerender(<ExerciseMedia media={{ ...GIF }} />)
    expect(mediaState(container)).toBe('ready')
  })
})

describe('accessibility', () => {
  it('gives the media its alt text', () => {
    render(<ExerciseMedia media={GIF} />)
    expect(screen.getByRole('img', { name: GIF.alt })).toBeInTheDocument()
  })

  it('hides decorative icons from assistive technology', () => {
    const { container } = render(<ExerciseMedia media={null} />)
    const icons = container.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('hides the skeleton from assistive technology', () => {
    const { container } = render(<ExerciseMedia media={GIF} />)
    expect(container.querySelector('.animate-pulse')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('exposes no image role in either fallback', () => {
    const { container, rerender } = render(<ExerciseMedia media={null} />)
    expect(img()).not.toBeInTheDocument()

    rerender(<ExerciseMedia media={GIF} />)
    fireEvent.error(img() as HTMLImageElement)
    expect(img()).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('motion and reduced motion', () => {
  const realMatchMedia = window.matchMedia

  function prefersReducedMotion(reduce: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: reduce && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: realMatchMedia,
    })
  })

  it('fades the media in once it has loaded', async () => {
    prefersReducedMotion(false)
    render(<ExerciseMedia media={GIF} />)
    const node = img() as HTMLImageElement

    // Hidden until the bytes are actually there, so no flash of a blank frame.
    expect(node.style.opacity).toBe('0')

    fireEvent.load(node)
    await waitFor(() => expect(node.style.opacity).toBe('1'))
  })

  it('reveals without an animation when reduced motion is requested', async () => {
    prefersReducedMotion(true)
    const { container } = render(<ExerciseMedia media={GIF} />)
    const node = img() as HTMLImageElement

    fireEvent.load(node)

    await waitFor(() => expect(node.style.opacity).toBe('1'))
    expect(mediaState(container)).toBe('ready')
  })
})

describe('exercise detail integration', () => {
  beforeEach(() => {
    mockAuthFetch({ session: authenticatedSession })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the shared component in its no-media state', async () => {
    renderApp('/exercises/lat-pulldown?from=monday')
    await screen.findByRole('heading', { name: 'Lat Pulldown' })

    expect(
      document.querySelector('[data-media-state]')?.getAttribute('data-media-state'),
    ).toBe('empty')
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()
    // No media URL exists in V2 yet, so nothing is fetched or rendered.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps the contextual return alongside the media slot', async () => {
    renderApp('/exercises/lat-pulldown?from=monday')
    await screen.findByRole('heading', { name: 'Lat Pulldown' })

    const back = screen.getByRole('link', { name: 'Back to Monday' })
    expect(back).toHaveAttribute('href', '/training/monday')
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()
  })

  it('keeps the direct-open fallback alongside the media slot', async () => {
    renderApp('/exercises/lat-pulldown')
    await screen.findByRole('heading', { name: 'Lat Pulldown' })

    expect(screen.getByRole('link', { name: 'Back to Training' })).toHaveAttribute(
      'href',
      '/training',
    )
    expect(screen.getByText('Media coming soon')).toBeInTheDocument()
  })

  it('keeps the hostile-origin fallback safe', async () => {
    renderApp('/exercises/lat-pulldown?from=%2F%2Fevil.example.com')
    await screen.findByRole('heading', { name: 'Lat Pulldown' })

    expect(screen.getByRole('link', { name: 'Back to Training' })).toHaveAttribute(
      'href',
      '/training',
    )
  })

  it('shows no media frame for an unknown exercise', async () => {
    renderApp('/exercises/not-an-exercise?from=monday')
    await screen.findByRole('heading', { name: 'Exercise not found' })

    expect(document.querySelector('[data-media-state]')).toBeNull()
  })
})
