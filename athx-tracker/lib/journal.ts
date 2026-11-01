import { database } from "./server";
import type { RecordItem, Settings } from "./domain";

/**
 * The most recent entries and every weigh-in besides, from a journal already
 * newest first. A session's burn needs the weight in force on its day, which
 * can be a weigh-in from long before anything in the recent slice, and
 * weigh-ins are few enough always to send.
 */
export function recentOf(records: readonly RecordItem[], limit: number) {
  const recent: RecordItem[] = [];
  let taken = 0;
  for (const record of records) {
    if (record.kind === "bodyweight") recent.push(record);
    else if (taken < limit) {
      recent.push(record);
      taken += 1;
    }
  }
  return recent;
}

/**
 * Entries, newest first: with a limit, the recent slice; without one,
 * everything, which is what the backup job asks for and must keep getting.
 */
export function readRecords(limit: number | null) {
  const rows = database()
    .prepare("SELECT payload FROM records ORDER BY day DESC, created_at DESC")
    .all() as { payload: string }[];
  const all = rows.map((row) => JSON.parse(row.payload) as RecordItem);
  return { records: limit ? recentOf(all, limit) : all, all, total: all.length };
}

export function readSettings() {
  const row = database()
    .prepare("SELECT payload, revision FROM settings WHERE id = 'team'")
    .get() as { payload: string; revision: number } | undefined;
  return row ? { settings: JSON.parse(row.payload) as Settings, revision: row.revision } : null;
}

/** A selected day's entries, including ones outside the phone's recent slice. */
export function readRecordsOn(day: string): RecordItem[] {
  const rows = database()
    .prepare("SELECT payload FROM records WHERE day = ? ORDER BY created_at DESC")
    .all(day) as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as RecordItem);
}

/**
 * Entries from one day to another, both included, newest first, and only of
 * one kind when asked. The calendar asks for a week or a month of sessions
 * older than the phone's recent slice, without fetching the whole journal.
 */
export function readRecordsBetween(from: string, to: string, kind?: RecordItem["kind"]): RecordItem[] {
  const rows = (kind
    ? database()
        .prepare("SELECT payload FROM records WHERE day BETWEEN ? AND ? AND kind = ? ORDER BY day DESC, created_at DESC")
        .all(from, to, kind)
    : database()
        .prepare("SELECT payload FROM records WHERE day BETWEEN ? AND ? ORDER BY day DESC, created_at DESC")
        .all(from, to)) as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as RecordItem);
}
