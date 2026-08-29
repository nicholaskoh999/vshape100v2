import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

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
    <header className={cn('mb-6 flex items-end justify-between gap-4 md:mb-8', className)}>
      <div>
        {eyebrow && (
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-blue">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[26px] font-extrabold tracking-tight text-offwhite md:text-3xl">
          {title}
        </h1>
        {subline && <p className="mt-1 text-sm text-ink-faint">{subline}</p>}
      </div>
      {actions}
    </header>
  )
}
