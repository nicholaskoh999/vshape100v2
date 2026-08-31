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
 * The notable thing about a variant, when there is one.
 *
 * Returns null when nothing needs saying, so the common case reads as just the
 * exercise name. This is only safe when the exercise has ONE variant — see
 * `labelVariants`.
 */
export function variantQualifier(kind: VariantKind): string | null {
  const parts: string[] = [];
  if (kind.loadMode === "kg_each") parts.push("per dumbbell");
  if (kind.perSide) parts.push("per side");
  if (kind.resultKind === "seconds") parts.push("timed");
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * The FULL measurement system of a variant, always spelled out.
 *
 * Used when one exercise has more than one, where saying only the notable half
 * is not enough: a `kg` variant and a `none` variant of the same exercise both
 * have nothing "notable" about them, and would render as two identical
 * choices with different meanings behind them.
 */
export function variantDescriptor(kind: VariantKind): string {
  const load =
    kind.loadMode === "kg_each" ? "kg each" : kind.loadMode === "kg" ? "kg" : "no load";
  const result = kind.resultKind === "seconds" ? "timed" : "reps";
  const parts = [load, result];
  if (kind.perSide) parts.push("per side");
  return parts.join(" · ");
}

/**
 * Qualifiers for a whole list of variants, keyed by variant key.
 *
 * A variant key already separates measurement systems in the DATA. This makes
 * that separation visible: whenever one canonical exercise appears with more
 * than one variant, EVERY one of them is labelled with its full measurement
 * system, so no two options can read the same. An exercise with a single
 * variant keeps the quieter label, or none.
 */
export function labelVariants(
  variants: readonly (VariantKind & { key: string; exerciseId: string })[],
): Map<string, string | null> {
  const perExercise = new Map<string, number>();
  for (const variant of variants) {
    perExercise.set(variant.exerciseId, (perExercise.get(variant.exerciseId) ?? 0) + 1);
  }

  const labels = new Map<string, string | null>();
  for (const variant of variants) {
    const ambiguous = (perExercise.get(variant.exerciseId) ?? 0) > 1;
    labels.set(variant.key, ambiguous ? variantDescriptor(variant) : variantQualifier(variant));
  }
  return labels;
}

/** The column heading for this variant's values in an accessible table. */
export function valueHeading(kind: VariantKind): string {
  if (kind.resultKind === "seconds") return "Hold";
  return kind.loadMode === "none" ? "Reps" : "Best set";
}
