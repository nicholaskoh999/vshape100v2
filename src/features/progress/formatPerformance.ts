import type { WorkoutLoadMode, WorkoutResultKind } from "@shared/workoutLog";

import type { PerformancePoint, PerformanceVariant } from "./progressApi";

/**
 * Rendering a recorded performance, without changing what it means.
 *
 * `kg_each` is PER DUMBBELL and is written that way. 10 kg each is two 10 kg
 * dumbbells; it is never presented as 20 kg, because that is a different
 * measurement and would silently outrank a genuine 15 kg single-implement set
 * anywhere the two appeared side by side.
 *
 * Per-side is likewise kept visible: 10 reps per side is not 20 reps.
 */

export type VariantKind = Pick<PerformanceVariant, "resultKind" | "loadMode" | "perSide">;

/** `50`, `47.5` — trailing zeroes trimmed, no unit. */
function formatLoadNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** `50 kg`, `20 kg each`, or null when the variant carries no load. */
export function formatLoad(loadValue: number | null, loadMode: WorkoutLoadMode): string | null {
  if (loadMode === "none" || loadValue === null) return null;
  // "each" is part of the value, not a decoration on it.
  return `${formatLoadNumber(loadValue)} kg${loadMode === "kg_each" ? " each" : ""}`;
}

/** `8 reps`, `8 reps / side`, `60s`. */
export function formatResult(
  result: number,
  resultKind: WorkoutResultKind,
  perSide: boolean,
): string {
  const base = resultKind === "seconds" ? `${result}s` : `${result} ${result === 1 ? "rep" : "reps"}`;
  return perSide ? `${base} / side` : base;
}

/** The whole performance: `50 kg × 8 reps`, or `60s` when unloaded. */
export function formatPerformance(point: PerformancePoint, kind: VariantKind): string {
  const load = formatLoad(point.loadValue, kind.loadMode);
  const result = formatResult(point.result, kind.resultKind, kind.perSide);
  return load ? `${load} × ${result}` : result;
}

/**
 * How a variant is named when one exercise has several measurement systems.
 *
 * Returns null when there is nothing to disambiguate, so the common case reads
 * as just the exercise name.
 */
export function variantQualifier(kind: VariantKind): string | null {
  const parts: string[] = [];
  if (kind.loadMode === "kg_each") parts.push("per dumbbell");
  if (kind.perSide) parts.push("per side");
  if (kind.resultKind === "seconds") parts.push("timed");
  return parts.length === 0 ? null : parts.join(" · ");
}

/** The column heading for this variant's values in an accessible table. */
export function valueHeading(kind: VariantKind): string {
  if (kind.resultKind === "seconds") return "Hold";
  return kind.loadMode === "none" ? "Reps" : "Best set";
}
