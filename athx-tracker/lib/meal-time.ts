import type { Meal } from "./domain.ts";

export type MealSitting = Meal["meal"];

/**
 * Sitting that matches a local clock. Hours are the device's, same as localDay.
 * 5–10 Breakfast, 11–14 Lunch, 15–16 Snack, 17–21 Dinner, and overnight is Snack.
 */
export function mealForTime(date: Date): MealSitting {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "Breakfast";
  if (hour >= 11 && hour < 15) return "Lunch";
  if (hour >= 17 && hour < 22) return "Dinner";
  return "Snack";
}
