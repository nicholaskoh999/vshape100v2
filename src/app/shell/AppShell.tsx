import { motion } from 'motion/react'
import { Outlet, useLocation } from 'react-router'

import { BottomNav } from '@/components/navigation/BottomNav'
import { SideNav } from '@/components/navigation/SideNav'
import { pageVariants } from '@/design/motion'
import { FoundationStartProvider } from '@/features/settings/FoundationStartProvider'

/**
 * Responsive application shell.
 *
 * - < md (mobile): content + fixed 5-item bottom nav
 * - md–xl (tablet): compact icon rail on the left
 * - >= xl (desktop): full sidebar on the left
 *
 * Route content re-animates via shared motion tokens whenever the
 * pathname changes.
 *
 * The Foundation start date is loaded ONCE here and shared with every page, so
 * Today, Progress, Achievements and Settings can never disagree about which day
 * of Foundation it is. It sits inside the authenticated shell, so it never runs
 * for a signed-out visitor.
 */
export function AppShell() {
  const { pathname } = useLocation()

  return (
    <FoundationStartProvider>
    <div className="min-h-dvh">
      {/* Tablet rail */}
      <div className="hidden md:block xl:hidden">
        <SideNav variant="rail" />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden xl:block">
        <SideNav variant="full" />
      </div>

      <main
        id="main"
        className="min-h-dvh pb-24 pt-safe md:pb-10 md:pl-[76px] xl:pl-60"
      >
        <motion.div
          key={pathname}
          variants={pageVariants}
          initial="initial"
          animate="enter"
          className="mx-auto w-full max-w-md px-4 pt-4 md:max-w-2xl md:px-8 md:pt-8 xl:max-w-4xl"
        >
          <Outlet />
        </motion.div>
      </main>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
    </FoundationStartProvider>
  )
}
