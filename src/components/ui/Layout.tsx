import type { LucideIcon } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

/**
 * The surfaces and rows every screen is assembled from.
 *
 * ONE CARD, ONE JOB. The deepest legitimate nesting is
 * `Card > list > ListRow`. No card inside a card inside a card.
 */

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

/**
 * ROUND 27 (VT-04). Semantic DOM props pass through to the root element.
 *
 * Before this, the prop list was closed: `children`, `className`, `style`,
 * `flush`, `quiet`. A caller who needed `id`, `role`, an `aria-*` attribute or
 * a `data-*` hook could not give the card one, and the workarounds were worse
 * than the gap — Round 26's Admin page wanted a `data-` marker on its
 * maintenance card and had to put it on the surrounding `<section>` instead,
 * which is a different element from the one the test was about.
 *
 * THE RULES THAT KEEP THIS SAFE.
 *
 *   - `className` is destructured, so it can never arrive inside `rest` and
 *     silently replace the merged classes. Merging behaviour is unchanged.
 *   - `rest` is spread BEFORE `className`, so even a future prop that slipped
 *     through could not win against the component's own styling.
 *   - `flush` and `quiet` are this component's own vocabulary and are
 *     destructured out. Neither is a DOM attribute, and neither reaches one.
 *   - `style` is no longer named separately; it is a `<div>` prop like any
 *     other and arrives through `rest`. It is still for values a class cannot
 *     express — the exercise media frame takes its aspect ratio from the media
 *     file itself, which is known at runtime.
 *
 * `ref` is deliberately NOT in this type. Nothing forwards a ref to a Card
 * today, and adding one would be inventing a contract nobody asked for.
 */
