import { addDays, isCheckIn } from "./client.ts";
import { ENERGY_TIMINGS, isClockTime, type EnergyCheckIn, type EnergyTiming, type RecordItem } from "./domain.ts";
import { energyTimingForTime } from "./meal-time.ts";

type Person = "hippos" | "gators";

/** The timing a time of day falls in, by the same hours as a new check-in's. */
export function timingAt(time: string): EnergyTiming | null {
  if (!isClockTime(time)) return null;
  return energyTimingForTime(new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3))));
}

/**
 * Which timing a check-in is for: the one it was saved with, or, for one
 * from before there were timings, the one its time of day falls in. Null for
 * an old one with no time either; those stand together as the day's.
 */
export const timingOf = (record: EnergyCheckIn): EnergyTiming | null =>
  record.timing ?? (record.time ? timingAt(record.time) : null);

/**
 * The check-ins that stand for a day, one for each timing, breakfast first
 * and an old untimed one last. Today keeps one a timing, so two only meet
 * when one was moved there in the Log or two phones each made their own;
 * then the one with the later clock stands, an untimed one counting as
 * earlier than a timed one, and at the same time the first in the list,
 * which from the server is the one created last.
 */
export function energyOn(records: readonly RecordItem[], athlete: Person, day: string) {
  const found = new Map<EnergyTiming | null, EnergyCheckIn>();
  for (const record of records) {
    if (!isCheckIn(record) || record.athlete !== athlete || record.day !== day) continue;
    const timing = timingOf(record);
    const standing = found.get(timing);
    if (!standing || (record.time ?? "") > (standing.time ?? "")) found.set(timing, record);
  }
  return [...ENERGY_TIMINGS, null].flatMap((timing) => found.get(timing) ?? []);
}

/** The check-in that stands for one timing of a day, or null when there is none. */
export const energyAt = (records: readonly RecordItem[], athlete: Person, day: string, timing: EnergyTiming) =>
  energyOn(records, athlete, day).find((record) => timingOf(record) === timing) ?? null;

/**
 * Whether two entries are check-ins for the same athlete, day and timing, of
 * which the server keeps only the one saved last. The phone drops the other
 * at once too, so it does not show both until the next refresh.
 */
export const sameCheckInSlot = (a: RecordItem, b: RecordItem) =>
  a.kind === "energy" && b.kind === "energy" && a.athlete === b.athlete && a.day === b.day &&
  timingOf(a) === timingOf(b);

/**
 * A day's level: the mean of its timings, so a day checked in three times
 * counts once, like a day checked in once. Null when none was logged.
 */
export function energyOnDay(records: readonly RecordItem[], athlete: Person, day: string) {
  const levels = energyOn(records, athlete, day).map((record) => record.level);
  return levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : null;
}

/** Each day's level from one day to another, both included, oldest first; null where none was logged. */
export function energyDays(records: readonly RecordItem[], athlete: Person, from: string, to: string) {
  const days: { day: string; level: number | null }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1))
    days.push({ day, level: energyOnDay(records, athlete, day) });
  return days;
}

/**
 * The mean of the days that have a check-in, each day its own mean, so a day
 * nobody logged is not read as a day with no energy, and a day logged at
 * every timing does not outweigh one logged once. Null when none has one.
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
