import type { RecordItem } from "./domain";

/**
 * The most recent entries and every weigh-in, energy check-in and request
 * besides, from a journal already newest first. A session's burn needs the
 * weight in force on its day, which can be a weigh-in from long before
 * anything in the recent slice. The energy card and the weekly review compare
 * check-ins across weeks, and at one a day for each athlete they stay small.
 * Requests are the idea log on Today, which has to hold every one of them.
 * All three are few enough always to send.
 */
export function recentOf(records: readonly RecordItem[], limit: number) {
  const recent: RecordItem[] = [];
  let taken = 0;
  for (const record of records) {
    if (record.kind === "bodyweight" || record.kind === "energy" || record.kind === "request") recent.push(record);
    else if (taken < limit) {
      recent.push(record);
      taken += 1;
    }
  }
  return recent;
}
