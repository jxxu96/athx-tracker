import type { Macros } from "./domain.ts";

// Whole-gram rounding can move the 4/4/9 total by up to 8.5 kcal.
export const CALORIE_TOLERANCE = 10;

export function macroCalories(macros: Pick<Macros, "protein" | "carbs" | "fat">) {
  const protein = macros.protein * 4;
  const carbs = macros.carbs * 4;
  const fat = macros.fat * 9;
  return { protein, carbs, fat, total: protein + carbs + fat };
}

export function mealCalorieError(macros: Macros) {
  const total = macroCalories(macros).total;
  return Math.abs(macros.calories - total) > CALORIE_TOLERANCE
    ? `Calories must be within ${CALORIE_TOLERANCE} kcal of the macro total (${Math.round(total)} kcal). Adjust the macros or use the macro total.`
    : "";
}

/** Round the displayed grams first, then derive calories from those same grams. */
export function reconcileEstimate<T extends Macros>(estimate: T): T {
  const rounded = {
    ...estimate,
    protein: Math.round(estimate.protein),
    carbs: Math.round(estimate.carbs),
    fat: Math.round(estimate.fat),
  };
  return { ...rounded, calories: macroCalories(rounded).total };
}
