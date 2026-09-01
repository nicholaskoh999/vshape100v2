import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Restrained raised surface — the one card style the shell uses.
 *
 * `style` is accepted only for values a class cannot express. Round 19.1 needs
 * it for exactly one thing: the exercise media frame takes its aspect ratio from
 * the media file itself, which is known at runtime, and Tailwind's arbitrary
 * `aspect-[…]` values have to be static at build time. Everything else about a
 * card still belongs in `className`.
 */
export function Card({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-edge bg-surface shadow-card',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  )
}
