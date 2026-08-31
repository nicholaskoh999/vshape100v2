import { useId } from "react";

import { toDayIndex } from "@shared/localDate";

import { formatShortDate } from "./formatDate";

/**
 * A small, dependency-free trend chart.
 *
 * ## Only real measurements are points
 *
 * Every dot is something that was recorded. Nothing is interpolated, carried
 * forward, or filled in for a day with no measurement. The connecting line is
 * a reading aid between two real points and is drawn as such — it never adds a
 * point, and the accessible table below lists exactly the points that exist.
 *
 * ## Position carries the gaps
 *
 * The horizontal axis is proportional to the CALENDAR, not to the index of the
 * measurement. Two measurements three months apart must not look like two
 * measurements on consecutive days, which is what evenly spacing them by index
 * would imply. Points that share a date are nudged apart within that day so
 * they cannot land on top of one another.
 *
 * ## The picture is never the only copy
 *
 * The SVG is `aria-hidden`, and the same numbers are available as a real table
 * behind a keyboard-operable disclosure. Nothing is conveyed by colour alone:
 * every value that matters is also written out.
 */

export type TrendPoint = {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  value: number;
  /** Distinguishes two points that share a date, e.g. a session id. */
  id?: string;
  /** What the table shows for this point, e.g. `50 kg × 8`. */
  display: string;
};

const WIDTH = 320;
const HEIGHT = 120;
const PAD_X = 6;
const PAD_Y = 10;

/** Horizontal position of each point, in calendar terms. */
function positions(points: readonly TrendPoint[]): number[] {
  const days = points.map((point) => toDayIndex(point.date) ?? 0);

  // Two points on one date share a day index, which would put them at the same
  // x. Spread them across a fraction of that day so both remain visible.
  const seen = new Map<number, number>();
  const counts = new Map<number, number>();
  for (const day of days) counts.set(day, (counts.get(day) ?? 0) + 1);

  return days.map((day) => {
    const total = counts.get(day) ?? 1;
    const index = seen.get(day) ?? 0;
    seen.set(day, index + 1);
    return total === 1 ? day : day + index / total;
  });
}

function scale(values: readonly number[], size: number, pad: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  return (value: number) => {
    // A flat series has no span to divide by. Every point sits on the centre
    // line, which is the truth: nothing changed.
    if (span === 0) return size / 2;
    return pad + ((value - min) / span) * (size - pad * 2);
  };
}

export function TrendChart({
  points,
  label,
  unitLabel,
  plots,
}: {
  points: readonly TrendPoint[];
  /** What the chart is of, e.g. "Body weight". Used for the accessible name. */
  label: string;
  /** Column heading for the value, e.g. "Weight". */
  unitLabel: string;
  /**
   * What the LINE encodes, when that is only part of each point.
   *
   * A loaded set is a load and a rep count, and a line can only carry one of
   * them. Plotting load means 50 kg x 8 followed by 50 kg x 10 draws flat even
   * though the second set was better, so the chart has to say which half it is
   * drawing instead of letting the shape imply it was the whole thing.
   */
  plots?: string;
}) {
  const tableId = useId();

  // A single point is a fact; a trend through it is not. It is drawn as one
  // dot with no line, and the caller says why there is no trend yet.
  if (points.length === 0) return null;

  const xs = positions(points);
  const ys = points.map((point) => point.value);
  const toX = scale(xs, WIDTH, PAD_X);
  const toY = scale(ys, HEIGHT, PAD_Y);

  const coordinates = points.map((point, index) => ({
    point,
    x: points.length === 1 ? WIDTH / 2 : toX(xs[index]),
    // SVG y grows downward, so a larger value has to sit higher up.
    y: HEIGHT - toY(point.value),
  }));

  const path = coordinates
    .map((spot, index) => `${index === 0 ? "M" : "L"} ${spot.x.toFixed(2)} ${spot.y.toFixed(2)}`)
    .join(" ");

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <figure className="m-0">
      {/*
        min-w-0 plus a block-level, width-constrained SVG is what keeps this
        from forcing a horizontal scrollbar inside a narrow card.
      */}
      <div className="min-w-0">
        <svg
          data-trend-chart
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-28 w-full max-w-full sm:h-32"
          // The numbers live in the table below; the drawing is decoration.
          aria-hidden="true"
          focusable="false"
          role="presentation"
        >
          {points.length > 1 && (
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              // Keeps the stroke 2px however the viewBox is scaled.
              vectorEffect="non-scaling-stroke"
              className="text-blue"
            />
          )}
          {coordinates.map((spot) => (
            <circle
              key={`${spot.point.date}:${spot.point.id ?? ""}`}
              cx={spot.x}
              cy={spot.y}
              r={3.5}
              className="fill-blue"
            />
          ))}
        </svg>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] font-semibold tabular-nums text-ink-faint">
        <span>{formatShortDate(first.date)}</span>
        {points.length > 1 && <span>{formatShortDate(last.date)}</span>}
      </div>

      {plots && (
        <p className="mt-1 text-[12px] font-semibold text-ink-faint">{plots}</p>
      )}

      <figcaption className="sr-only">
        {label}: {points.length} recorded {points.length === 1 ? "point" : "points"} between{" "}
        {formatShortDate(first.date)} and {formatShortDate(last.date)}. Full values in the table
        below.
      </figcaption>

      <details className="mt-2 group">
        <summary className="cursor-pointer list-none rounded-control px-2 py-1 text-[12px] font-bold text-ink-dim outline-none transition-colors duration-150 hover:text-offwhite focus-visible:ring-2 focus-visible:ring-blue">
          <span aria-hidden="true" className="mr-1 inline-block group-open:hidden">
            +
          </span>
          <span aria-hidden="true" className="mr-1 hidden group-open:inline-block">
            −
          </span>
          Show the {points.length} recorded {points.length === 1 ? "value" : "values"}
        </summary>

        {/*
          Wide content scrolls inside its own box rather than pushing the page
          sideways on a narrow screen.
        */}
        <div className="mt-2 max-h-56 overflow-auto rounded-control border border-edge">
          <table id={tableId} className="w-full border-collapse text-left text-[12px]">
            <caption className="sr-only">{label}, every recorded measurement</caption>
            <thead className="sticky top-0 bg-surface-overlay">
              <tr>
                <th scope="col" className="px-3 py-2 font-bold text-ink-faint">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 font-bold text-ink-faint">
                  {unitLabel}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {points.map((point) => (
                <tr key={`${point.date}:${point.id ?? ""}`}>
                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink-dim"
                  >
                    {formatShortDate(point.date)}
                  </th>
                  <td className="px-3 py-1.5 font-bold tabular-nums text-offwhite">
                    {point.display}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
