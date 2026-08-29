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
    className: 'bg-blue text-navy',
  },
  LATE: {
    label: 'Late',
    icon: TriangleAlert,
    className: 'bg-late/15 text-late ring-1 ring-late/45',
  },
  NEXT: {
    label: 'Next',
    icon: Clock,
    className: 'bg-surface-overlay text-ink-dim ring-1 ring-edge-strong',
  },
  LATER: {
    label: 'Later',
    icon: Clock,
    className: 'text-ink-faint',
  },
  DONE_EARLIER: {
    label: 'Done earlier',
    icon: Check,
    className: 'bg-completed/15 text-completed',
  },
}

/** Plain-text status name, for screen readers and tests. */
export function statusLabel(status: TodayStatus): string {
  return statusMeta[status].label
}
