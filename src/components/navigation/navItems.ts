import {
  CalendarDays,
  Dumbbell,
  Settings,
  Sun,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
}

/** Primary destinations — order matters for bottom nav + sidebars. */
export const primaryNavItems: NavItem[] = [
  { to: '/today', label: 'Today', icon: Sun },
  { to: '/training', label: 'Training', icon: Dumbbell },
  { to: '/progress', label: 'Progress', icon: TrendingUp },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
]

/** Destinations that live under "More" on mobile, inline on tablet/desktop. */
export const moreNavItems: NavItem[] = [
  { to: '/achievements', label: 'Achievements', icon: Trophy },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export const allNavItems: NavItem[] = [...primaryNavItems, ...moreNavItems]
