import { motion } from 'motion/react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'

import { NAV_INDICATOR_ID, pressStrong, spring } from '@/design/motion'
import { cn } from '@/lib/utils'
import { MoreSheet } from './MoreSheet'
import { moreNavItems, primaryNavItems } from './navItems'
import { MoreHorizontal } from 'lucide-react'

/**
 * Mobile 5-item bottom navigation:
 * Today / Training / Progress / Calendar / More.
 * "More" opens a sheet with Achievements + Settings.
 */
export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { pathname } = useLocation()

  const moreActive = moreNavItems.some((item) => pathname.startsWith(item.to))

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-navy/85 backdrop-blur-xl pb-safe md:hidden"
    >
      <ul className="mx-auto flex h-16 max-w-md items-stretch px-1">
        {primaryNavItems.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              className="group relative flex h-full flex-col items-center justify-center gap-0.5 outline-offset-[-2px]"
            >
              {({ isActive }) => (
                <>
                  {isActive && !moreActive && (
                    <motion.span
                      layoutId={NAV_INDICATOR_ID}
                      transition={spring.snappy}
                      className="absolute top-1.5 h-1 w-8 rounded-full bg-lime"
                    />
                  )}
                  <motion.span
                    {...pressStrong}
                    className={cn(
                      'flex flex-col items-center gap-0.5 transition-colors duration-150',
                      isActive
                        ? 'text-offwhite'
                        : 'text-ink-faint group-hover:text-ink-dim',
                    )}
                  >
                    <Icon
                      className="size-[22px]"
                      strokeWidth={isActive ? 2.4 : 2}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        'text-[10px] tracking-wide',
                        isActive ? 'font-bold' : 'font-medium',
                      )}
                    >
                      {label}
                    </span>
                  </motion.span>
                </>
              )}
            </NavLink>
          </li>
        ))}

        <li className="flex-1">
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className="group relative flex h-full w-full flex-col items-center justify-center gap-0.5 outline-offset-[-2px]"
          >
            {moreActive && (
              <motion.span
                layoutId={NAV_INDICATOR_ID}
                transition={spring.snappy}
                className="absolute top-1.5 h-1 w-8 rounded-full bg-lime"
              />
            )}
            <motion.span
              {...pressStrong}
              className={cn(
                'flex flex-col items-center gap-0.5 transition-colors duration-150',
                moreActive
                  ? 'text-offwhite'
                  : 'text-ink-faint group-hover:text-ink-dim',
              )}
            >
              <MoreHorizontal
                className="size-[22px]"
                strokeWidth={moreActive ? 2.4 : 2}
                aria-hidden="true"
              />
              <span
                className={cn(
                  'text-[10px] tracking-wide',
                  moreActive ? 'font-bold' : 'font-medium',
                )}
              >
                More
              </span>
            </motion.span>
          </button>
        </li>
      </ul>

      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </nav>
  )
}
