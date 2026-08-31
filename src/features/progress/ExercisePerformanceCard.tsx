import { LineChart, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/Card";

import { formatLocalDate } from "./formatDate";
import {
  formatPerformance,
  valueHeading,
  variantQualifier,
} from "./formatPerformance";
import { TrendChart, type TrendPoint } from "./TrendChart";
import type { PerformanceVariant } from "./progressApi";
import type { PerformanceState } from "./usePerformance";

/**
 * Exercise performance — how one exercise's recorded results have changed.
 *
 * One point per workout occurrence, taken from the best eligible completed set
 * in that workout. Nothing between two workouts is drawn as data: a three-week
 * gap is a gap, and the line across it is a reading aid, not a measurement.
 *
 * The selector offers only exercises with completed history, most recently
 * performed first, and it keeps measurement systems apart — kg, kg per
 * dumbbell, per-side and timed variants of one exercise are separate choices,
 * because a chart mixing them would not be about anything.
 *
 * Round 15 stops at reporting. There is no suggested next load and no rep
 * target here; that judgement belongs to Round 16.
 */

export function ExercisePerformanceCard({ state }: { state: PerformanceState }) {
  const variants = state.performance?.variants ?? [];
  const [chosenKey, setChosenKey] = useState<string | null>(null);

  /*
    Derived during render rather than synchronised in an effect.
    The server already orders variants most recently performed first, so the
    default is simply the first one, and a chosen variant that disappears — a
    correction can remove an exercise's last completed set — falls back to that
    default on the very same render instead of flashing an empty card first.
  */
  const selected =
    variants.find((variant) => variant.key === chosenKey) ?? variants[0] ?? null;

  return (
    <Card className="p-5">
      <div data-exercise-performance data-exercise-performance-state={state.status}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
              Exercise performance
            </p>
            <p className="mt-0.5 text-[13px] text-ink-faint">
              Your best completed set in each workout.
            </p>
          </div>
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-overlay text-ink-faint"
          >
            <LineChart className="size-5" />
          </span>
        </header>

        {state.status === "loading" && (
          <p
            role="status"
            className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-ink-dim"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Reading your recorded history…
          </p>
        )}

        {(state.status === "error" || state.status === "incomplete") && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="max-w-prose text-[13px] font-semibold text-coral">
              {state.status === "incomplete"
                ? "Your full history could not be read, so no trend is shown."
                : "Could not load your exercise history. Nothing has been lost."}
            </p>
            <button
              type="button"
              onClick={state.reload}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        )}

        {state.status === "ready" && variants.length === 0 && (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-faint">
            No completed sets recorded yet. Once you finish sets in Training, each exercise you
            have performed will be selectable here.
          </p>
        )}

        {state.status === "ready" && selected && (
          <>
            <div className="mt-4">
              <label
                htmlFor="performance-exercise"
                className="block text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint"
              >
                Exercise
              </label>
              <select
                id="performance-exercise"
                value={selected.key}
                onChange={(event) => setChosenKey(event.target.value)}
                className="mt-1 w-full rounded-control border border-edge-strong bg-surface-overlay px-3 py-2 text-[14px] font-semibold text-offwhite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
              >
                {variants.map((variant) => (
                  <option key={variant.key} value={variant.key}>
                    {optionLabel(variant)}
                  </option>
                ))}
              </select>
            </div>

            <SelectedVariant variant={selected} />
          </>
        )}
      </div>
    </Card>
  );
}

/** Most-recent-first ordering comes from the server; this only labels it. */
function optionLabel(variant: PerformanceVariant): string {
  const qualifier = variantQualifier(variant);
  return qualifier ? `${variant.exerciseName} (${qualifier})` : variant.exerciseName;
}

function SelectedVariant({ variant }: { variant: PerformanceVariant }) {
  const points: TrendPoint[] = variant.points.map((point) => ({
    date: point.date,
    id: point.sessionId,
    value: sortableValue(point.loadValue, point.result, variant),
    display: formatPerformance(point, variant),
  }));

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13px] font-semibold text-ink-dim">
          {variant.points.length}{" "}
          {variant.points.length === 1 ? "workout recorded" : "workouts recorded"}
        </p>
        <p className="text-[12px] font-semibold text-ink-faint">
          Last performed {formatLocalDate(variant.lastPerformed)}
        </p>
      </div>

      {variant.points.length === 1 ? (
        <div className="mt-3">
          <p className="text-[22px] font-extrabold tabular-nums text-offwhite">
            {formatPerformance(variant.points[0], variant)}
          </p>
          <p className="mt-0.5 text-[12px] font-semibold text-ink-faint">
            {formatLocalDate(variant.points[0].date)}
          </p>
          {/* One real result, and deliberately no line drawn through it. */}
          <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">
            One workout recorded so far — not enough history for a trend yet.
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <TrendChart
            points={points}
            label={`${variant.exerciseName} performance`}
            unitLabel={valueHeading(variant)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * What the chart plots for a point.
 *
 * For loaded reps that is the LOAD, because load is what the ranking is
 * primarily about and plotting reps would draw a line that disagrees with the
 * ordering beside it. The reps are not lost: every point's full performance is
 * written out in the table. For unloaded and timed variants there is only one
 * axis, so the result itself is plotted.
 *
 * A loaded set with no recorded load has no load to plot and falls back to its
 * reps, which is the only fact it carries.
 */
function sortableValue(
  loadValue: number | null,
  result: number,
  variant: PerformanceVariant,
): number {
  if (variant.resultKind === "reps" && variant.loadMode !== "none" && loadValue !== null) {
    return loadValue;
  }
  return result;
}
