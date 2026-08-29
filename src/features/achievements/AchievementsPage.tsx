import { Lock } from 'lucide-react'
import { motion } from 'motion/react'

import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants } from '@/design/motion'

const placeholders = [
  'First session',
  'Full week',
  'Day 10',
  'Consistency',
  'Day 50',
  'Day 100',
]

export function AchievementsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Lightweight"
        title="Achievements"
        subline="Milestones unlock as the Foundation progresses"
      />

      <motion.ul
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="grid grid-cols-2 gap-3 md:grid-cols-3"
      >
        {placeholders.map((label) => (
          <motion.li
            key={label}
            variants={listItemVariants}
            className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-edge bg-surface/50 px-3 py-7 text-center"
          >
            <span className="grid size-11 place-items-center rounded-full bg-surface-overlay text-ink-faint">
              <Lock className="size-4.5" aria-hidden="true" />
            </span>
            <p className="text-[13px] font-bold text-ink-faint">{label}</p>
          </motion.li>
        ))}
      </motion.ul>
    </>
  )
}
