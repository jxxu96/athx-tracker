import type { Estimator, Macros, Meal } from "./domain";

/*
 * The two decisions the queue worker makes, kept where a test can reach them.
 * queue.ts itself pulls in the database and, through it, next/headers, so
 * nothing in it could be run outside a Next build.
 */

export const RETRY_MIN_MS = 2 * 60 * 1000;
export const RETRY_MAX_MS = 30 * 60 * 1000;

export type DrainOutcome = { filled: number; waiting: number } | "failed";

/**
 * How long to wait before trying the queue again. Backing off only while there
 * is work that is not getting done: nothing queued is not a failure, and one
 * success means the estimator is answering, so an outage that ends does not
 * leave a long wait behind it.
 */
export function nextRetryDelay(current: number, outcome: DrainOutcome) {
  const slower = Math.min(RETRY_MAX_MS, current * 2);
  if (outcome === "failed") return slower;
  return outcome.waiting > 0 && outcome.filled === 0 ? slower : RETRY_MIN_MS;
}

/**
 * A queued meal once its estimate arrives. The description was parked in
 * assumptions and the name may be one you typed, which the estimate does not
 * get to overwrite.
 */
export function fillQueuedMeal(
  meal: Meal,
  estimate: Macros & {
    alcohol?: number; fiber?: number; name: string; assumptions: string; estimator?: Estimator;
  },
): Meal {
  return {
    ...meal,
    name: meal.name.trim() || estimate.name,
    meal: (estimate.alcohol ?? 0) > 0 ? "Alcohol" : meal.meal,
    macros: {
      calories: estimate.calories,
      protein: estimate.protein,
      carbs: estimate.carbs,
      fat: estimate.fat,
      ...(estimate.alcohol !== undefined ? { alcohol: estimate.alcohol } : {}),
      ...(estimate.fiber !== undefined ? { fiber: estimate.fiber } : {}),
    },
    assumptions: estimate.assumptions,
    source: "grok",
    ...(estimate.estimator ? { estimator: estimate.estimator } : {}),
  };
}

/**
 * Queued meals that share a description, oldest first. A meal logged for both
 * athletes is two records with one description, and estimating each on its
 * own asked the estimators twice and could give the two of them different
 * figures for the same plate. One estimate per description fills them all.
 */
export function byDescription(meals: Meal[]): Meal[][] {
  const groups = new Map<string, Meal[]>();
  for (const meal of meals) {
    const key = meal.assumptions.trim();
    groups.set(key, [...(groups.get(key) ?? []), meal]);
  }
  return [...groups.values()];
}
