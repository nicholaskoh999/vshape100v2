import { CalendarDays, Dumbbell, Loader2, RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";

import { Card } from "@/components/ui/Card";
import { IntensityBadge } from "@/components/ui/IntensityBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { listItemVariants, listVariants } from "@/design/motion";
import { useFoundationStart } from "@/features/settings/FoundationStartContext";
import type { SessionIntensity } from "@/features/training/sessions";
import { localWorkoutDate } from "@/features/training/workoutPlan";
import { cn } from "@/lib/utils";
import { pendingSets, type WorkoutProgress } from "@shared/workoutLog";
import { BodyWeightCard } from "./BodyWeightCard";
import { ExercisePerformanceCard } from "./ExercisePerformanceCard";
import { foundationLabel, foundationStatus } from "./foundation";
import type { WorkoutHistoryEntry } from "./historyApi";
import { PersonalBestCard } from "./PersonalBestCard";
import { usePerformance } from "./usePerformance";
import { useWorkoutHistory } from "./useWorkoutHistory";

/**
 * Progress — recorded facts only.
 *
 * Everything on this page is a fact that was persisted or derived exactly from
 * what was persisted. Nothing is inferred from absence: a workout that was
 * never started is simply absent, never a "missed" one, and no adherence
 * percentage is derived from that absence. Skipped sets are reported next to
 * completed ones, never folded into them.
 *
 * Round 15 adds body weight, Personal Bests and exercise performance as
 * SECTIONS of this page. They are not new destinations — the app still has one
 * Progress tab, and these are cards within it.
 *
 * The performance read is loaded once here and shared by the two cards that
 * need it, so opening Progress does not walk the whole set history twice.
 */
export function ProgressPage() {
  // The user's own calendar date, fixed for this mount.
  const [today] = useState(() => localWorkoutDate());
  // The one shared Foundation start contract.
  const foundationStart = useFoundationStart();
  const foundation = useMemo(
    // Withheld until the start date is known, so no day number is stated from
    // a guessed start.
    () =>
      foundationStart.status === "ready"
        ? foundationStatus(today, foundationStart.startDate)
        : null,
    [today, foundationStart.status, foundationStart.startDate],
  );
  const { status, history, reload } = useWorkoutHistory();
  const performance = usePerformance();

  return (
    <>
      <PageHeader
        eyebrow="Foundation"
        title="Progress"
        subline="What you have recorded so far."
      />

      <motion.div
        variants={listVariants}
        initial="initial"
        animate="enter"
        className="flex flex-col gap-4"
      >
        <motion.div variants={listItemVariants}>
          <FoundationOverview
            status={foundation}
            latest={history?.workouts[0] ?? null}
          />
        </motion.div>

        <motion.div variants={listItemVariants}>
          <BodyWeightCard />
        </motion.div>

        <motion.div variants={listItemVariants}>
          <RecordedOverview state={status} history={history} onRetry={reload} />
        </motion.div>

        <motion.div variants={listItemVariants}>
          <PersonalBestCard state={performance} />
        </motion.div>

        <motion.div variants={listItemVariants}>
          <ExercisePerformanceCard state={performance} />
        </motion.div>

        <motion.div variants={listItemVariants}>
          <RecentWorkouts state={status} history={history} />
        </motion.div>
      </motion.div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Foundation                                                          */
/* ------------------------------------------------------------------ */

function FoundationOverview({
  status,
  latest,
}: {
  status: ReturnType<typeof foundationStatus>;
  latest: WorkoutHistoryEntry | null;
}) {
  if (!status) return null;

  const upcoming = status.phase === "upcoming";

  return (
    <Card className="p-5">
      {/* Card does not forward extra props, so the phase marker lives here. */}
      <div data-foundation-phase={status.phase}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue">
              Foundation 100
            </p>
            <p className="mt-1 text-[26px] font-extrabold tracking-tight text-offwhite">
              {foundationLabel(status)}
            </p>
            <p className="mt-1 text-[13px] text-ink-faint">
              {upcoming
                ? // No Day 0: before the start there is nothing running yet.
                  `Starts in ${status.daysUntilStart} ${
                    status.daysUntilStart === 1 ? "day" : "days"
                  }.`
                : status.phase === "foundation"
                  ? "Counting from your own calendar."
                  : // Past Day 100 the count keeps going — nothing is finished.
                    "Past the first 100 days, still counting."}
            </p>
          </div>

          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-overlay text-ink-faint"
          >
            <CalendarDays className="size-5" />
          </span>
        </div>

        {!upcoming && status.day !== null && (
          <FoundationBar day={status.day} total={status.total} />
        )}

        {latest && (
          <p className="mt-3 text-[12px] font-semibold text-ink-faint">
            Last recorded workout · {formatWorkoutDate(latest.date)}
          </p>
        )}
      </div>
    </Card>
  );
}

function FoundationBar({ day, total }: { day: number; total: number }) {
  // Capped for the bar only — the day number itself keeps counting past 100.
  const shown = Math.min(day, total);
  const percent = Math.round((shown / total) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={shown}
      aria-label="Foundation day"
      className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay"
    >
      <div
        className="h-full rounded-full bg-blue"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recorded totals                                                     */
/* ------------------------------------------------------------------ */

function RecordedOverview({
  state,
  history,
  onRetry,
}: {
  state: "loading" | "ready" | "error";
  history: ReturnType<typeof useWorkoutHistory>["history"];
  onRetry: () => void;
}) {
  if (state === "loading") {
    return (
      <Card className="p-5">
        <p
          role="status"
          className="flex items-center gap-2 text-[13px] font-semibold text-ink-dim"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading your recorded training…
        </p>
      </Card>
    );
  }

  if (state === "error" || !history) {
    return (
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-[13px] font-semibold text-coral">
            Could not load your recorded training. Nothing has been lost.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      </Card>
    );
  }

  const { totals } = history;

  return (
    <Card className="p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
        Recorded training
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Workouts" value={totals.workouts} />
        {/*
          "Total sets", not "Sets logged": this counts every expected set row a
          Start created, so it includes sets that are still pending. Calling
          them logged would claim work that has not happened.
        */}
        <Stat label="Total sets" value={totals.sets} />
        <Stat label="Completed" value={totals.completed} tone="completed" />
        {/* Kept beside completed, never added into it. */}
        <Stat label="Skipped" value={totals.skipped} tone="skipped" />
      </dl>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "completed" | "skipped";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-[22px] font-extrabold tabular-nums",
          tone === "completed"
            ? "text-completed"
            : tone === "skipped"
              ? "text-late"
              : "text-offwhite",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recent workouts                                                     */
/* ------------------------------------------------------------------ */

function RecentWorkouts({
  state,
  history,
}: {
  state: "loading" | "ready" | "error";
  history: ReturnType<typeof useWorkoutHistory>["history"];
}) {
  if (state !== "ready" || !history) return null;

  if (history.workouts.length === 0) {
    return (
      <Card className="p-5">
        <div data-history-state="empty">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
            Recent workouts
          </p>
          <div className="mt-3 flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-overlay text-ink-faint"
            >
              <Dumbbell className="size-5" />
            </span>
            <div className="min-w-0">
              {/* Neutral and honest: nothing recorded yet is not a failure. */}
              <p className="text-sm font-bold text-ink-dim">
                No workouts recorded yet
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
                Start a workout from Training and every set you log will appear
                here.
              </p>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div data-history-state="populated">
        <p className="px-5 pb-3 pt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
          Recent workouts
        </p>
        <ol className="divide-y divide-edge border-t border-edge">
          {history.workouts.map((workout) => (
            <li
              key={`${workout.date}:${workout.sessionId}`}
              className="px-5 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold text-offwhite">
                    {/*
                      Provenance first, and read from the persisted `kind`
                      rather than from the session slug. A history row must
                      never let an Extra be mistaken for the Monday obligation
                      it was merely copied from.
                    */}
                    {workout.kind === "extra" && (
                      <span className="rounded-full bg-blue/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-blue">
                        Extra
                      </span>
                    )}
                    {/*
                      Provenance that could not be read is said so, never
                      quietly shown as an ordinary scheduled workout. The sets
                      are real, so the row stays; the claim about WHAT it was
                      is the part we withhold.
                    */}
                    {workout.kind === null && (
                      <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                        Unverified
                      </span>
                    )}
                    <span>
                      {/*
                        The frozen `day` snapshot, never a lookup against
                        today's Foundation template: a renamed session must not
                        rewrite what an already-recorded workout says it was.
                      */}
                      {workout.day || workout.sessionId}
                    </span>
                    <span className="text-[13px] font-semibold text-ink-faint">
                      {formatWorkoutDate(workout.date)}
                    </span>
                  </p>
                  {workout.focus && (
                    <p className="mt-0.5 text-[13px] text-ink-faint">
                      {workout.kind === "extra"
                        ? `${workout.focus} · extra, not the scheduled session`
                        : workout.kind === null
                          ? `${workout.focus} · recorded, but its provenance could not be read`
                          : workout.focus}
                    </p>
                  )}
                </div>
                {isIntensity(workout.intensity) && (
                  <IntensityBadge intensity={workout.intensity} />
                )}
              </div>
              <SetSummary progress={workout.progress} />
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

/**
 * The honest state of one recorded workout.
 *
 * "All sets resolved" is deliberately not "complete": a workout whose sets
 * were skipped is fully traversed and was not trained. Completed and skipped
 * are always shown separately, and anything untouched is reported as pending
 * rather than quietly dropped.
 */
function SetSummary({ progress }: { progress: WorkoutProgress }) {
  const pending = pendingSets(progress);
  const parts = [`${progress.completed} completed`];
  if (progress.skipped > 0) parts.push(`${progress.skipped} skipped`);
  if (pending > 0) parts.push(`${pending} pending`);

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold">
      <span className="text-ink-dim">
        {pending === 0 && progress.total > 0
          ? `All ${progress.total} sets resolved`
          : `${progress.resolved} / ${progress.total} sets resolved`}
      </span>
      <span aria-hidden="true" className="text-ink-faint">
        ·
      </span>
      <span className="text-ink-faint">{parts.join(" · ")}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const INTENSITIES: readonly string[] = ["HARD", "LIGHT", "PUMP"];

/**
 * Snapshot intensities are stored text, so they are checked rather than cast —
 * an unknown value renders no chip instead of a broken one.
 */
function isIntensity(value: string): value is SessionIntensity {
  return INTENSITIES.includes(value);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * `2026-08-31` → `31 Aug 2026`.
 *
 * Formatted from the calendar parts directly. Passing the string to `Date` and
 * reading local parts back would shift the date by a day for anyone west of
 * UTC — the stored value is already the user's own local workout date.
 */
function formatWorkoutDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return date;
  return `${Number(day)} ${monthName} ${year}`;
}
