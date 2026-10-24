import type { Macros } from "./domain.ts";

// Whole-gram rounding can move the 4/4/9 total by up to 8.5 kcal.
export const CALORIE_TOLERANCE = 10;

/** Ethanol is 7 kcal/g. Callers pass it only for an Alcohol sitting. */
export function macroCalories(
  macros: Pick<Macros, "protein" | "carbs" | "fat"> & { alcohol?: number },
) {
  const protein = macros.protein * 4;
  const carbs = macros.carbs * 4;
  const fat = macros.fat * 9;
  const alcohol = (macros.alcohol ?? 0) * 7;
  return { protein, carbs, fat, alcohol, total: protein + carbs + fat + alcohol };
}

export function mealCalorieError(macros: Macros & { alcohol?: number }) {
  const total = macroCalories(macros).total;
  return Math.abs(macros.calories - total) > CALORIE_TOLERANCE
    ? `Calories must be within ${CALORIE_TOLERANCE} kcal of the macro total (${Math.round(total)} kcal). Adjust the macros or use the macro total.`
    : "";
}

/** Round the displayed grams first, then derive calories from those same grams. */
export function reconcileEstimate<T extends Macros & { alcohol?: number }>(estimate: T): T {
  const rounded = {
    ...estimate,
    protein: Math.round(estimate.protein),
    carbs: Math.round(estimate.carbs),
    fat: Math.round(estimate.fat),
    ...(estimate.alcohol !== undefined ? { alcohol: Math.round(estimate.alcohol) } : {}),
  };
  return { ...rounded, calories: macroCalories(rounded).total };
}
