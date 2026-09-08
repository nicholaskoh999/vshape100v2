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
 *
 * ROUND 24, Q2. There is deliberately NO centre Start action. A global
 * Start/Continue button would have to resolve today's plan, the flex choice,
 * whether the scheduled workout is already started, whether an Extra is in
 * flight and whether the programme is even readable before it could name
 * itself — and would be disabled-and-unexplained on every screen while any one
 * of those was unresolved. Resume lives in a contextual surface that exists
 * only when the server says there is something to resume.
 *
 * The bar is an opaque white plane rather than translucent dark glass: on a
 * light ground the blur reads as smudge, and the shadow is what separates it.
 */
export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { pathname } = useLocation()

  const moreActive = moreNavItems.some((item) => pathname.startsWith(item.to))

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-safe shadow-sticky md:hidden"
    >
      <ul className="mx-auto flex h-16 max-w-lg items-stretch px-1">
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
                      /* accent-edge, not the raw accent: a bare lime hairline
                         is near-invisible on an off-white canvas. */
                      className="absolute top-1.5 h-1 w-8 rounded-full bg-accent-edge"
                    />
                  )}
                  <motion.span
                    {...pressStrong}
                    tabIndex={-1}
                    className={cn(
                      'flex flex-col items-center gap-0.5 transition-colors duration-fast',
                      isActive ? 'text-ink' : 'text-ink-3 group-hover:text-ink-2',
                    )}
                  >
                    <Icon
                      className="size-[22px]"
                      strokeWidth={isActive ? 2.4 : 2}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        'text-[10.5px] tracking-wide',
                        isActive ? 'font-bold' : 'font-semibold',
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
                className="absolute top-1.5 h-1 w-8 rounded-full bg-accent-edge"
              />
            )}
            <motion.span
              {...pressStrong}
              tabIndex={-1}
              className={cn(
                'flex flex-col items-center gap-0.5 transition-colors duration-fast',
                moreActive ? 'text-ink' : 'text-ink-3 group-hover:text-ink-2',
              )}
            >
              <MoreHorizontal
                className="size-[22px]"
                strokeWidth={moreActive ? 2.4 : 2}
                aria-hidden="true"
              />
              <span
                className={cn(
                  'text-[10.5px] tracking-wide',
                  moreActive ? 'font-bold' : 'font-semibold',
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
