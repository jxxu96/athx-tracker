import { addDays } from "./client.ts";
import type { Macros, PastTargets, Settings } from "./domain.ts";

/**
 * A change a week for two years, and small enough that settings stay well
 * inside the size of one request.
 */
export const TARGET_HISTORY_LIMIT = 100;

type Person = "hippos" | "gators";

const KEYS = ["calories", "protein", "carbs", "fat"] as const;

/**
 * The daily targets a day is judged against: the ones in force on it. A day
 * before any change, or settings from before targets were dated, take the
 * targets there are.
 */
export function targetsOn(
  settings: Pick<Settings, "targets" | "targetHistory">,
  athlete: Person,
  day: string,
): Macros {
  for (const past of settings.targetHistory?.[athlete] ?? []) {
    if (day <= past.until) return past.macros;
  }
  return settings.targets[athlete];
}

/**
 * The history once the targets change today. What they replace was the
 * target up to yesterday. Changed twice in one day, the first change never
 * had a day of its own, so there is nothing more to keep.
 */
export function recordTargetChange(
  history: readonly PastTargets[],
  previous: Macros,
  next: Macros,
  today: string,
): PastTargets[] {
  if (KEYS.every((key) => previous[key] === next[key])) return [...history];
  const yesterday = addDays(today, -1);
  const last = history.at(-1);
  if (last && last.until >= yesterday) return [...history];
  return [...history, { until: yesterday, macros: { ...previous } }].slice(
    -TARGET_HISTORY_LIMIT,
  );
}

/**
 * The average daily target across some days, for a span shown as a daily
 * average. With no days, the targets in force today.
 */
export function averageTargets(
  settings: Pick<Settings, "targets" | "targetHistory">,
  athlete: Person,
  days: readonly string[],
): Macros {
  if (days.length === 0) return { ...settings.targets[athlete] };
  const total: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const day of days) {
    const targets = targetsOn(settings, athlete, day);
    for (const key of KEYS) total[key] += targets[key];
  }
  for (const key of KEYS) total[key] /= days.length;
  return total;
}
