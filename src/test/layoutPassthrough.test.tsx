/*
 * ROUND 27 (VT-04) — Card and HeroCard pass semantic props through.
 *
 * The point of these is not that a spread works; it is that adding one did not
 * quietly cost the components anything. So each block asserts BOTH halves: the
 * prop arrives on the right element, AND the styling, the class merging and the
 * component's own vocabulary behave exactly as they did before.
 *
 * The scope is deliberately Card and HeroCard. Neither forwards a ref today and
 * neither is given one here — asserting a contract the components do not have
 * would be inventing one.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Card, HeroCard } from '@/components/ui/Layout'

/* ================================================================== */
/* 1. Card                                                             */
/* ================================================================== */

describe('1. Card passes semantic props to its root', () => {
  it('A. carries id, role, aria-* and data-* onto the same element', () => {
    const { container } = render(
      <Card
        id="card-1"
        role="group"
        aria-label="Account facts"
        aria-describedby="note-1"
        data-testid="card-root"
        data-section="account"
      >
        body
      </Card>,
    )

    const root = screen.getByTestId('card-root')
    // The one element assertion that matters: it is the styled root itself,
    // not a wrapper the component added around it.
    expect(root).toBe(container.firstElementChild)
    expect(root).toHaveAttribute('id', 'card-1')
    expect(root).toHaveAttribute('role', 'group')
    expect(root).toHaveAttribute('aria-label', 'Account facts')
    expect(root).toHaveAttribute('aria-describedby', 'note-1')
    expect(root).toHaveAttribute('data-section', 'account')
    expect(root.tagName).toBe('DIV')
    expect(screen.getByRole('group', { name: 'Account facts' })).toBe(root)
  })

  it('B. still merges className, and the caller cannot lose the base classes', () => {
    const { container } = render(<Card className="mb-5 custom-thing">body</Card>)
    const root = container.firstElementChild as HTMLElement

    expect(root).toHaveClass('mb-5', 'custom-thing')
    // Unchanged base styling — the Round 24 card surface.
    expect(root).toHaveClass('rounded-card', 'border', 'bg-surface', 'shadow-card', 'p-5')
  })

  it('C. flush and quiet still change the surface, and never reach the DOM', () => {
    const { container: flush } = render(<Card flush>rows</Card>)
    const flushRoot = flush.firstElementChild as HTMLElement
    expect(flushRoot).toHaveClass('overflow-hidden')
    expect(flushRoot).not.toHaveClass('p-5')

    const { container: quiet } = render(<Card quiet>note</Card>)
    const quietRoot = quiet.firstElementChild as HTMLElement
    expect(quietRoot).toHaveClass('bg-surface-soft')
    expect(quietRoot).not.toHaveClass('shadow-card')

    // Neither is an HTML attribute, and neither may become one.
    expect(flushRoot.hasAttribute('flush')).toBe(false)
    expect(quietRoot.hasAttribute('quiet')).toBe(false)
  })

  it('D. style still reaches the element, now as an ordinary div prop', () => {
    const { container } = render(<Card style={{ aspectRatio: '16 / 9' }}>media</Card>)
    expect((container.firstElementChild as HTMLElement).style.aspectRatio).toBe('16 / 9')
  })

  it('E. an event handler passed through actually fires', () => {
    let seen = 0
    render(
      <Card data-testid="clickable" onClick={() => (seen += 1)}>
        body
      </Card>,
    )
    screen.getByTestId('clickable').click()
    expect(seen).toBe(1)
  })
})

/* ================================================================== */
/* 2. HeroCard                                                         */
/* ================================================================== */

describe('2. HeroCard passes semantic props to its section', () => {
  it('A. can be named as a landmark with aria-labelledby', () => {
    render(
      <HeroCard aria-labelledby="hero-title" data-testid="hero">
        <h2 id="hero-title">Today’s training</h2>
      </HeroCard>,
    )

    const root = screen.getByTestId('hero')
    expect(root.tagName).toBe('SECTION')
    // A <section> is only a region once it has an accessible name, so this
    // assertion also proves the attribute landed on the section and not inside.
    expect(screen.getByRole('region', { name: 'Today’s training' })).toBe(root)
  })

  it('B. carries id, role and data-* without disturbing the wash', () => {
    render(
      <HeroCard id="hero-1" accent data-testid="hero" data-day="monday">
        body
      </HeroCard>,
    )
    const root = screen.getByTestId('hero')
    expect(root).toHaveAttribute('id', 'hero-1')
    expect(root).toHaveAttribute('data-day', 'monday')
    expect(root).toHaveClass('rounded-hero', 'from-accent-soft')
  })

  it('C. each tone still renders its own wash, and tone never reaches the DOM', () => {
    const { container: recovery } = render(<HeroCard tone="recovery">r</HeroCard>)
    const recoveryRoot = recovery.firstElementChild as HTMLElement
    expect(recoveryRoot).toHaveClass('from-recovery-soft')
    expect(recoveryRoot.hasAttribute('tone')).toBe(false)
    expect(recoveryRoot.hasAttribute('accent')).toBe(false)

    const { container: holiday } = render(<HeroCard tone="holiday">h</HeroCard>)
    expect(holiday.firstElementChild).toHaveClass('from-holiday-soft')

    const { container: plain } = render(<HeroCard>p</HeroCard>)
    const plainRoot = plain.firstElementChild as HTMLElement
    expect(plainRoot).toHaveClass('border-line', 'bg-surface')
    expect(plainRoot).not.toHaveClass('from-accent-soft')
  })

  it('D. still merges className alongside the base hero classes', () => {
    const { container } = render(<HeroCard className="order-1">body</HeroCard>)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('order-1', 'rounded-hero', 'shadow-card')
  })
})
