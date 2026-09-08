import { ChevronRight, Library, ListOrdered, Moon, Play, Plus, RefreshCw } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'

import { Badge, IntensityBadge } from '@/components/ui/Badge'
import { Button, ButtonLink, IconButton } from '@/components/ui/Button'
import { Banner, Skeleton } from '@/components/ui/Feedback'
import {
  Card,
  HeroCard,
  ListRow,
  PageHeader,
  RowList,
  SectionHeader,
} from '@/components/ui/Layout'
import { listItemVariants, listVariants, press } from '@/design/motion'
import { useLocalToday } from '@/features/progress/useLocalToday'
import { EXTRA_SESSION_ID, extraSnapshotLabel } from './extra'
import { useProgramme } from '@/features/programme/programmeContext'
import { toTrainingSession, type TrainingSessionView } from '@/features/programme/programmeApi'
import { useWorkoutLog } from './useWorkoutLog'
import { buildWorkoutPlan } from './workoutPlan'
import { weekdayOf } from '@shared/localDate'

const restDays = [
  { day: 'Saturday', label: 'Chill route · no gym scheduled' },
  { day: 'Sunday', label: 'Recovery route · no gym scheduled' },
]

/** Monday–Friday, as `weekdayOf` numbers them (0 = Sunday). */
const WEEKDAY_SESSION: Record<number, string> = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
}

