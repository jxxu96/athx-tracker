import { addDays, dayToDate, isMeal, weekStart } from "./client.ts";
import { sumMacros, type RecordItem, type Settings } from "./domain.ts";
import { targetGap } from "./fuel.ts";
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
 * Whether last week's protein fell short of the daily targets in force then.
 * The week is all seven days. A day with no meal counts as nothing eaten.
 * Queued meals are still waiting on their macros, so they stay out. Within 5%
 * counts as met, the same band as a single day. No protein target means there
 * was nothing to miss.
 */
export function missedProteinLastWeek(
  records: readonly RecordItem[],
  settings: Pick<Settings, "targets" | "targetHistory">,
  athlete: ProteinAthlete,
  today: string,
) {
  const week = previousWeek(today);
  let target = 0;
  for (let i = 0; i < 7; i += 1) {
    target += targetsOn(settings, athlete, addDays(week.start, i)).protein;
  }
  if (!(target > 0)) return false;
  const meals = records.filter(isMeal).filter(
    (meal) =>
      meal.athlete === athlete &&
      meal.source !== "queued" &&
      meal.day >= week.start &&
      meal.day <= week.end,
  );
  return targetGap(sumMacros(meals).protein, target)?.state === "under";
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
