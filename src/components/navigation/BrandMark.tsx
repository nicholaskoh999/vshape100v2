import { cn } from '@/lib/utils'

/**
 * The app chrome's brand lockup: the shield symbol plus the wordmark.
 *
 * ROUND 24 FINAL POLISH. This drew a literal letter "V" in an ink tile — a
 * stand-in from before the production artwork existed, kept because the old
 * shipped icon file had been drawn for a navy canvas and disappeared on an
 * off-white one. Both halves of that reasoning are now obsolete: the
 * production symbol is transparent, is drawn for the light system, and is
 * already what the login screen and the auth splash show. Leaving a letter
 * here would mean the app introduced itself with one mark and then wore
 * another.
 *
 * The image is decorative. The wordmark beside it supplies the brand name,
 * and in the rail — where the wordmark is hidden — the navigation is labelled
 * by its own items rather than by the logo.
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
      {/*
        The box is larger than the mark it holds: the artwork sits in a 1024
        viewBox whose shield is 864 tall, so a 40px box draws a ~34px shield.
        These sizes are chosen so the transparent symbol carries the same
        optical weight the filled tile did, not to match its numbers.
      */}
      <img
        src="/vshape-symbol.svg"
        alt=""
        aria-hidden="true"
        className={cn('shrink-0', compact ? 'size-10' : 'size-11')}
      />
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
