import { addDays } from "./client.ts";
import type { FuelDateRange } from "./fuel.ts";
import { monthOf, monthRange, shiftMonth } from "./session-calendar.ts";

/** Shortcuts that fill in a custom window's start and end. */
export const FUEL_PRESETS = [
  { id: "mtd", label: "MTD", name: "Month to date" },
  { id: "1m", label: "1M", name: "Past month" },
  { id: "1q", label: "1Q", name: "Past 3 months" },
  { id: "6m", label: "6M", name: "Past 6 months" },
  { id: "ytd", label: "YTD", name: "Year to date" },
  { id: "1y", label: "1Y", name: "Past year" },
] as const;

export type FuelPreset = (typeof FUEL_PRESETS)[number]["id"];

const MONTHS_BACK = { "1m": 1, "1q": 3, "6m": 6, "1y": 12 } as const;

/**
 * The same date `delta` months away, or that month's last day when it has no
 * such date: a month before 31 March is 28 or 29 February.
 */
export function addMonths(day: string, delta: number) {
  const month = shiftMonth(monthOf(day), delta);
  const { end } = monthRange(month);
  const date = `${month}-${day.slice(8, 10)}`;
  return date > end ? end : date;
}

/**
 * A preset's dates, both ends included. Like the last 7 days and Overall, they
 * end yesterday, so a day still being eaten does not pull the average down.
 * A rolling one starts the same date that many months back, as the last 7
 * days start the same weekday a week back. Null when there is no complete day
 * yet: month to date on the 1st, year to date on 1 January.
 */
export function fuelPresetWindow(preset: FuelPreset, today: string): FuelDateRange | null {
  const end = addDays(today, -1);
  const start =
    preset === "mtd" ? `${monthOf(today)}-01`
    : preset === "ytd" ? `${today.slice(0, 4)}-01-01`
    : addMonths(today, -MONTHS_BACK[preset]);
  return start > end ? null : { start, end };
}
