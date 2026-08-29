import { cn } from '@/lib/utils'
import type { SessionIntensity } from '@/features/training/sessions'

const styles: Record<SessionIntensity, string> = {
  HARD: 'bg-hard/15 text-hard',
  LIGHT: 'bg-light-day/15 text-light-day',
  PUMP: 'bg-pump/15 text-pump',
}

/** Session intensity chip — semantic colors are locked (HARD/LIGHT/PUMP). */
export function IntensityBadge({
  intensity,
  className,
}: {
  intensity: SessionIntensity
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em]',
        styles[intensity],
        className,
      )}
    >
      {intensity}
    </span>
  )
}
