import type { WorkoutResultKind } from "@shared/workoutLog";

import type { PerformancePoint, PerformanceVariant } from "./progressApi";

/**
 * Rendering a recorded performance, without changing what it means.
 *
 * THE ROUND 20 DEFECT THIS FILE CARRIED.
 *
 * `formatLoad` used to append " kg" to whatever number it was given, because
 * kilograms were the only thing the app could store. A Triceps Pushdown done
 * with three black bands had that 3 written into the weight column, and this
 * function faithfully rendered it as "3 kg × 12 reps" — a sentence about the
 * user's training that was simply false. The unit is now read from the
 * variant's own modality, so nothing here can invent one.
 *
 * `kg_each` is PER DUMBBELL and is written that way. 10 kg each is two 10 kg
 * dumbbells; it is never presented as 20 kg, because that is a different
 * measurement and would silently outrank a genuine 15 kg single-implement set
 * anywhere the two appeared side by side.
 *
 * Per-side is likewise kept visible: 10 reps per side is not 20 reps.
 *
 * BANDS ARE NAMED, NEVER SCORED. A band renders as its label and how many were
 * used. There is no kilogram equivalent shown, offered or implied, and no band
 * is ever described as heavier than another.
 */

export type VariantKind = Pick<
  PerformanceVariant,
  "resultKind" | "loadMode" | "perSide" | "inputType" | "band"
>;

/** `50`, `47.5` — trailing zeroes trimmed, no unit. */
function formatLoadNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/**
 * The resistance, written in its own terms: `50 kg`, `20 kg each`, `Black ×3`,
 * or null when the variant carries no external resistance at all.
 *
 * The kilogram branch is reachable ONLY for a weight_kg variant. That is the
 * whole point of taking the kind rather than a bare load mode.
 */
export function formatLoad(loadValue: number | null, kind: VariantKind): string | null {
  if (kind.inputType === "resistance_band") {
    if (!kind.band) return null;
    // The multiplication sign belongs to the COUNT of bands, and the label is
    // reproduced as the user typed it. Nothing is converted.
    return `${kind.band.label} ×${kind.band.count}`;
  }
  if (kind.inputType !== "weight_kg") return null;
  if (kind.loadMode === "none" || loadValue === null) return null;
  // "each" is part of the value, not a decoration on it.
  return `${formatLoadNumber(loadValue)} kg${kind.loadMode === "kg_each" ? " each" : ""}`;
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

/**
 * The whole performance: `50 kg × 8 reps`, `Black ×3 · 12 reps`, or `60s`.
 *
 * Band work uses a middot rather than a second multiplication sign, because the
 * `x3` already belongs to the bands and `Black ×3 × 12 reps` would read as
 * arithmetic that nobody performed.
 */
export function formatPerformance(point: PerformancePoint, kind: VariantKind): string {
  const load = formatLoad(point.loadValue, kind);
  const result = formatResult(point.result, kind.resultKind, kind.perSide);
  if (!load) return result;
  return kind.inputType === "resistance_band"
    ? `${load} · ${result}`
    : `${load} × ${result}`;
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
  // The band setup is the most notable thing a band variant has, and two
  // setups of one exercise must never read as the same choice.
  if (kind.band) parts.push(`${kind.band.label} ×${kind.band.count}`);
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
  const load = kind.band
    ? `${kind.band.label} ×${kind.band.count}`
    : kind.loadMode === "kg_each"
      ? "kg each"
      : kind.loadMode === "kg"
        ? "kg"
        : "no load";
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
  // Band work ranks on reps within one fixed setup, so "Reps" is what the
  // column actually holds — calling it a best set would imply a load axis
  // that does not exist here.
  if (kind.inputType === "resistance_band") return "Reps";
  return kind.loadMode === "none" ? "Reps" : "Best set";
}
