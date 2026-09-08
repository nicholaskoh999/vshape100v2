import { Check, Clock, Play, TriangleAlert, type LucideIcon } from 'lucide-react'

import type { TodayStatus } from '../model/types'

type StatusMeta = { label: string; icon: LucideIcon; className: string }

/**
 * Status is carried by three signals at once — wording, icon shape and
 * treatment (solid / ringed / flat) — so it never depends on colour alone.
 */
export const statusMeta: Record<TodayStatus, StatusMeta> = {
  NOW: {
    label: 'Now',
    icon: Play,
    className: 'bg-ink text-ink-on-dark',
  },
  LATE: {
    label: 'Late',
    icon: TriangleAlert,
    className: 'bg-warn-soft text-warn-ink ring-1 ring-warn-ink/25',
  },
  NEXT: {
    label: 'Next',
    icon: Clock,
    className: 'bg-surface-soft text-ink-2 ring-1 ring-line-strong',
  },
  LATER: {
    label: 'Later',
    icon: Clock,
    className: 'text-ink-3',
  },
  DONE_EARLIER: {
    label: 'Done earlier',
    icon: Check,
    className: 'bg-success-soft text-success-ink',
  },
}

/** Plain-text status name, for screen readers and tests. */
export function statusLabel(status: TodayStatus): string {
  return statusMeta[status].label
}
