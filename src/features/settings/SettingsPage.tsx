import {
  ChevronRight,
  Info,
  Library,
  ListOrdered,
  Loader2,
  LogOut,
  SlidersHorizontal,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useNavigate } from 'react-router'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, ListRow, PageHeader, RowList, SectionHeader } from '@/components/ui/Layout'
import { listItemVariants, listVariants } from '@/design/motion'
import { useAuth } from '@/features/auth/AuthContext'
import { NotificationSettingsCard } from '@/features/notifications/NotificationSettingsCard'
import { FoundationStartCard } from './FoundationStartCard'

const rows = [
  {
    icon: Info,
    label: 'App',
    // Deliberately not a round number: this row said "Round 02" for sixteen
    // rounds because nothing makes a hard-coded version follow the code.
    value: 'v2',
    note: 'Foundation — vshapev2.nkmwei.de',
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
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-base font-bold text-ink"
                >
                  {user.email.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-ink">{user.name ?? 'Signed in'}</p>
                <p className="mt-0.5 truncate text-[13px] text-ink-3">{user.email}</p>
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

        {/*
          Foundation Start Date. A setting, not a destination: it renumbers
          Foundation days and milestones and touches nothing else.
        */}
        <motion.div variants={listItemVariants}>
          <FoundationStartCard />
        </motion.div>

        <motion.div variants={listItemVariants}>
          <SectionHeader title="Training" className="mt-2" />
          <RowList label="Training set-up">
            <li>
              {/*
                ROUND 24 (Q3, approved). The training week gets a real entry
                point. Before this link the programme editor was reachable only
                through Exercise Library → an exercise → its media editor,
                behind a control labelled "Edit media".
              */}
              <ListRow
                to="/settings/programme"
                linkLabel="Programme"
                icon={ListOrdered}
                title="Programme"
                subtitle="Arrange your Monday–Friday training week"
                trailing={
                  <ChevronRight className="size-4.5 shrink-0 text-ink-4" aria-hidden="true" />
                }
              />
            </li>
            <li>
              {/*
                Exercise Library — the one place canonical exercise identity,
                input type and media are edited. Exercise Detail links to the
                same editor rather than carrying a second one.
              */}
              <ListRow
                to="/settings/exercises"
                linkLabel="Exercise Library"
                icon={Library}
                title="Exercise Library"
                subtitle="Names, input types and the demo media each exercise shows"
                trailing={
                  <ChevronRight className="size-4.5 shrink-0 text-ink-4" aria-hidden="true" />
                }
              />
            </li>
          </RowList>
        </motion.div>

        <motion.div variants={listItemVariants}>
          <SectionHeader title="System" className="mt-2" />
          <RowList label="System">
            <li>
              {/*
                ROUND 27 (VT-13). Admin was URL-only. On a personal app that
                meant the owner had to remember and type /admin, which is not a
                security boundary — it is just an inconvenience for the one
                person the page is for.

                THIS ROW CHANGES NOTHING ABOUT ACCESS. It is a link, and a link
                is not an entitlement. Every fact on /admin comes from an API
                that checks a server-side `google_sub` allowlist and fails
                closed when that allowlist is unset. A signed-in non-admin who
                follows this row gets the same refusal they would get by typing
                the URL, and this row is not conditioned on anything the client
                believes about who is an admin — there is no such flag to read,
                which is exactly the property Round 26 was built to have.
              */}
              <ListRow
                to="/admin"
                linkLabel="Admin"
                icon={SlidersHorizontal}
                title="Admin"
                subtitle="System health and account facts"
                trailing={
                  <ChevronRight className="size-4.5 shrink-0 text-ink-4" aria-hidden="true" />
                }
              />
            </li>
          </RowList>
        </motion.div>

        <motion.div variants={listItemVariants}>
          <Card className="divide-y divide-line">
            {rows.map(({ icon: Icon, label, value, note }) => (
              <div key={label} className="flex items-center gap-4 px-5 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-soft text-ink-2">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink">{label}</p>
                  <p className="mt-0.5 truncate text-[13px] text-ink-3">{note}</p>
                </div>
                <Badge tone="neutral">{value}</Badge>
              </div>
            ))}
          </Card>
        </motion.div>

        <motion.div variants={listItemVariants}>
          <Button
            block
            size="lg"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="text-danger-ink"
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
          </Button>
          <p className="mt-2 text-center text-[12px] text-ink-3">
            Signs out this device only.
          </p>
        </motion.div>
      </motion.div>
    </>
  )
}
