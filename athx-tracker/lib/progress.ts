import { matchMovement } from "./movement-match.ts";
import {
  PROGRESS_LIFTS,
  displayLoad,
  type LiftTargets,
  type ProgressLift,
  type RecordItem,
  type WeightUnit,
} from "./domain.ts";

export type ProgressAthlete = "hippos" | "gators";

/** One day's heaviest set of a lift. Kilograms, like every load. */
export type TopSet = { day: string; kg: number; sets: number; reps: number };

export type LiftProgress = {
  key: ProgressLift;
  name: string;
  /** The first day the lift was logged. */
  start: TopSet | null;
  /** The most recent day it was logged. */
  latest: TopSet | null;
  /** The heaviest it has been, from the first day it got there. */
  best: TopSet | null;
  /** Sessions that logged it. */
  sessions: number;
  /** Kilograms. Zero is no target. */
  target: number;
};

const BY_NAME = new Map<string, ProgressLift>(
  PROGRESS_LIFTS.map(({ key, name }) => [name, key]),
);
const matched = new Map<string, ProgressLift | null>();

/**
 * Which followed lift a saved name is, through the same matching a described
 * workout gets: "OHP" typed under Other is the overhead press, while push
 * press, front squat and Romanian deadlift are lifts of their own.
 */
export function progressLift(name: string) {
  let key = matched.get(name);
  if (key === undefined) {
    const match = matchMovement(name);
    key = (match.listed && BY_NAME.get(match.name)) || null;
    matched.set(name, key);
  }
  return key;
}

/** More weight, then more reps, then more sets. */
function heavier(a: TopSet, b: TopSet) {
  if (a.kg !== b.kg) return a.kg > b.kg;
  if (a.reps !== b.reps) return a.reps > b.reps;
  return a.sets > b.sets;
}

/**
 * Start, latest and best of each followed lift for one athlete. A day counts
 * as its heaviest set, so a warm-up never reads as the figure for the day, and
 * a best is credited to the first day it was reached.
 */
export function liftProgress(
  records: RecordItem[],
  athlete: ProgressAthlete,
  targets: LiftTargets,
): LiftProgress[] {
  const days = new Map<ProgressLift, Map<string, TopSet>>();
  const sessions = new Map<ProgressLift, number>();
  for (const record of records) {
    if (record.kind !== "workout" || record.athlete !== athlete) continue;
    const logged = new Set<ProgressLift>();
    for (const lift of record.lifts) {
      const key = progressLift(lift.name);
      if (!key) continue;
      logged.add(key);
      const set = { day: record.day, kg: lift.kg, sets: lift.sets ?? 1, reps: lift.reps };
      const byDay = days.get(key) ?? new Map<string, TopSet>();
      const held = byDay.get(record.day);
      if (!held || heavier(set, held)) byDay.set(record.day, set);
      days.set(key, byDay);
    }
    for (const key of logged) sessions.set(key, (sessions.get(key) ?? 0) + 1);
  }
  return PROGRESS_LIFTS.map(({ key, name }) => {
    const sets = [...(days.get(key)?.values() ?? [])].sort((a, b) =>
      a.day < b.day ? -1 : a.day > b.day ? 1 : 0,
    );
    let best: TopSet | null = null;
    for (const set of sets) if (!best || heavier(set, best)) best = set;
    return {
      key,
      name,
      start: sets[0] ?? null,
      latest: sets[sets.length - 1] ?? null,
      best,
      sessions: sessions.get(key) ?? 0,
      target: targets[key] ?? 0,
    };
  });
}

/** Together sessions that logged a followed lift. With no single athlete, they count for neither. */
export function togetherLiftSessions(records: RecordItem[]) {
  return records.filter(
    (record) =>
      record.kind === "workout" &&
      record.athlete === "team" &&
      record.lifts.some((lift) => progressLift(lift.name) !== null),
  ).length;
}

/**
 * The gap between two loads in the unit on screen, worked out from the two
 * numbers as shown, so it is the subtraction a reader would do.
 */
export function shownGap(fromKg: number, toKg: number, unit: WeightUnit) {
  const shown = (kg: number) => Number(displayLoad(kg, unit));
  return Math.round((shown(toKg) - shown(fromKg)) * 10) / 10;
}

/**
 * How far the best is from the target, on screen. Null without both a target
 * and something logged; zero or less is reached.
 */
export function toGo(lift: Pick<LiftProgress, "best" | "target">, unit: WeightUnit) {
  if (!(lift.target > 0) || !lift.best) return null;
  return shownGap(lift.best.kg, lift.target, unit);
}

/** Where the start and the best sit along the target, as percents capped at 100. Null without a target. */
export function targetMeter(lift: Pick<LiftProgress, "start" | "best" | "target">) {
  if (!(lift.target > 0)) return null;
  const share = (set: TopSet | null) =>
    set ? Math.min(100, (set.kg / lift.target) * 100) : 0;
  return { start: share(lift.start), best: share(lift.best) };
}
