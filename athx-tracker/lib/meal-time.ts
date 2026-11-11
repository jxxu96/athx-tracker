import type { EnergyTiming, Meal } from "./domain.ts";

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

/**
 * The energy timing that matches a local clock: a meal's sitting at that
 * hour. Energy has no snack, so a snack's hours go to a sitting of the same
 * day: the afternoon to lunch and the late evening to dinner, the ones they
 * follow, and before dawn to breakfast, since nothing else has happened yet.
 */
export function energyTimingForTime(date: Date): EnergyTiming {
  const sitting = mealForTime(date);
  if (sitting === "Breakfast" || sitting === "Lunch" || sitting === "Dinner") return sitting;
  const hour = date.getHours();
  return hour < 11 ? "Breakfast" : hour < 17 ? "Lunch" : "Dinner";
}
