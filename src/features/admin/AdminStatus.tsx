import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  CircleSlash,
  OctagonAlert,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { HealthStatus } from '@shared/admin'

/**
 * The four health words, as one component.
 *
 * NEVER STATUS BY COLOUR ALONE — the same rule the app's Badge already
 * enforces. Every chip renders its word and its own icon, so the meaning
 * survives greyscale, forced-colors mode and a photograph of a phone.
 *
 * `unknown` is styled as a quiet outline rather than as an alarm. It is not a
 * failure; it is the honest absence of proof, and dressing it in red would
 * teach the owner to ignore red.
 */
const chips: Record<HealthStatus, { label: string; icon: LucideIcon; className: string }> = {
  healthy: {
    label: 'Healthy',
    icon: CheckCircle2,
    className: 'bg-success-soft text-success-ink',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    className: 'bg-warn-soft text-warn-ink',
  },
  error: {
    label: 'Error',
    icon: OctagonAlert,
    className: 'bg-danger-soft text-danger-ink',
  },
  unknown: {
    label: 'Unknown',
    icon: CircleHelp,
    className: 'border border-line-strong text-ink-3',
  },
}

export function StatusChip({
  status,
  className,
}: {
  status: HealthStatus
  className?: string
}) {
  const chip = chips[status]
  const Icon = chip.icon
  return (
    <span
      className={cn(
        'vs-bordered inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold',
        chip.className,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {chip.label}
    </span>
  )
}

/**
 * "Unavailable" — a feature this build simply does not offer.
 *
 * Deliberately NOT one of the four health words. Health describes something
 * that exists and might be misbehaving; this describes something that is not
 * here at all, and the page must never let the two blur into each other. An
 * absent feature is not an amber warning and it is not a red error.
 *
 * Carries its own icon, like every other chip here, so the meaning survives
 * greyscale, forced-colors mode and a photograph of a phone.
 */
export function UnavailableChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'vs-bordered inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold',
        'border border-line-strong text-ink-3',
        className,
      )}
    >
      <CircleSlash className="size-3.5 shrink-0" aria-hidden="true" />
      Unavailable
    </span>
  )
}

/**
 * One subsystem: an icon, a name, a chip and one line of evidence.
 *
 * The note is not decoration. A status without its reason is a traffic light
 * with no road behind it — "Unknown" is only useful once it also says what
 * could not be proven.
 */
export function SystemCard({
  icon: Icon,
  name,
  status,
  note,
}: {
  icon: LucideIcon
  name: string
  status: HealthStatus
  note: string
}) {
  return (
    <div className="vs-bordered flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-[10px] bg-surface-soft text-ink-2"
        >
          <Icon className="size-4" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{name}</p>
      </div>
      <StatusChip status={status} className="self-start" />
      <p className="text-[12px] leading-relaxed text-ink-3">{note}</p>
    </div>
  )
}

/**
 * A label / value row.
 *
 * `value === null` renders the word Unknown, in the muted style, and NOT a
 * zero, a dash or an empty cell. The distinction is the whole point of this
 * page: a real 0 is a fact about the account, and Unknown is a fact about what
 * could be read.
 */
export function FactRow({
  label,
  value,
  note,
  trailing,
}: {
  label: string
  value: string | null
  note?: string
  trailing?: ReactNode
}) {
  return (
    <div className="flex min-h-tap items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink">{label}</span>
        {note && <span className="mt-0.5 block text-[12.5px] text-ink-3">{note}</span>}
      </span>
      {value === null ? (
        <span className="shrink-0 text-[13px] font-bold text-ink-4">Unknown</span>
      ) : (
        <span className="shrink-0 text-[15px] font-bold tabular-nums text-ink">{value}</span>
      )}
      {trailing}
    </div>
  )
}
