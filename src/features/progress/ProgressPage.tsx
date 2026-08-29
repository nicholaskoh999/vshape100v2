import { Flame, LineChart, Scale } from 'lucide-react'
import { motion } from 'motion/react'

import { EmptyShell } from '@/components/ui/EmptyShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants } from '@/design/motion'

export function ProgressPage() {
  return (
    <>
      <PageHeader
        eyebrow="Foundation"
        title="Progress"
        subline="Load, weight and streaks over time"
      />

      <motion.div
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-4 md:grid md:grid-cols-2"
      >
        <motion.div variants={listItemVariants} className="md:col-span-2">
          <EmptyShell
            icon={LineChart}
            title="Training progress"
            note="Double Progression tracking appears once set-by-set logging is live."
          />
        </motion.div>
        <motion.div variants={listItemVariants}>
          <EmptyShell
            icon={Scale}
            title="Weight trend"
            note="Optional daily weigh-ins chart here."
          />
        </motion.div>
        <motion.div variants={listItemVariants}>
          <EmptyShell
            icon={Flame}
            title="Streaks"
            note="Holiday Mode protects streaks — days marked Holiday are exempt, not missed."
          />
        </motion.div>
      </motion.div>
    </>
  )
}
