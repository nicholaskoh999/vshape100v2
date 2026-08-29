import { cn } from '@/lib/utils'
import type { TodayStatus } from '../model/types'
import { statusMeta } from './statusMeta'

export function StatusBadge({
  status,
  className,
}: {
  status: TodayStatus
  className?: string
}) {
  const { label, icon: Icon, className: tone } = statusMeta[status]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em]',
        tone,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  )
}
