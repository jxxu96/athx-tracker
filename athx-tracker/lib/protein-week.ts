import { addDays, dayToDate, isMeal, weekStart } from "./client.ts";
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
