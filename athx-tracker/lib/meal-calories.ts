import type { Macros } from "./domain.ts";

/** A rough comparison only: total carbs include fiber and sugar alcohols. */
export function macroCalories(
  macros: Pick<Macros, "protein" | "carbs" | "fat"> & { alcohol?: number },
) {
  const protein = macros.protein * 4;
  const carbs = macros.carbs * 4;
  const fat = macros.fat * 9;
  const alcohol = (macros.alcohol ?? 0) * 7;
  return { protein, carbs, fat, alcohol, total: protein + carbs + fat + alcohol };
}
