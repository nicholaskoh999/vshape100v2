import { Loader2, RefreshCw, Scale, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import {
  BODY_WEIGHT_RANGES,
  formatWeight,
  formatWeightChange,
  toWeightTenths,
  type BodyWeightRange,
} from "@shared/bodyWeight";

import { formatLocalDate } from "./formatDate";
import { TrendChart, type TrendPoint } from "./TrendChart";
import type { WeightHistory, WeightPoint } from "./progressApi";
import { useBodyWeight } from "./useBodyWeight";
import { useLocalToday } from "./useLocalToday";

/**
 * Body weight — the measurements themselves, and only what follows from them.
 *
 * Round 15 records weight in kilograms and reports how it has changed. It does
 * not comment on the number, set a target, or turn a direction into progress
 * or a problem: gaining and losing are shown the same way, with a sign.
 *
 * Every comparison that needs two measurements is unavailable until there are
 * two. A single measurement is a fact; "no change" would be a claim.
 */

const RANGE_LABELS: Record<BodyWeightRange, string> = {
  "30d": "30D",
  "90d": "90D",
  all: "All",
};

export function BodyWeightCard() {
  const { status, history, range, setRange, write, save, remove, reload } = useBodyWeight();

  // Round 18 Correction 1: has a read EVER settled?
  //
  // The entry form must keep its own state — a half-typed weight, a deliberately
  // chosen backfill date — across a background refetch. Folding the local date
  // into the read identity means midnight now genuinely re-reads, so the card
  // passes through `loading` (and possibly `error`) while the user may be in the
  // middle of typing. If the form only existed inside the `ready` branch it
  // would UNMOUNT on the way through, and React would discard that draft.
  //
  // So once history has arrived the form stays mounted at a fixed position in
  // the tree, whatever the read is doing afterwards. History-derived props fall
  // back to empty rather than to the previous day's values: the draft is the
  // user's, but the numbers are not ours to keep showing.
  const [everLoaded, setEverLoaded] = useState(false);
  if (history !== null && !everLoaded) setEverLoaded(true);

  return (
    <Card className="p-5">
      <div data-body-weight data-body-weight-state={status}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-bold tracking-[-0.01em] text-ink">
              Body weight
            </p>
            <p className="mt-0.5 text-[13px] text-ink-3">
              Kilograms, to one decimal place.
            </p>
          </div>
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-soft text-ink-3"
          >
            <Scale className="size-5" />
          </span>
        </header>

        {status === "loading" && (
          <p
            role="status"
            className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-ink-2"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading your measurements…
          </p>
        )}

        {status === "error" && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-[13px] font-semibold text-danger-ink">
              Could not load your measurements. Nothing has been lost.
            </p>
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-1.5 rounded-control border border-line-strong px-3.5 py-2 text-[13px] font-bold text-ink-2 transition-colors duration-fast hover:text-ink"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        )}

        {/*
          NOTHING RECORDED YET — A COMPACT STATE, NOT A SKELETON OF THE FULL ONE.

          Round 24 correction. Before a first measurement exists this card spent
          most of a phone screen on three empty metric blocks — Latest —,
          Since previous —, Since first — — and a window switcher for a history
          with nothing in it, pushing the one thing there is to do off the fold.
          After the planned Fresh Start that is the state every account opens on.

          So with a LIFETIME count of zero it says so once, plainly, and puts the
          form directly underneath. No trend is fabricated to fill the space, and
          the full layout returns untouched the moment there is a real
          measurement to derive it from.
        */}
        {status === "ready" && history && history.summary.count === 0 && (
          <div data-body-weight-empty className="mt-4">
            <p className="text-[15px] font-bold text-ink">No weight recorded yet</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
              Add your first measurement below. Changes and the trend chart appear once
              there is something real to derive them from.
            </p>
          </div>
        )}

        {status === "ready" && history && history.summary.count > 0 && (
          <>
            <Summary history={history} />

            <RangeTabs range={range} onChange={setRange} count={history.points.length} />

            {history.points.length === 0 ? (
              <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
                {range === "all"
                  ? "No measurements recorded yet. Add one below and it will appear here."
                  : `No measurements in the last ${RANGE_LABELS[range].replace("D", " days")}. Switch to All to see everything recorded.`}
              </p>
            ) : (
              <div className="mt-3">
                <TrendChart
                  points={toTrendPoints(history.points)}
                  label="Body weight"
                  unitLabel="Weight (kg)"
                />
                {history.points.length === 1 && (
                  <p className="mt-2 text-[12px] font-semibold text-ink-3">
                    {/* One real point, and no line drawn through it. */}
                    One measurement so far — not enough for a trend yet.
                  </p>
                )}
              </div>
            )}

          </>
        )}

        {/*
          A FIXED position in the tree, deliberately outside every status
          branch, so a refetch cannot remount it and throw away what the user
          was typing.
        */}
        {(status === "ready" || everLoaded) && (
          <MeasurementForm
            write={write}
            latest={history?.summary.latest ?? null}
            onSave={save}
            onDelete={remove}
            points={history?.points ?? []}
          />
        )}
      </div>
    </Card>
  );
}

function toTrendPoints(points: readonly WeightPoint[]): TrendPoint[] {
  return points.map((point) => ({
    date: point.date,
    value: point.tenths,
    display: `${formatWeight(point.tenths)} kg`,
  }));
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

function Summary({ history }: { history: WeightHistory }) {
  const { latest, changeFromPreviousTenths, changeFromFirstTenths, count } = history.summary;

  return (
    <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="min-w-0">
        <dt className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
          Latest
        </dt>
        <dd className="mt-0.5 text-[26px] font-bold tabular-nums text-ink">
          {latest ? (
            <>
              {formatWeight(latest.tenths)}
              <span className="ml-1 text-[15px] font-bold text-ink-3">kg</span>
            </>
          ) : (
            <span className="text-[15px] font-bold text-ink-3">No measurement</span>
          )}
        </dd>
        {latest && (
          <p className="mt-0.5 text-[12px] font-semibold text-ink-3">
            {formatLocalDate(latest.date)}
          </p>
        )}
      </div>

      <Change
        label="Since previous"
        tenths={changeFromPreviousTenths}
        count={count}
        from={history.summary.previous?.date}
      />
      <Change
        label="Since first"
        tenths={changeFromFirstTenths}
        count={count}
        from={history.summary.first?.date}
      />
    </dl>
  );
}

/**
 * One change, or an honest statement that it cannot be computed.
 *
 * Direction is carried by the sign and by the word, never by colour alone —
 * and neither direction is styled as good or bad, because the app is not
 * making that judgement.
 */
function Change({
  label,
  tenths,
  count,
  from,
}: {
  label: string;
  tenths: number | null;
  count: number;
  from?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
        {label}
      </dt>
      <dd
        className="mt-0.5 text-[26px] font-bold tabular-nums text-ink"
        data-change={tenths ?? "unavailable"}
      >
        {tenths === null ? (
          <span className="text-[15px] font-bold text-ink-3">
            {/* Not "0.0": with one measurement there is nothing to compare. */}
            {count === 0 ? "—" : "Needs two measurements"}
          </span>
        ) : (
          <>
            {formatWeightChange(tenths)}
            <span className="ml-1 text-[15px] font-bold text-ink-3">kg</span>
          </>
        )}
      </dd>
      {tenths !== null && from && (
        <p className="mt-0.5 text-[12px] font-semibold text-ink-3">
          {tenths === 0 ? "Unchanged from" : "From"} {formatLocalDate(from)}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Range                                                               */
/* ------------------------------------------------------------------ */

function RangeTabs({
  range,
  onChange,
  count,
}: {
  range: BodyWeightRange;
  onChange: (range: BodyWeightRange) => void;
  count: number;
}) {
  return (
    <div
      role="group"
      aria-label="Measurement window"
      className="mt-4 flex flex-wrap items-center gap-1.5"
    >
      {BODY_WEIGHT_RANGES.map((option) => {
        const active = option === range;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={active}
            className={cn(
              "rounded-control border px-3 py-1.5 text-[12px] font-bold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
              active
                ? "border-accent-edge bg-accent/12 text-info-ink"
                : "border-line-strong text-ink-2 hover:text-ink",
            )}
          >
            {RANGE_LABELS[option]}
          </button>
        );
      })}
      <span className="ml-auto text-[12px] font-semibold tabular-nums text-ink-3">
        {count} {count === 1 ? "measurement" : "measurements"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add / update / delete                                               */
/* ------------------------------------------------------------------ */

function MeasurementForm({
  write,
  latest,
  onSave,
  onDelete,
  points,
}: {
  write: ReturnType<typeof useBodyWeight>["write"];
  latest: WeightPoint | null;
  onSave: (date: string, weightKg: number) => void;
  onDelete: (date: string) => void;
  points: readonly WeightPoint[];
}) {
  // Live, not captured at mount. A tab left open across midnight kept
  // offering yesterday until it was reloaded, which quietly broke the one
  // thing this field promises: that it defaults to Today.
  const today = useLocalToday();

  /*
    Null means "follow Today". A string is a date the person deliberately
    picked, and midnight must not take that away from them — someone
    backfilling last Tuesday at 23:59 should still be on last Tuesday at
    00:01.
  */
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;

  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /*
    What has been typed, if anything. Deliberately NOT keyed by date: the date
    can change underneath it at midnight, and a half-entered measurement should
    survive that. Changing the date by hand is a different matter and clears it
    explicitly below.
  */
  const [draft, setDraft] = useState<string | null>(null);

  // Editing an existing date means correcting it, so the field shows what is
  // stored until something is typed over it.
  const existing = points.find((point) => point.date === date) ?? null;
  const weight = draft ?? (existing ? formatWeight(existing.tenths) : "");

  /** Changing the date by hand is a different measurement, so its state resets. */
  function chooseDate(next: string) {
    setPicked(next);
    setDraft(null);
    setProblem(null);
    setConfirmingDelete(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(weight.trim());

    // The same rule the server applies, so the form cannot offer to save
    // something that will be refused.
    const tenths = weight.trim() === "" ? null : toWeightTenths(parsed);
    if (tenths === null) {
      setProblem(
        "Enter a weight in kilograms, to at most one decimal place — for example 78.4.",
      );
      return;
    }
    // Checked against the CURRENT local Today, not the one this page was
    // opened on. A stale mount value would call a perfectly valid new-day
    // measurement a future one.
    if (date > today) {
      setProblem("That date is in the future.");
      return;
    }

    setProblem(null);
    onSave(date, tenths / 10);
  }

  const saving = write.status === "saving";

  return (
    /*
      noValidate on purpose. `step="0.1"` is kept because it makes the spinner
      move in tenths, but native constraint validation treats 78.45 as a step
      mismatch and blocks submission with a browser message that offers to
      round to 78.4 or 78.5 — which is the one thing this feature refuses to do
      quietly. Turning it off lets the check below run and say plainly that the
      value cannot be stored, identically in every browser.
    */
    <form
      onSubmit={submit}
      noValidate
      className="mt-5 border-t border-line pt-4"
      data-weight-form
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-40">
          <label
            htmlFor="weight-date"
            className="block text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3"
          >
            Date
          </label>
          <input
            id="weight-date"
            type="date"
            value={date}
            max={today}
            onChange={(event) => chooseDate(event.target.value)}
            className="mt-1 w-full rounded-control border border-line-strong bg-surface-soft px-3 py-2 text-[14px] font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          />
        </div>

        <div className="min-w-0 flex-1 basis-32">
          <label
            htmlFor="weight-value"
            className="block text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3"
          >
            Weight (kg)
          </label>
          <input
            id="weight-value"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0.1"
            max="1000"
            value={weight}
            placeholder={latest ? formatWeight(latest.tenths) : "78.4"}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby={problem ? "weight-problem" : undefined}
            aria-invalid={problem !== null}
            className="mt-1 w-full rounded-control border border-line-strong bg-surface-soft px-3 py-2 text-[14px] font-semibold tabular-nums text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-control bg-accent px-4 py-2 text-[13px] font-bold text-ink-inverse transition-opacity duration-fast hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          {saving ? "Saving…" : existing ? "Update" : "Add measurement"}
        </button>
      </div>

      {problem && (
        <p id="weight-problem" role="alert" className="mt-2 text-[12px] font-semibold text-danger-ink">
          {problem}
        </p>
      )}

      {write.status === "failed" && (
        <p role="alert" className="mt-2 text-[12px] font-semibold text-danger-ink">
          {write.message}
        </p>
      )}

      {write.status === "saved" && !problem && (
        <p role="status" className="mt-2 text-[12px] font-semibold text-success-ink">
          Saved {formatLocalDate(write.date)}.
        </p>
      )}

      {existing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {confirmingDelete ? (
            <>
              <p className="text-[12px] font-semibold text-ink-2">
                {/* Names exactly what will go, so it cannot be a surprise. */}
                Delete the {formatWeight(existing.tenths)} kg measurement on{" "}
                {formatLocalDate(existing.date)}?
              </p>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  // The typed value went with the measurement.
                  setDraft(null);
                  onDelete(existing.date);
                }}
                className="inline-flex items-center gap-1.5 rounded-control border border-danger-ink px-3 py-1.5 text-[12px] font-bold text-danger-ink transition-colors duration-fast hover:bg-danger-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete it
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-control px-3 py-1.5 text-[12px] font-bold text-ink-2 transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-control border border-line-strong px-3 py-1.5 text-[12px] font-bold text-ink-2 transition-colors duration-fast hover:text-danger-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Delete this measurement
            </button>
          )}
        </div>
      )}
    </form>
  );
}