export function Card({
  children,
  className,
  /** Zero padding and clipped, for a divided list of rows. */
  flush = false,
  /** Records nothing: flat inset, no shadow, no card edge. */
  quiet = false,
  ...rest
}: ComponentPropsWithoutRef<'div'> & {
  children: ReactNode
  flush?: boolean
  quiet?: boolean
}) {
  return (
    <div
      {...rest}
      className={cn(
        'vs-bordered rounded-card',
        quiet
          ? 'bg-surface-soft'
          : 'border border-line bg-surface shadow-card',
        flush ? 'overflow-hidden' : 'p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * The page's leading block: bigger radius, more padding, one job.
 *
 * ROUND 27 (VT-04). Semantic props pass through, under the same rules as
 * `Card` above. The root is a `<section>`, so the passthrough is typed against
 * `<section>` — a HeroCard is a landmark, and `aria-labelledby` on it is the
 * normal way to name one.
 *
 * `tone` shadows nothing on `<section>` and is destructured out, so this
 * component's own word for a wash never lands on the DOM as an attribute.
 */
export function HeroCard({
  children,
  className,
  /** A soft accent wash. Reserved for the day's primary training action. */
  accent = false,
  tone,
  ...rest
}: ComponentPropsWithoutRef<'section'> & {
  children: ReactNode
  accent?: boolean
  /** An alternative wash for a day that is not a normal training day. */
  tone?: 'recovery' | 'holiday'
}) {
  return (
    <section
      {...rest}
      className={cn(
        'vs-bordered rounded-hero border p-6 shadow-card md:p-7',
        accent && 'border-accent-edge/35 bg-linear-168 from-accent-soft to-surface to-72%',
        tone === 'recovery' &&
          'border-recovery-ink/20 bg-linear-168 from-recovery-soft to-surface to-72%',
        tone === 'holiday' &&
          'border-holiday-ink/20 bg-linear-168 from-holiday-soft to-surface to-72%',
        !accent && !tone && 'border-line bg-surface',
        className,
      )}
    >
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Headings                                                            */
/* ------------------------------------------------------------------ */

/** Consistent page heading: small eyebrow, big title, optional subline. */
export function PageHeader({
  eyebrow,
  title,
  subline,
  actions,
  className,
}: {
  eyebrow?: string
  title: string
  subline?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-5 flex items-start justify-between gap-4 md:mb-6', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[28px] font-bold leading-[1.14] tracking-[-0.015em] text-ink md:text-[32px]">
          {title}
        </h1>
        {subline && <p className="mt-1 text-[13.5px] text-ink-2">{subline}</p>}
      </div>
      {actions}
    </header>
  )
}

/** A section title, with an optional trailing link or count. */
export function SectionHeader({
  title,
  id,
  trailing,
  className,
}: {
  title: string
  id?: string
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-2.5 mt-6 flex items-baseline justify-between gap-3 px-0.5', className)}>
      <h2 id={id} className="text-[19px] font-bold leading-[1.26] tracking-[-0.01em] text-ink">
        {title}
      </h2>
      {trailing}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Metric                                                              */
/* ------------------------------------------------------------------ */

export function MetricCard({
  icon: Icon,
  tone = 'neutral',
  value,
  unit,
  label,
  className,
}: {
  icon?: LucideIcon
  tone?: 'neutral' | 'accent' | 'warn' | 'info' | 'success'
  value: ReactNode
  unit?: string
  label: string
  className?: string
}) {
  const tones = {
    neutral: 'bg-surface-soft text-ink-2',
    accent: 'bg-accent-soft text-accent-ink',
    warn: 'bg-warn-soft text-warn-ink',
    info: 'bg-info-soft text-info-ink',
    success: 'bg-success-soft text-success-ink',
  } as const

  return (
    <div
      className={cn(
        'vs-bordered flex min-w-0 flex-col gap-0.5 rounded-card border border-line bg-surface p-4 shadow-card',
        className,
      )}
    >
      {Icon && (
        <span className={cn('mb-1.5 grid size-8 place-items-center rounded-xl', tones[tone])}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      )}
      <p className="text-[26px] font-bold leading-tight tracking-[-0.015em] text-ink">
        {value}
        {unit && <span className="text-[15px] font-semibold text-ink-2"> {unit}</span>}
      </p>
      <p className="text-xs font-semibold text-ink-3">{label}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

/**
 * The most-repeated pattern in the app: lead tile, title, subtitle, trailing.
 *
 * `to` makes the whole row one link. Without it the row is a plain div and any
 * control inside it owns its own hit area.
 */
export function ListRow({
  icon: Icon,
  lead,
  leadTone = 'neutral',
  title,
  subtitle,
  trailing,
  to,
  linkLabel,
  className,
  children,
}: {
  icon?: LucideIcon
  /** Overrides the icon — used for a position number. */
  lead?: ReactNode
  leadTone?: 'neutral' | 'accent' | 'done' | 'warn'
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  to?: string
  /**
   * The link's accessible name.
   *
   * Without it the name becomes title + subtitle + every badge in the row,
   * which is a sentence rather than a destination. A link should say where it
   * goes; the description is context, read after it.
   */
  linkLabel?: string
  className?: string
  /** Extra content under the subtitle, e.g. a badge row. */
  children?: ReactNode
}) {
  const tones = {
    neutral: 'bg-surface-soft text-ink-2',
    accent: 'bg-accent border border-accent-edge text-ink',
    done: 'bg-success-soft text-success-ink',
    warn: 'bg-warn-soft text-warn-ink',
  } as const

  const body = (
    <>
      {(Icon || lead) && (
        <span
          aria-hidden="true"
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-[13px] text-[13px] font-bold',
            tones[leadTone],
          )}
        >
          {Icon ? <Icon className="size-5" /> : lead}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-[1.3] text-ink">{title}</span>
        {subtitle && <span className="mt-0.5 block text-[13px] text-ink-2">{subtitle}</span>}
        {children}
      </span>
      {trailing}
    </>
  )

  const shell = cn(
    'flex min-h-tap items-center gap-3.5 px-4 py-3.5 no-underline',
    className,
  )

  if (to) {
    return (
      <Link
        to={to}
        aria-label={linkLabel}
        className={cn(shell, 'transition-colors duration-fast hover:bg-surface-soft')}
      >
        {body}
      </Link>
    )
  }
  return <div className={shell}>{body}</div>
}

/** A divided stack of rows inside one flush Card. */
export function RowList({
  children,
  className,
  label,
}: {
  children: ReactNode
  className?: string
  label?: string
}) {
  return (
    <Card flush className={className}>
      <ul aria-label={label} className="divide-y divide-line">
        {children}
      </ul>
    </Card>
  )
}
