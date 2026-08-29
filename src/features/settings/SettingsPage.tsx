import { Bell, Home, Info } from 'lucide-react'
import { motion } from 'motion/react'

import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants } from '@/design/motion'

const rows = [
  {
    icon: Home,
    label: 'Mode',
    value: 'Home',
    note: 'Holiday Mode is set from the Calendar.',
  },
  {
    icon: Bell,
    label: 'Notifications',
    value: 'Later',
    note: 'Web Push lands later in the Foundation build.',
  },
  {
    icon: Info,
    label: 'App',
    value: 'v2 · Round 01',
    note: 'Foundation shell — vshape100v2.nkmwei.de',
  },
]

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subline="Personal setup, kept simple" />

      <motion.div variants={listVariants} initial="initial" animate="enter">
        <Card className="divide-y divide-edge">
          {rows.map(({ icon: Icon, label, value, note }) => (
            <motion.div
              key={label}
              variants={listItemVariants}
              className="flex items-center gap-4 px-5 py-4"
            >
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
            </motion.div>
          ))}
        </Card>
      </motion.div>
    </>
  )
}
