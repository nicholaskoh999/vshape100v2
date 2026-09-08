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
      {/* An ink tile with a lime V, rather than the shipped dark-ground icon
          file: the icon was drawn for a navy canvas and disappears on an
          off-white one. The public icon set stays as it is for the installed
          app, where it sits on the OS background rather than on ours. */}
      <span
        aria-hidden="true"
        className={cn(
          'grid shrink-0 place-items-center rounded-[13px] bg-ink font-extrabold text-accent',
          compact ? 'size-9 text-lg' : 'size-10 text-xl',
        )}
      >
        V
      </span>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[15px] font-extrabold tracking-tight text-ink">
            VShape<span className="text-accent-ink">100</span>
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-3">
            Foundation
          </p>
        </div>
      )}
    </div>
  )
}
