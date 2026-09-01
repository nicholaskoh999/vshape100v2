import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'

/**
 * Round 18.4 — one control, one tab stop.
 *
 * `motion` makes any element carrying a press gesture focusable so that a
 * keyboard user can trigger the same animation a pointer user gets. That is the
 * right default for a bare `motion.span`, and the wrong one when the span is
 * already wrapped in a real <a> or <button>: the wrapper is the control, and the
 * inner element becomes a second tab stop that looks focusable and does nothing
 * when activated. With six navigation items rendered in two variants, that is
 * the difference between tabbing through the app and tabbing through it twice.
 *
 * This asserts the invariant rather than a list of components, so a future
 * `motion.div` added inside a link fails here instead of in someone's hands.
 */

const NATIVELY_FOCUSABLE = 'a[href], button, input, select, textarea'
const FOCUSABLE = `${NATIVELY_FOCUSABLE}, [tabindex]:not([tabindex="-1"])`

beforeEach(() => {
  mockAuthFetch({ session: authenticatedSession })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Every focusable element that sits inside another focusable element. */
function nestedTabStops(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => el.getAttribute('tabindex') !== '-1')
    .filter((el) => {
      const ancestor = el.parentElement?.closest<HTMLElement>(FOCUSABLE)
      return Boolean(ancestor) && ancestor?.getAttribute('tabindex') !== '-1'
    })
    .map((el) => {
      const outer = el.parentElement?.closest<HTMLElement>(FOCUSABLE)
      return `${el.tagName.toLowerCase()}["${(el.textContent ?? '').trim().slice(0, 24)}"] inside ${outer?.tagName.toLowerCase()}`
    })
}

describe('18.4 — no control offers two tab stops', () => {
  it.each([
    ['/today', 'Today'],
    ['/training', 'Training'],
    ['/progress', 'Progress'],
    ['/calendar', 'Calendar'],
    ['/achievements', 'Achievements'],
    ['/settings', 'Settings'],
  ])('%s exposes each control exactly once', async (path, heading) => {
    renderApp(path)
    await screen.findByRole('heading', { name: heading }, { timeout: 5000 })

    expect(nestedTabStops(document.body)).toEqual([])
  })

  it('still gives the navigation itself a real, reachable tab stop', async () => {
    // The guard above is only meaningful if the OUTER control stayed focusable:
    // silencing it by making everything unfocusable would be worse than the bug.
    renderApp('/today')
    await screen.findByRole('heading', { name: 'Today' }, { timeout: 5000 })

    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0]
    const links = [...nav.querySelectorAll<HTMLElement>('a[href]')]
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.getAttribute('tabindex')).not.toBe('-1')
    }
  })
})
