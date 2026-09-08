import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

/**
 * The one button in the app.
 *
 * Round 24 replaces roughly forty bespoke className strings with five
 * variants and three sizes, so a control's weight always matches its
 * consequence rather than whichever screen it happens to live on.
 *
 * SIZES ARE A TRUTH ABOUT WHERE THE CONTROL IS USED, not decoration:
 *
 *   sm   36px  dense secondary actions, never a primary
 *   md   44px  the floor for anything tappable, anywhere
 *   lg   56px  the in-gym primary — Complete set, Start workout
 *
 * Nothing in this app is smaller than 44px if it can be tapped, and the
 * controls pressed mid-set with sweaty hands are 56px.
 */

export type ButtonVariant =
  | 'primary'
  | 'ink'
  | 'secondary'
  | 'ghost'
  | 'danger'

export type ButtonSize = 'sm' | 'md' | 'lg'

const variants: Record<ButtonVariant, string> = {
  /*
   * An accent fill on a light ground has almost no boundary contrast on its
   * own (1.25:1), so the accent-edge border is required, not optional. The
   * label is ink on lime at 14.3:1.
   */
  primary:
    'bg-accent border-accent-edge text-ink hover:bg-accent-press on-fill',
  ink: 'bg-ink border-ink text-ink-on-dark hover:bg-ink/90 on-fill',
  secondary:
    'bg-surface border-line-strong text-ink hover:border-ink-4',
  ghost: 'border-transparent text-ink-2 hover:bg-surface-soft hover:text-ink',
  danger:
    'bg-danger-soft border-danger-ink/25 text-danger-ink hover:border-danger-ink/45',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-[13px] rounded-field gap-1.5',
  md: 'min-h-tap px-4.5 text-sm rounded-control gap-2',
  lg: 'min-h-gym px-6 text-base rounded-control gap-2.5',
}

const base =
  'inline-flex items-center justify-center border font-bold no-underline ' +
  'transition-[background-color,border-color,transform] duration-fast ' +
  'active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45 ' +
  'disabled:active:scale-100 aria-disabled:cursor-not-allowed ' +
  'aria-disabled:opacity-45'

function classes(
  variant: ButtonVariant,
  size: ButtonSize,
  block?: boolean,
  className?: string,
): string {
  return cn(base, variants[variant], sizes[size], block && 'w-full', className)
}

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children'> & {
    className?: string
  }

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={classes(variant, size, block, className)} {...rest}>
      {children}
    </button>
  )
}

/** The same shape, as an in-app link. */
export function ButtonLink({
  to,
  variant = 'secondary',
  size = 'md',
  block,
  className,
  children,
  ...rest
}: {
  to: string
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  className?: string
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<typeof Link>, 'to' | 'className' | 'children'>) {
  return (
    <Link to={to} className={classes(variant, size, block, className)} {...rest}>
      {children}
    </Link>
  )
}

/**
 * A square control carrying only an icon.
 *
 * `label` is REQUIRED by the type, because an icon-only control with no
 * accessible name is invisible to a screen reader and this app has several
 * of them today.
 */
export function IconButton({
  label,
  size = 'md',
  variant = 'secondary',
  className,
  type = 'button',
  children,
  ...rest
}: {
  label: string
  size?: 'sm' | 'md'
  variant?: ButtonVariant
  className?: string
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children' | 'aria-label'>) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        base,
        variants[variant],
        size === 'sm'
          ? 'size-9 rounded-field'
          : 'size-tap shrink-0 rounded-control',
        'px-0',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
