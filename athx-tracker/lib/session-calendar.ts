import { addDays, isWorkout, weekStart } from "./client.ts";
import type { Athlete, RecordItem, Workout } from "./domain.ts";

/** "YYYY-MM", the month a day falls in. */
export type Month = string;

export const monthOf = (day: string): Month => day.slice(0, 7);

/** The seven days ending on `end`, oldest first, so the strip reads up to it. */
export function stripDays(end: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(end, index - 6));
}

/** A month's first and last days. */
export function monthRange(month: Month) {
  const start = `${month}-01`;
  return { start, end: addDays(addDays(start, 32).slice(0, 7) + "-01", -1) };
}

export function shiftMonth(month: Month, delta: number): Month {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * A month as weeks, Monday first like every week here. A day outside the month
 * is null, so the grid keeps its columns without showing a neighbour's days.
 */
export function monthWeeks(month: Month) {
  const { start, end } = monthRange(month);
  const weeks: (string | null)[][] = [];
  for (let monday = weekStart(start); monday <= end; monday = addDays(monday, 7))
    weeks.push(
      Array.from({ length: 7 }, (_, index) => {
        const day = addDays(monday, index);
        return day >= start && day <= end ? day : null;
      }),
    );
  return weeks;
}

/** A day's dots read in the same order every day: Hippos, Gators, then Together. */
const ORDER: Record<Athlete, number> = { hippos: 0, gators: 1, team: 2 };

/**
 * The sessions from start to end, both included, by day. Days keep the order
 * the records arrive in, which is the Log's: newest day first and, inside a
 * day, the later time first.
 */
export function sessionsByDay(records: readonly RecordItem[], start: string, end: string) {
  const days = new Map<string, Workout[]>();
  for (const record of records) {
    if (!isWorkout(record) || record.day < start || record.day > end) continue;
    const list = days.get(record.day);
    if (list) list.push(record);
    else days.set(record.day, [record]);
  }
  return days;
}

/** Who trained on a day, one entry per session, in the dots' order. */
export function dayAthletes(sessions: readonly Workout[]) {
  return sessions.map((session) => session.athlete).sort((a, b) => ORDER[a] - ORDER[b]);
}

/** Sessions over a range, and how many of its days had any. */
export function rangeCounts(days: ReadonlyMap<string, readonly Workout[]>) {
  let total = 0;
  for (const sessions of days.values()) total += sessions.length;
  return { total, days: days.size };
}

/**
 * The oldest day the phone's slice of the journal reaches. The server sends
 * the newest entries whole down to a cut, and the cut can fall partway through
 * a day, so every day after this one is all there and this one may not be.
 * Weigh-ins are always sent, so they say nothing about where the cut fell.
 * Null when the slice is the whole journal.
 */
export function heldFrom(slice: readonly RecordItem[], complete: boolean) {
  if (complete) return null;
  let oldest = "9999-12-31";
  for (const record of slice)
    if (record.kind !== "bodyweight" && record.day < oldest) oldest = record.day;
  return oldest;
}

/** Whether a range reaches back past what the phone holds whole. */
export const needsFetch = (held: string | null, start: string) => held !== null && start <= held;
