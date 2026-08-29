import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Restrained raised surface — the one card style the shell uses. */
export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-edge bg-surface shadow-card',
        className,
      )}
    >
      {children}
    </div>
  )
}
