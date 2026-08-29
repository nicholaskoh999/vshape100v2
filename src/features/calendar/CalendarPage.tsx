import { CalendarRange, Plane } from 'lucide-react'
import { motion } from 'motion/react'

import { EmptyShell } from '@/components/ui/EmptyShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { listItemVariants, listVariants } from '@/design/motion'

export function CalendarPage() {
  return (
    <>
      <PageHeader
        eyebrow="Home Mode"
        title="Calendar"
        subline="Foundation days and Holiday Mode"
      />

      <motion.div
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-4"
      >
        <motion.div variants={listItemVariants}>
          <EmptyShell
            icon={CalendarRange}
            title="Month view"
            note="The editable calendar arrives with Holiday persistence in a later round."
          />
        </motion.div>
        <motion.div variants={listItemVariants}>
          <EmptyShell
            icon={Plane}
            title="Holiday Mode"
            note="Mark a date or range as Holiday — exempt, not missed. Reminders pause, streaks stay safe."
          />
        </motion.div>
      </motion.div>
    </>
  )
}
