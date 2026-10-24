import type { Meal } from "./domain.ts";
import { daysBetween } from "./client.ts";

/** What one tap fills in. Taken from meals this person has repeated. */
export type CommonMeal = {
  name: string;
  meal: Meal["meal"];
  macros: Meal["macros"];
  assumptions: string;
  days: number;
};

const FILLER = new Set(["a", "an", "the", "and", "with", "of"]);

/**
 * Same dish written two ways ("Oats & eggs", "oats and eggs") shares a key.
 * Filler words drop out; numbers and the food words stay, so "shake" and
 * "shake 30g" remain different meals.
 */
export function mealKey(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !FILLER.has(word))
    .join(" ");
}

function copyMacros(macros: Meal["macros"]): Meal["macros"] {
  return {
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    ...(typeof macros.alcohol === "number" ? { alcohol: macros.alcohol } : {}),
    ...(typeof macros.fiber === "number" ? { fiber: macros.fiber } : {}),
  };
}

function logged(meal: Meal) {
  if (!meal.name.trim() || meal.source === "queued") return false;
  const { calories, protein, carbs, fat, alcohol = 0 } = meal.macros;
  return calories > 0 || protein > 0 || carbs > 0 || fat > 0 || alcohol > 0;
}

/**
 * Up to three meals this one person actually repeats.
 * Pass only that athlete's meals: Hippos and Gators are separate calls, so a
 * dish one of them lives on never shows up for the other.
 * A name has to land on two different days before it counts. One day, however
 * many times, is not a habit. Recent days weigh more, so last month's
 * breakfast outranks a dish from the spring. The button uses the latest
 * portions for the usual sitting, not an average.
 */
export function commonMeals(meals: Meal[], today: string, limit = 3): CommonMeal[] {
  const groups = new Map<string, Meal[]>();
  for (const meal of meals) {
    if (!logged(meal)) continue;
    const key = mealKey(meal.name);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(meal);
    else groups.set(key, [meal]);
  }

  const ranked: { score: number; lastDay: string; suggestion: CommonMeal }[] = [];
  for (const list of groups.values()) {
    // One entry per day. When several share a day, the first in the list wins,
    // which is the newest when the journal is in the order the app keeps.
    const byDay = new Map<string, Meal>();
    for (const meal of list) if (!byDay.has(meal.day)) byDay.set(meal.day, meal);
    if (byDay.size < 2) continue;

    const entries = [...byDay.values()];
    const newest = (a: Meal, b: Meal) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0);
    const latest = entries.sort(newest)[0];

    const sittings = new Map<Meal["meal"], { count: number; last: string }>();
    for (const meal of entries) {
      const row = sittings.get(meal.meal) ?? { count: 0, last: "" };
      row.count += 1;
      if (meal.day > row.last) row.last = meal.day;
      sittings.set(meal.meal, row);
    }
    let sitting = latest.meal;
    let bestCount = -1;
    let bestLast = "";
    for (const [meal, row] of sittings) {
      if (row.count > bestCount || (row.count === bestCount && row.last > bestLast)) {
        bestCount = row.count;
        bestLast = row.last;
        sitting = meal;
      }
    }
    const picked = entries
      .filter((meal) => meal.meal === sitting)
      .sort(newest)[0] ?? latest;

    let score = 0;
    for (const day of byDay.keys()) {
      const ago = daysBetween(day, today);
      const age = Number.isFinite(ago) && ago > 0 ? ago : 0;
      score += 0.5 ** (age / 21);
    }
    ranked.push({
      score,
      lastDay: picked.day,
      suggestion: {
        name: picked.name.trim(),
        meal: sitting,
        macros: copyMacros(picked.macros),
        assumptions: picked.assumptions,
        days: byDay.size,
      },
    });
  }

  ranked.sort((a, b) =>
    b.score - a.score ||
    (a.lastDay < b.lastDay ? 1 : a.lastDay > b.lastDay ? -1 : 0) ||
    a.suggestion.name.localeCompare(b.suggestion.name),
  );
  return ranked.slice(0, Math.max(0, limit)).map((row) => row.suggestion);
}
