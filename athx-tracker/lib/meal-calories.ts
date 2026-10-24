import type { Macros } from "./domain.ts";

/**
 * Rough comparison only. Carbs are total carbohydrate, and fiber is a subset
 * of them: fiber is 2 kcal/g and the rest of the carbs are 4. Sugar alcohols
 * stay inside the carb grams and are not priced on their own. Saved calories
 * are not changed here.
 */
export function macroCalories(
  macros: Pick<Macros, "protein" | "carbs" | "fat"> & { alcohol?: number; fiber?: number },
) {
  const protein = macros.protein * 4;
  const fiberGrams = Math.min(Math.max(macros.fiber ?? 0, 0), Math.max(macros.carbs, 0));
  const carbs = (macros.carbs - fiberGrams) * 4;
  const fiber = fiberGrams * 2;
  const fat = macros.fat * 9;
  const alcohol = (macros.alcohol ?? 0) * 7;
  return { protein, carbs, fiber, fat, alcohol, total: protein + carbs + fiber + fat + alcohol };
}
