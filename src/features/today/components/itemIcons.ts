import {
  BookOpen,
  Brush,
  ChartColumn,
  CookingPot,
  Dumbbell,
  House,
  Laptop,
  Moon,
  ShowerHead,
  Sofa,
  Sunrise,
  Tv,
  Utensils,
  type LucideIcon,
} from 'lucide-react'

import type { TodayIcon } from '../model/types'

/** Routine icon slug → Lucide icon. Lucide is the only icon set in the app. */
export const itemIcons: Record<TodayIcon, LucideIcon> = {
  sunrise: Sunrise,
  work: Laptop,
  home: House,
  cook: CookingPot,
  dinner: Utensils,
  gym: Dumbbell,
  shower: ShowerHead,
  reading: BookOpen,
  netflix: Tv,
  sleep: Moon,
  chill: Sofa,
  progress: ChartColumn,
  reset: Brush,
}
