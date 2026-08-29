import { NavLink } from 'react-router'
import { Drawer } from 'vaul'

import { cn } from '@/lib/utils'
import { moreNavItems } from './navItems'

/**
 * Compact bottom sheet behind the mobile "More" tab.
 * Contains the destinations that don't earn a bottom-nav slot.
 */
export function MoreSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-navy/70 backdrop-blur-sm" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-card border-t border-edge bg-surface-raised shadow-pop outline-none pb-safe"
        >
          <div className="mx-auto w-full max-w-md px-4 pb-6 pt-3">
            <div
              aria-hidden="true"
              className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-edge-strong"
            />
            <Drawer.Title className="px-1 pb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
              More
            </Drawer.Title>
            <ul className="flex flex-col gap-1">
              {moreNavItems.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    onClick={() => onOpenChange(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3.5 rounded-control px-3.5 py-3.5 text-[15px] font-semibold transition-colors duration-150 active:scale-[0.98]',
                        isActive
                          ? 'bg-blue/15 text-offwhite'
                          : 'text-ink-dim hover:bg-surface-overlay hover:text-offwhite',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cn(
                            'grid size-10 place-items-center rounded-xl',
                            isActive
                              ? 'bg-blue text-offwhite'
                              : 'bg-surface-overlay text-ink-dim',
                          )}
                        >
                          <Icon className="size-5" aria-hidden="true" />
                        </span>
                        {label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
