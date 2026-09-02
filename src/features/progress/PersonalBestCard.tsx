import { Loader2, RefreshCw, Trophy } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/Card";

import { formatLocalDate } from "./formatDate";
import { formatPerformance, labelVariants } from "./formatPerformance";
import type { PerformanceState } from "./usePerformance";
import type { PerformanceVariant } from "./progressApi";

/**
 * Personal Bests — the best set actually completed, for each exercise.
 *
 * Derived on the server from ALL recorded history, never from the recent page
 * the Recent Workouts list shows. Nothing here re-ranks: a best computed in the
 * browser from whatever happened to be fetched is precisely the bug the
 * server-side complete read exists to prevent.
 *
 * Loaded sets are ordered by load first and reps only as the tie-break, so
 * 50 kg × 6 outranks 45 kg × 15. No estimated 1RM is used to trade the two
 * off, and nothing here suggests what to lift next.
 *
 * ROUND 20 CHANGED WHAT "BEST" CAN MEAN, so the copy here had to change too.
 * A best is only ever within one COMPARABLE VARIANT, and different variants
 * rank on different axes: kilogram work by load, band work by reps within one
 * exact band setup, bodyweight by reps or seconds. "The heaviest set you have
 * completed" was true when kilograms were the only thing the app could store,
 * and is now simply wrong for two of the three modalities.
 */

const INITIAL_VISIBLE = 6;

export function PersonalBestCard({ state }: { state: PerformanceState }) {
  const [expanded, setExpanded] = useState(false);
  const variants = state.performance?.variants ?? [];
  const shown = expanded ? variants : variants.slice(0, INITIAL_VISIBLE);
  // Computed across the WHOLE list, not per row: whether a qualifier is needed
  // depends on whether the same exercise appears more than once.
  const qualifiers = labelVariants(variants);

  return (
    <Card className="p-5">
      <div data-personal-best data-personal-best-state={state.status}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-faint">
              Personal best
            </p>
            <p className="mt-0.5 text-[13px] text-ink-faint">
              Your best completed set in each comparable measurement.
            </p>
          </div>
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-overlay text-ink-faint"
          >
            <Trophy className="size-5" />
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

        {state.status === "error" && (
          <Failure
            message="Could not load your personal bests. Nothing has been lost."
            onRetry={state.reload}
          />
        )}

        {state.status === "incomplete" && (
          <Failure
            /*
              A partial history can only produce a best that is too LOW, and a
              best that is too low looks exactly like a correct one. So none is
              shown at all.
            */
            message="Your full history could not be read, so no personal best is shown — a partial history would give a number that looks right and is not."
            onRetry={state.reload}
          />
        )}

        {state.status === "ready" && variants.length === 0 && (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-faint">
            No completed sets recorded yet. Finish a set in Training and your best will appear
            here.
          </p>
        )}

        {state.status === "ready" && variants.length > 0 && (
          <>
            <ul className="mt-4 divide-y divide-edge border-t border-edge">
              {shown.map((variant) => (
                <BestRow
                  key={variant.key}
                  variant={variant}
                  qualifier={qualifiers.get(variant.key) ?? null}
                />
              ))}
            </ul>

            {variants.length > INITIAL_VISIBLE && (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                className="mt-3 rounded-control px-2 py-1 text-[12px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
              >
                {expanded
                  ? "Show fewer"
                  : /*
                     * RESULTS, not exercises. One canonical exercise can hold
                     * several comparable variants — legacy kilograms, Black ×3,
                     * Red ×2 — and calling three variants "three exercises"
                     * would be a false count of what the user trains.
                     */
                    `Show all ${variants.length} results`}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function BestRow({
  variant,
  qualifier,
}: {
  variant: PerformanceVariant;
  qualifier: string | null;
}) {
  const best = variant.personalBest;
  if (!best) return null;

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <div className="min-w-0">
        <p className="truncate font-bold text-offwhite">{variant.exerciseName}</p>
        {qualifier && (
          <p className="mt-0.5 text-[12px] font-semibold text-ink-faint">{qualifier}</p>
        )}
      </div>
      <div className="text-right">
        <p className="font-extrabold tabular-nums text-offwhite">
          {formatPerformance(best, variant)}
        </p>
        {/*
          The FIRST date this exact performance was reached. Repeating it later
          is not becoming stronger, so the date does not move.
        */}
        <p className="mt-0.5 text-[12px] font-semibold text-ink-faint">
          {formatLocalDate(best.date)}
        </p>
      </div>
    </li>
  );
}

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p role="alert" className="max-w-prose text-[13px] font-semibold text-coral">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-edge-strong px-3.5 py-2 text-[13px] font-bold text-ink-dim transition-colors duration-150 hover:text-offwhite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
