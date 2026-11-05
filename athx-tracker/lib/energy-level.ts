import { addDays, isCheckIn } from "./client.ts";
import type { EnergyCheckIn, RecordItem } from "./domain.ts";

type Person = "hippos" | "gators";

/**
 * The check-in that stands for a day: the one with the later clock, an
 * untimed one counting as earlier than a timed one. Today keeps one a day, so
 * two only meet on a day when one was moved there in the Log; then, at the
 * same time, the first in the list stands, which from the server is the one
 * created last.
 */
export function energyOn(records: readonly RecordItem[], athlete: Person, day: string) {
  let found: EnergyCheckIn | null = null;
  for (const record of records) {
    if (!isCheckIn(record) || record.athlete !== athlete || record.day !== day) continue;
    if (!found || (record.time ?? "") > (found.time ?? "")) found = record;
  }
  return found;
}

/**
 * Whether two entries are check-ins for the same athlete and day, of which
 * the server keeps only the one saved last. The phone drops the other at once
 * too, so it does not show both until the next refresh.
 */
export const sameCheckInDay = (a: RecordItem, b: RecordItem) =>
  a.kind === "energy" && b.kind === "energy" && a.athlete === b.athlete && a.day === b.day;

/** Each day's level from one day to another, both included, oldest first; null where none was logged. */
export function energyDays(records: readonly RecordItem[], athlete: Person, from: string, to: string) {
  const days: { day: string; level: number | null }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1))
    days.push({ day, level: energyOn(records, athlete, day)?.level ?? null });
  return days;
}

/**
 * The mean of the days that have a check-in, so a day nobody logged is not
 * read as a day with no energy. Null when none has one.
 */
export function averageEnergy(records: readonly RecordItem[], athlete: Person, from: string, to: string) {
  const levels = energyDays(records, athlete, from, to)
    .map(({ level }) => level)
    .filter((level): level is number => level !== null);
  return {
    average: levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : null,
    days: levels.length,
  };
}

/** One decimal, without a trailing ".0": 6.5, 7. */
export const formatEnergy = (level: number) => String(Math.round(level * 10) / 10);
