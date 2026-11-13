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
 * an old one with no time either; those count together as a window of their own.
 */
export const timingOf = (record: EnergyCheckIn): EnergyTiming | null =>
  record.timing ?? (record.time ? timingAt(record.time) : null);

const mean = (levels: readonly number[]) => levels.reduce((sum, level) => sum + level, 0) / levels.length;

/**
 * One athlete's check-ins in one window of a day, oldest first, an untimed
 * one counting as earlier than a timed one. Two at the same minute, or two
 * with no time, go in the order they were saved: the journal holds those
 * newest first, so they are turned round before the sort, which keeps them.
 * The last is then the latest, the one Today shows and changes. A window
 * takes as many as are logged; none replaces another.
 */
export function checkInsAt(records: readonly RecordItem[], athlete: Person, day: string, timing: EnergyTiming | null) {
  return records
    .filter((record): record is EnergyCheckIn =>
      isCheckIn(record) && record.athlete === athlete && record.day === day && timingOf(record) === timing)
    .reverse()
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
}

/**
 * The windows of a day that have a check-in, breakfast first and the old
 * untimed ones last, each with its check-ins and their mean.
 */
export function windowsOn(records: readonly RecordItem[], athlete: Person, day: string) {
  return [...ENERGY_TIMINGS, null].flatMap((timing) => {
    const checkIns = checkInsAt(records, athlete, day, timing);
    return checkIns.length ? [{ timing, checkIns, level: mean(checkIns.map((record) => record.level)) }] : [];
  });
}

/** The mean of one window's check-ins, or null when it has none. */
export function energyAt(records: readonly RecordItem[], athlete: Person, day: string, timing: EnergyTiming) {
  const levels = checkInsAt(records, athlete, day, timing).map((record) => record.level);
  return levels.length ? mean(levels) : null;
}

/**
 * A day's level: the mean of its windows' means, so each window that has a
 * check-in weighs the same however many it has. Seven at lunch and one each
 * at breakfast and dinner is a third lunch, not seven ninths. Null when none
 * was logged.
 */
export function energyOnDay(records: readonly RecordItem[], athlete: Person, day: string) {
  const windows = windowsOn(records, athlete, day);
  return windows.length ? mean(windows.map(({ level }) => level)) : null;
}

/** Each day's level from one day to another, both included, oldest first; null where none was logged. */
export function energyDays(records: readonly RecordItem[], athlete: Person, from: string, to: string) {
  const days: { day: string; level: number | null }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1))
    days.push({ day, level: energyOnDay(records, athlete, day) });
  return days;
}

/**
 * The mean of the days that have a check-in, each day its own level, so a
 * day nobody logged is not read as a day with no energy, and a day logged
 * often does not outweigh one logged once. Null when none has one.
 */
export function averageEnergy(records: readonly RecordItem[], athlete: Person, from: string, to: string) {
  const levels = energyDays(records, athlete, from, to)
    .map(({ level }) => level)
    .filter((level): level is number => level !== null);
  return { average: levels.length ? mean(levels) : null, days: levels.length };
}

/** One decimal, without a trailing ".0": 6.5, 7. */
export const formatEnergy = (level: number) => String(Math.round(level * 10) / 10);
