import { cn } from '@/lib/utils'

/**
 * Compact brand lockup: the V icon plus wordmark.
 * The icon file is the canonical SVG shipped in /public.
 */
export function BrandMark({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img
        src="/app-icon.svg"
        alt=""
        aria-hidden="true"
        className={cn('rounded-xl', compact ? 'size-9' : 'size-10')}
      />
      {!compact && (
        <div className="leading-tight">
          <p className="text-[15px] font-extrabold tracking-tight text-offwhite">
            VShape<span className="text-blue">100</span>
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Foundation
          </p>
        </div>
      )}
    </div>
  )
}
