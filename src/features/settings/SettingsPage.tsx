import { ChevronRight, Dumbbell, Home, Info, Loader2, LogOut } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, useNavigate } from 'react-router'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants, press } from '@/design/motion'
import { useAuth } from '@/features/auth/AuthContext'
import { NotificationSettingsCard } from '@/features/notifications/NotificationSettingsCard'

const rows = [
  {
    icon: Home,
    label: 'Mode',
    value: 'Home',
    note: 'Holiday Mode is set from the Calendar.',
  },
  {
    icon: Info,
    label: 'App',
    value: 'v2 · Round 02',
    note: 'Foundation shell — vshapev2.nkmwei.de',
  },
]

export function SettingsPage() {
  const { user, logout, isLoggingOut } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <PageHeader title="Settings" subline="Personal setup, kept simple" />

      <motion.div
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-4"
      >
        {user && (
          <motion.div variants={listItemVariants}>
            <Card className="flex items-center gap-4 p-5">
              {user.picture ? (
                <img
                  src={user.picture}
                  alt=""
                  aria-hidden="true"
                  className="size-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-blue text-base font-extrabold text-offwhite"
                >
                  {user.email.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-offwhite">{user.name ?? 'Signed in'}</p>
                <p className="mt-0.5 truncate text-[13px] text-ink-faint">{user.email}</p>
              </div>
            </Card>
          </motion.div>
        )}

        <motion.div variants={listItemVariants}>
          {/*
            Reminders are a setting for THIS device, so they live here rather
            than becoming a destination: no route, no nav item, no inbox.
          */}
          <NotificationSettingsCard />
        </motion.div>

        <motion.div variants={listItemVariants}>
          {/*
            Exercise Library — the one place canonical exercise media is
            edited. Exercise Detail links to the same editor rather than
            carrying a second one.
          */}
          <Link
            to="/settings/exercises"
            className="block rounded-card"
            aria-label="Exercise Library"
          >
            <motion.div {...press}>
              <Card className="flex items-center gap-4 px-5 py-4 transition-colors duration-150 hover:border-edge-strong">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-overlay text-ink-dim">
                  <Dumbbell className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-offwhite">Exercise Library</p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-faint">
                    Set the demo media each exercise shows everywhere.
                  </p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-ink-faint" aria-hidden="true" />
              </Card>
            </motion.div>
          </Link>
        </motion.div>

        <motion.div variants={listItemVariants}>
          <Card className="divide-y divide-edge">
            {rows.map(({ icon: Icon, label, value, note }) => (
              <div key={label} className="flex items-center gap-4 px-5 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-overlay text-ink-dim">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-offwhite">{label}</p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-faint">{note}</p>
                </div>
                <span className="shrink-0 rounded-full bg-surface-overlay px-3 py-1 text-[12px] font-bold text-ink-dim">
                  {value}
                </span>
              </div>
            ))}
          </Card>
        </motion.div>

        <motion.div variants={listItemVariants}>
          <motion.button
            {...press}
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex w-full items-center justify-center gap-2.5 rounded-card border border-edge bg-surface px-5 py-4 text-sm font-bold text-coral transition-colors duration-150 hover:border-coral/40 disabled:opacity-70"
          >
            {isLoggingOut ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Signing out
              </>
            ) : (
              <>
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </>
            )}
          </motion.button>
          <p className="mt-2 text-center text-[12px] text-ink-faint">
            Signs out this device only.
          </p>
        </motion.div>
      </motion.div>
    </>
  )
}
