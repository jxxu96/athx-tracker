import { addDays, dayToDate, daysBetween, isMeal, weekStart } from "./client.ts";
import { sumMacros, type RecordItem, type Settings } from "./domain.ts";
import { targetsOn } from "./targets.ts";

export type ProteinAthlete = "hippos" | "gators";

/** The Monday–Sunday before the week that contains `today`. */
export function previousWeek(today: string) {
  const start = addDays(weekStart(today), -7);
  return { start, end: addDays(start, 6) };
}

/** Monday, Tuesday, and Wednesday. Thursday the bagel comes off. */
export function isBagelWeekday(day: string) {
  const weekday = dayToDate(day).getUTCDay();
  return weekday >= 1 && weekday <= 3;
}

/**
 * Whether last week's protein fell short of 90% of the goal.
 * Only days with a known meal count. A blank day is left out, so it counts as
 * met. Queued meals are still waiting on their macros, so they stay out and do
 * not mark the day as logged. No protein target on the logged days means there
 * was nothing to miss.
 */
export function missedProteinLastWeek(
  records: readonly RecordItem[],
  settings: Pick<Settings, "targets" | "targetHistory">,
  athlete: ProteinAthlete,
  today: string,
) {
  const week = previousWeek(today);
  const meals = records.filter(isMeal).filter(
    (meal) =>
      meal.athlete === athlete &&
      meal.source !== "queued" &&
      meal.day >= week.start &&
      meal.day <= week.end,
  );
  const logged = new Set(meals.map((meal) => meal.day));
  let target = 0;
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(week.start, i);
    if (!logged.has(day)) continue;
    target += targetsOn(settings, athlete, day).protein;
  }
  if (!(target > 0)) return false;
  // 90% exactly counts as met. Compare in tenths so 0.9 does not round a hit down.
  return sumMacros(meals).protein * 10 < target * 9;
}

/** The bagel rides Mon–Wed after a missed protein week, and only then. */
export function wearsProteinBagel(
  records: readonly RecordItem[],
  settings: Pick<Settings, "targets" | "targetHistory">,
  athlete: ProteinAthlete,
  today: string,
) {
  return isBagelWeekday(today) && missedProteinLastWeek(records, settings, athlete, today);
}

/** Weeks of protein the trend shows, the current one last, like the lift volume. */
export const PROTEIN_WEEKS = 8;

export type ProteinWeek = {
  /** The Monday it starts. */
  start: string;
  /** Grams eaten on its days with a known meal. */
  eaten: number;
  /** Those days' protein targets added together. Zero is nothing to measure. */
  target: number;
  /** How many days counted. */
  days: number;
};

/**
 * Protein against the target for each of the last eight Monday weeks, oldest
 * first, measured the way the bagel measures last week: only days with a
 * known meal count, each against the target it had, so a blank day is left
 * out rather than read as a day of none. Today is not over, so it waits, as
 * Fuel's averages do; on a Monday the current week has nothing in it yet.
 */
export function proteinWeeks(
  records: readonly RecordItem[],
  settings: Pick<Settings, "targets" | "targetHistory">,
  athlete: ProteinAthlete,
  today: string,
): ProteinWeek[] {
  const first = addDays(weekStart(today), -7 * (PROTEIN_WEEKS - 1));
  const last = addDays(today, -1);
  const weeks: ProteinWeek[] = Array.from({ length: PROTEIN_WEEKS }, (_, index) => ({
    start: addDays(first, 7 * index), eaten: 0, target: 0, days: 0,
  }));
  const eaten = new Map<string, number>();
  for (const meal of records.filter(isMeal)) {
    if (meal.athlete !== athlete || meal.source === "queued" || meal.day < first || meal.day > last) continue;
    eaten.set(meal.day, (eaten.get(meal.day) ?? 0) + meal.macros.protein);
  }
  for (const [day, grams] of eaten) {
    const week = weeks[Math.floor(daysBetween(first, day) / 7)];
    week.eaten += grams;
    week.target += targetsOn(settings, athlete, day).protein;
    week.days += 1;
  }
  return weeks;
}
