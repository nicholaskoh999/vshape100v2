import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  exercisePath,
  ORIGIN_PARAM,
  resolveExerciseReturn,
} from '@/features/training/navigation'
import { authenticatedSession, mockAuthFetch, renderApp } from './authTestUtils'

/**
 * Round 03.1 — the exercise detail returns to the session it was opened from.
 *
 * The same exercise belongs to several training days, so these tests always
 * assert the return target against the *origin*, never against the exercise.
 */

beforeEach(() => {
  mockAuthFetch({ session: authenticatedSession })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The contextual return control on the exercise detail page. */
function backLink() {
  return screen.getByRole('link', { name: /^Back to / })
}

/** The compact row trigger for an exercise (name + prescription summary). */
function exerciseTrigger(name: string) {
  return screen.getByRole('button', { name: new RegExp(name) })
}

/**
 * The one open panel's detail link.
 *
 * A closing panel stays mounted for its collapse animation, so this waits for
 * the list to settle — which also asserts that only one row is ever open.
 */
async function openDetailsLink() {
  return waitFor(() => {
    const links = screen.getAllByRole('link', { name: 'Open exercise details' })
    expect(links).toHaveLength(1)
    return links[0]
  })
}

/**
 * Walk the Round 05 flow: expand the exercise in place, then follow its
 * "Open exercise details" link.
 */
async function openExerciseFrom(sessionId: string, exerciseName: string) {
  const user = userEvent.setup()
  const router = renderApp(`/training/${sessionId}`)
  await screen.findByRole('heading', { level: 1 })
  await user.click(exerciseTrigger(exerciseName))
  await user.click(await openDetailsLink())
  return { router, user }
}

describe('origin resolution (pure)', () => {
  it('resolves every accepted weekday session', () => {
    for (const [id, day] of [
      ['monday', 'Monday'],
      ['tuesday', 'Tuesday'],
      ['wednesday', 'Wednesday'],
      ['thursday', 'Thursday'],
      ['friday', 'Friday'],
    ]) {
      expect(resolveExerciseReturn(id)).toEqual({
        to: `/training/${id}`,
        label: day,
        contextual: true,
      })
    }
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['unknown day', 'someday'],
    ['a training path', '/training/monday'],
    ['a relative escape', '../../training/monday'],
    ['an absolute URL', 'https://evil.example.com'],
    ['a protocol-relative host', '//evil.example.com'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a backslash trick', '\\\\evil.example.com'],
    ['an encoded path', '%2Ftraining%2Fmonday'],
    ['a non-training route', 'settings'],
    ['case-mismatched', 'Monday'],
    ['whitespace-padded', ' monday '],
  ])('falls back to Training for %s', (_name, value) => {
    expect(resolveExerciseReturn(value)).toEqual({
      to: '/training',
      label: 'Training',
      contextual: false,
    })
  })

  it('only ever returns an in-app training path', () => {
    const probes = ['monday', 'https://evil.example.com', '//evil.example.com', 'x']
    for (const probe of probes) {
      const { to } = resolveExerciseReturn(probe)
      expect(to.startsWith('/training')).toBe(true)
      expect(to).not.toContain('evil')
      expect(to).not.toContain('//')
    }
  })

  it('builds exercise links with and without an origin', () => {
    expect(exercisePath('lat-pulldown', 'monday')).toBe(
      `/exercises/lat-pulldown?${ORIGIN_PARAM}=monday`,
    )
    expect(exercisePath('lat-pulldown')).toBe('/exercises/lat-pulldown')
  })
})

describe('session → exercise → back to that session', () => {
  it('returns to Monday from a Monday exercise', async () => {
    const { router, user } = await openExerciseFrom('monday', 'Lat Pulldown')
    expect(router.state.location.pathname).toBe('/exercises/lat-pulldown')
    expect(router.state.location.search).toBe('?from=monday')

    const back = backLink()
    expect(back).toHaveTextContent('Monday')
    expect(back).toHaveAttribute('href', '/training/monday')

    await user.click(back)
    expect(router.state.location.pathname).toBe('/training/monday')
    expect(
      await screen.findByRole('heading', { name: 'Back Width + Biceps' }),
    ).toBeInTheDocument()
  })

  it('returns to Tuesday from a Tuesday exercise', async () => {
    const { router, user } = await openExerciseFrom('tuesday', 'Lateral Raise')
    const back = backLink()
    expect(back).toHaveTextContent('Tuesday')
    expect(back).toHaveAttribute('href', '/training/tuesday')

    await user.click(back)
    expect(router.state.location.pathname).toBe('/training/tuesday')
  })

  it.each([
    ['wednesday', 'Rear Delt Fly', 'Wednesday'],
    ['thursday', 'Seated Band Row', 'Thursday'],
    ['friday', 'Hammer Curl', 'Friday'],
  ])('returns to %s', async (sessionId, exerciseName, label) => {
    const { router, user } = await openExerciseFrom(sessionId, exerciseName)
    expect(backLink()).toHaveTextContent(label)
    await user.click(backLink())
    expect(router.state.location.pathname).toBe(`/training/${sessionId}`)
  })
})

describe('the same exercise reached from different sessions', () => {
  it('returns to Monday when Lat Pulldown was opened from Monday', async () => {
    const { router, user } = await openExerciseFrom('monday', 'Lat Pulldown')
    expect(backLink()).toHaveAttribute('href', '/training/monday')
    await user.click(backLink())
    expect(router.state.location.pathname).toBe('/training/monday')
  })

  it('returns to Thursday when the same Lat Pulldown was opened from Thursday', async () => {
    const { router, user } = await openExerciseFrom('thursday', 'Lat Pulldown')
    expect(router.state.location.pathname).toBe('/exercises/lat-pulldown')
    expect(backLink()).toHaveAttribute('href', '/training/thursday')
    await user.click(backLink())
    expect(router.state.location.pathname).toBe('/training/thursday')
  })

  it('returns to Wednesday for the third session carrying it', async () => {
    const { user } = await openExerciseFrom('wednesday', 'Lat Pulldown')
    expect(backLink()).toHaveAttribute('href', '/training/wednesday')
    await user.click(backLink())
    expect(
      await screen.findByRole('heading', { name: 'Light Back + Rear Delts + Core' }),
    ).toBeInTheDocument()
  })

  it('does not infer the day from the exercise itself', async () => {
    // Lat Pulldown lists Monday, Wednesday and Thursday on the page; the back
    // control must follow the origin, not the first appearance.
    renderApp('/exercises/lat-pulldown?from=thursday')
    await screen.findByRole('heading', { name: 'Lat Pulldown' })
    expect(backLink()).toHaveTextContent('Thursday')
    // The appearances list still shows every day it belongs to.
    expect(screen.getByText('Monday')).toBeInTheDocument()
    expect(screen.getByText('Wednesday')).toBeInTheDocument()
  })
})

describe('direct open, refresh and invalid origins', () => {
  it('falls back to Training on a direct open with no origin', async () => {
    renderApp('/exercises/lat-pulldown')
    await screen.findByRole('heading', { name: 'Lat Pulldown' })
    const back = backLink()
    expect(back).toHaveTextContent('Training')
    expect(back).toHaveAttribute('href', '/training')
  })

  it('keeps the contextual return on a fresh render of the URL (refresh)', async () => {
    // Rendering the route directly is exactly what a refresh does: the origin
    // lives in the URL, so nothing is lost.
    renderApp('/exercises/lat-pulldown?from=monday')
    await screen.findByRole('heading', { name: 'Lat Pulldown' })
    expect(backLink()).toHaveTextContent('Monday')
    expect(backLink()).toHaveAttribute('href', '/training/monday')
  })

  it.each([
    ['garbage', '?from=garbage'],
    ['empty value', '?from='],
    ['a path', '?from=%2Ftraining%2Fmonday'],
    ['an absolute URL', '?from=https%3A%2F%2Fevil.example.com'],
    ['a protocol-relative host', '?from=%2F%2Fevil.example.com'],
    ['a javascript URL', '?from=javascript%3Aalert(1)'],
    ['an unrelated route', '?from=settings'],
    ['an unrelated param', '?next=%2Fsettings'],
  ])('falls back to Training for %s', async (_name, search) => {
    renderApp(`/exercises/lat-pulldown${search}`)
    await screen.findByRole('heading', { name: 'Lat Pulldown' })
    const back = backLink()
    expect(back).toHaveTextContent('Training')
    expect(back).toHaveAttribute('href', '/training')
  })

  it('never navigates off-app for a hostile origin', async () => {
    const user = userEvent.setup()
    const router = renderApp('/exercises/lat-pulldown?from=%2F%2Fevil.example.com')
    await screen.findByRole('heading', { name: 'Lat Pulldown' })
    await user.click(backLink())
    expect(router.state.location.pathname).toBe('/training')
    expect(
      await screen.findByRole('heading', { name: 'Training' }),
    ).toBeInTheDocument()
  })

  it('still shows the contextual return for an unknown exercise', async () => {
    renderApp('/exercises/not-an-exercise?from=monday')
    await screen.findByRole('heading', { name: 'Exercise not found' })
    expect(backLink()).toHaveTextContent('Monday')
  })
})

describe('browser history is left alone', () => {
  it('pushes rather than replaces on the way in and on the way back', async () => {
    const { router, user } = await openExerciseFrom('monday', 'Lat Pulldown')
    expect(router.state.historyAction).toBe('PUSH')

    await user.click(backLink())
    expect(router.state.location.pathname).toBe('/training/monday')
    expect(router.state.historyAction).toBe('PUSH')
  })

  it('leaves normal Back working through the whole trail', async () => {
    // Walk the real trail: Training → Monday → Lat Pulldown.
    const user = userEvent.setup()
    const router = renderApp('/training')
    await screen.findByRole('heading', { name: 'Training' })
    await user.click(screen.getByText('Back Width + Biceps'))
    expect(router.state.location.pathname).toBe('/training/monday')
    await user.click(exerciseTrigger('Lat Pulldown'))
    await user.click(await openDetailsLink())
    expect(router.state.location.pathname).toBe('/exercises/lat-pulldown')

    // Browser Back — untouched by the contextual return control.
    await router.navigate(-1)
    expect(router.state.location.pathname).toBe('/training/monday')

    await router.navigate(-1)
    expect(router.state.location.pathname).toBe('/training')

    // And Forward still works, because nothing was replaced.
    await router.navigate(1)
    expect(router.state.location.pathname).toBe('/training/monday')
  })

  it('keeps the session page reachable by Back after using the contextual return', async () => {
    const { router, user } = await openExerciseFrom('thursday', 'Lat Pulldown')
    await user.click(backLink())
    expect(router.state.location.pathname).toBe('/training/thursday')

    // The exercise is still in history behind us.
    await router.navigate(-1)
    expect(router.state.location.pathname).toBe('/exercises/lat-pulldown')
  })
})

describe('session page links carry the origin', () => {
  it('stamps every exercise link with its own session', async () => {
    const user = userEvent.setup()
    renderApp('/training/monday')
    await screen.findByRole('heading', { name: 'Back Width + Biceps' })

    // Only the open row carries a link now, so check each in turn.
    const expected = [
      ['Lat Pulldown', 'lat-pulldown'],
      ['One-Arm DB Row', 'one-arm-db-row'],
      ['Face Pull', 'face-pull'],
      ['Preacher Curl', 'preacher-curl'],
      ['Hammer Curl', 'hammer-curl'],
    ]
    for (const [name, slug] of expected) {
      await user.click(exerciseTrigger(name))
      expect(await openDetailsLink()).toHaveAttribute(
        'href',
        `/exercises/${slug}?${ORIGIN_PARAM}=monday`,
      )
    }
  })
})
