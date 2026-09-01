import { motion } from 'motion/react'
import { NavLink } from 'react-router'

import { NAV_INDICATOR_ID, press, spring } from '@/design/motion'
import { cn } from '@/lib/utils'
import { BrandMark } from './BrandMark'
import { allNavItems } from './navItems'

/**
 * Side navigation with two densities:
 * - `rail`: tablet — icon-first compact rail with short labels
 * - `full`: desktop — full sidebar with direct entries for all six sections
 * Both list every destination directly; "More" is a mobile-only concept.
 */
export function SideNav({ variant }: { variant: 'rail' | 'full' }) {
  const isRail = variant === 'rail'

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-edge bg-surface/60 backdrop-blur-xl pt-safe',
        isRail ? 'w-[76px]' : 'w-60',
      )}
    >
      <div className={cn('flex items-center', isRail ? 'justify-center py-5' : 'px-5 py-6')}>
        <BrandMark compact={isRail} />
      </div>

      <ul className={cn('flex flex-1 flex-col gap-1', isRail ? 'px-2.5' : 'px-3')}>
        {allNavItems.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className="relative block outline-offset-2"
              title={isRail ? label : undefined}
            >
              {({ isActive }) => (
                <motion.span
                  {...press}
                  tabIndex={-1}
                  className={cn(
                    'relative flex items-center rounded-control transition-colors duration-150',
                    isRail
                      ? 'flex-col gap-1 px-1 py-2.5'
                      : 'gap-3 px-3.5 py-2.5',
                    isActive
                      ? 'text-offwhite'
                      : 'text-ink-faint hover:bg-surface-overlay/60 hover:text-ink-dim',
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId={NAV_INDICATOR_ID}
                      transition={spring.snappy}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-control bg-blue/15 shadow-[inset_2px_0_0_0_var(--color-blue)]"
                    />
                  )}
                  <Icon
                    className={cn('relative', isRail ? 'size-[22px]' : 'size-5')}
                    strokeWidth={isActive ? 2.4 : 2}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      'relative tracking-wide',
                      isRail ? 'text-[10px]' : 'text-sm',
                      isActive ? 'font-bold' : 'font-medium',
                    )}
                  >
                    {label}
                  </span>
                </motion.span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <div
        className={cn(
          'border-t border-edge py-4 text-ink-faint',
          isRail ? 'px-2 text-center' : 'px-5',
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">
          {isRail ? 'v2' : 'Foundation · v2'}
        </p>
      </div>
    </nav>
  )
}