export function TrainingPage() {
  // ROUND 22. The account's own programme, not the static Foundation array.
  const { status, programme, reload } = useProgramme()

  const today = useLocalToday()
  const todaySessionId = WEEKDAY_SESSION[weekdayOf(today) ?? -1] ?? null
  const sessions = programme?.sessions ?? []

  return (
    <>
      <PageHeader
        eyebrow="Home Mode"
        title="Training"
        subline="Monday–Friday Foundation base"
        actions={
          <Link to="/settings/programme" className="shrink-0 rounded-control">
            <IconButton label="Edit programme" tabIndex={-1} className="pointer-events-none">
              <ListOrdered className="size-5" aria-hidden="true" />
            </IconButton>
          </Link>
        }
      />

      {status === 'loading' && (
        <div data-training-week="loading" className="flex flex-col gap-3">
          <p role="status" className="sr-only">
            Loading your training week
          </p>
          <Skeleton className="h-40 rounded-hero" />
          <Skeleton className="h-20 rounded-card" />
          <Skeleton className="h-20 rounded-card" />
          <Skeleton className="h-20 rounded-card" />
        </div>
      )}

      {status === 'error' && (
        /*
          Deliberately NOT the static Foundation week. Showing the default
          programme to somebody whose real one could not be read would show
          them a session they may have edited away.
        */
        <div data-training-week="error">
          <Banner
            tone="danger"
            live="alert"
            title="Your training week could not be loaded"
            actions={
              <Button size="sm" onClick={reload}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Retry
              </Button>
            }
          >
            Your own programme is not being guessed at, so no sessions are listed until it
            can be read. Nothing has been lost.
          </Banner>
        </div>
      )}

      {status === 'ready' && (
        <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:items-start xl:gap-6">
          <div className="flex flex-col gap-5">
            <NextActionHero
              session={
                programme && todaySessionId
                  ? toTrainingSession(programme, todaySessionId)
                  : undefined
              }
            />

            <section aria-label="The rest of the week">
              <SectionHeader
                title="The rest of the week"
                className="mt-0"
                trailing={
                  <Link
                    to="/settings/programme"
                    className="text-[13px] font-semibold text-accent-ink no-underline hover:underline"
                  >
                    Edit programme
                  </Link>
                }
              />

              <motion.ul
                variants={listVariants}
                initial="initial"
                animate="enter"
                className="flex flex-col gap-3"
              >
                {/*
                  Today's session is the hero above; listing it again here
                  would put the same session on the page twice. The list is
                  the REST of the week.
                */}
                {sessions
                  .filter((session) => session.id !== todaySessionId)
                  .map((session) => (
                  <motion.li key={session.id} variants={listItemVariants}>
                    <Link to={`/training/${session.id}`} className="block rounded-card">
                      <motion.div {...press} tabIndex={-1}>
                        <Card className="flex items-center gap-4 p-4 transition-colors duration-fast hover:border-line-strong">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1.5 flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-semibold text-ink-2">
                                {session.day}
                              </span>
                              <IntensityBadge intensity={session.intensity} />
                            </div>
                            <p className="truncate text-[15px] font-semibold text-ink">
                              {session.focus}
                            </p>
                            <p className="mt-0.5 text-[13px] text-ink-2">
                              {session.slots.length} exercises
                            </p>
                          </div>
                          <ChevronRight
                            className="size-5 shrink-0 text-ink-4"
                            aria-hidden="true"
                          />
                        </Card>
                      </motion.div>
                    </Link>
                  </motion.li>
                ))}
              </motion.ul>
            </section>

            <section aria-label="Weekend">
              <SectionHeader title="Weekend" />
              <ul className="flex flex-col gap-2.5">
                {restDays.map(({ day, label }) => (
                  <li key={day}>
                    {/*
                      A day that records nothing: flat and inset, with no card
                      edge. Deliberately NOT the dashed treatment an Extra used
                      to share — an Extra is real recorded training and a rest
                      row is the absence of it, so they must not look alike.
                    */}
                    <div className="flex items-center gap-3.5 rounded-card bg-surface-soft px-4 py-3.5">
                      <Moon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                      <p className="text-sm text-ink-2">
                        <span className="font-semibold text-ink">{day}</span> · {label}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="flex flex-col gap-5">
            <ExtraWorkoutEntry />

            <section aria-label="Set-up">
              <SectionHeader title="Set-up" className="mt-0" />
              <RowList label="Training set-up">
                <li>
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
                  <ListRow
                    to="/settings/exercises"
                    linkLabel="Exercise Library"
                    icon={Library}
                    title="Exercise Library"
                    subtitle="Names, input types and demo media"
                    trailing={
                      <ChevronRight className="size-4.5 shrink-0 text-ink-4" aria-hidden="true" />
                    }
                  />
                </li>
              </RowList>
            </section>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * The next training action, at the top of the page.
 *
 * Before Round 24 this page was five equivalent rows: nothing said which day it
 * was, which session was due tonight, or which was underway. The hero answers
 * that first.
 *
 * It links; it never writes. Start remains server-authoritative and lives on
 * the session's own screen, so there is still exactly one path to writing
 * workout truth.
 */
function NextActionHero({ session }: { session?: TrainingSessionView }) {
  if (!session) {
    return (
      <HeroCard>
        <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
          Today
        </p>
        <h2 className="mt-1 text-[22px] font-bold tracking-[-0.015em] text-ink">
          No session scheduled today
        </h2>
        <p className="mt-1.5 text-[13.5px] text-ink-2">
          The Foundation base trains Monday to Friday. Pick any day below to look at it, or
          add an Extra workout.
        </p>
      </HeroCard>
    )
  }

  const plan = buildWorkoutPlan(session)
  const sets = plan ? plan.reduce((sum, exercise) => sum + exercise.setCount, 0) : null

  return (
    <HeroCard accent>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <Badge tone="current">Today</Badge>
        <IntensityBadge intensity={session.intensity} />
      </div>
      <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
        {session.day}
      </p>
      <h2 className="mt-1 text-[24px] font-bold leading-[1.16] tracking-[-0.015em] text-ink">
        {session.focus}
      </h2>
      {sets === null ? (
        <p className="mt-1.5 text-[13.5px] text-ink-2">This session cannot be logged yet.</p>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Badge tone="outline">{`${session.exercises.length} exercises`}</Badge>
          <Badge tone="outline">{`${sets} sets to log`}</Badge>
        </div>
      )}
      <ButtonLink
        to={`/training/${session.id}`}
        variant="primary"
        size="lg"
        block
        className="mt-5"
      >
        <Play className="size-[18px]" aria-hidden="true" />
        Open today&rsquo;s session
      </ButtonLink>
    </HeroCard>
  )
}

/**
 * The way into an Extra Workout.
 *
 * Deliberately BELOW the Foundation week and visually secondary: the
 * Monday–Friday programme is the schedule, and an extra session is an
 * exception to it, not a peer.
 *
 * ROUND 24. It is a solid card carrying its own outline provenance chip, not a
 * dashed quiet row — because an Extra is REAL RECORDED TRAINING that writes
 * history, while the weekend rows above record nothing. Giving both the same
 * "dashed and quiet" language made a real workout look like the absence of one.
 *
 * It reads today's Extra so it can say Resume rather than offering to start a
 * second one. Reading is all it does: no occurrence is created by looking.
 */
function ExtraWorkoutEntry() {
  // The CURRENT local date, resynced at the next local midnight and whenever
  // the tab wakes. This entry only ever reads, so there is nothing to pin: once
  // the day turns, today has no Extra yet and the card correctly goes back to
  // offering one instead of claiming yesterday's is in progress.
  const date = useLocalToday()
  const workout = useWorkoutLog(date, EXTRA_SESSION_ID)

  const started = workout.status === 'ready' && workout.started
  // Frozen snapshot identity, not a lookup against today's template.
  const sourceLabel = extraSnapshotLabel(workout.occurrence)

  return (
    <section aria-label="Outside the schedule">
      <SectionHeader title="Outside the schedule" className="mt-0" />

      <Link to="/training/extra" className="block rounded-card">
        <motion.div {...press} tabIndex={-1}>
          <Card className="flex items-center gap-4 p-4 transition-colors duration-fast hover:border-line-strong">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-extra-soft text-extra-ink"
            >
              <Plus className="size-5" />
            </span>

            <div className="min-w-0 flex-1">
              <Badge tone="extra" icon={Plus} className="mb-1.5">
                Extra
              </Badge>
              <p className="text-[15px] font-semibold text-ink">
                {started ? 'Resume extra workout' : 'Extra workout'}
              </p>
              <p className="mt-0.5 truncate text-[13px] text-ink-2">
                {workout.status === 'loading'
                  ? 'Checking…'
                  : started
                    ? // The frozen source template identity, so the user knows
                      // which session is already underway before opening it.
                      `In progress · based on ${sourceLabel ?? workout.occurrence?.day ?? 'a Foundation session'}`
                    : 'Train again today, on top of your schedule'}
              </p>
            </div>

            <ChevronRight className="size-5 shrink-0 text-ink-4" aria-hidden="true" />
          </Card>
        </motion.div>
      </Link>

      <p className="mt-2.5 px-1 text-xs text-ink-3">
        An Extra is a voluntary session recorded as its own workout. It is never counted as,
        or merged with, the scheduled one.
      </p>
    </section>
  )
}
