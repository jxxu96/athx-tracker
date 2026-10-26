import { matchMovement } from "./movement-match.ts";
import {
  PROGRESS_LIFTS,
  displayLoad,
  liftTop,
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
      // A varied lift counts as its heaviest sets, so a warm-up in the same
      // entry never becomes the number for the day.
      const top = lift.detail?.length ? liftTop(lift.detail) : { kg: lift.kg, sets: lift.sets ?? 1, reps: lift.reps };
      const set = { day: record.day, ...top };
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

/** Press, squat and deadlift. The split jerk is followed on its own and is not in this total. */
export const TOTAL_LIFTS = ["overheadPress", "backSquat", "deadlift"] as const;

export type LiftTotal = {
  start: number | null;
  latest: number | null;
  best: number | null;
  /** Kilograms. Null until all three lifts have a target. */
  target: number | null;
};

/**
 * The three lifts added together. A column stays empty until every one of them
 * has that figure, so a missing deadlift cannot look like a small total.
 */
export function liftTotal(rows: LiftProgress[]): LiftTotal {
  const three = TOTAL_LIFTS.map((key) => rows.find((row) => row.key === key));
  const sum = (value: (row: LiftProgress) => number | null) => {
    let total = 0;
    for (const row of three) {
      if (!row) return null;
      const kg = value(row);
      if (kg === null || !(kg > 0)) return null;
      total += kg;
    }
    return total;
  };
  return {
    start: sum((row) => row.start?.kg ?? null),
    latest: sum((row) => row.latest?.kg ?? null),
    best: sum((row) => row.best?.kg ?? null),
    target: sum((row) => (row.target > 0 ? row.target : null)),
  };
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

export type ProgressMark = "start" | "latest" | "best" | "target";

/**
 * Where each figure sits on the bar, as a percent of the heaviest one.
 * The rightmost point is the biggest number. Null when there is nothing to place.
 */
export function progressMarks(
  lift: Pick<LiftProgress, "start" | "latest" | "best" | "target">,
): { key: ProgressMark; kg: number; at: number }[] | null {
  const marks: { key: ProgressMark; kg: number }[] = [];
  if (lift.start && lift.start.kg > 0) marks.push({ key: "start", kg: lift.start.kg });
  if (lift.latest && lift.latest.kg > 0) marks.push({ key: "latest", kg: lift.latest.kg });
  if (lift.best && lift.best.kg > 0) marks.push({ key: "best", kg: lift.best.kg });
  if (lift.target > 0) marks.push({ key: "target", kg: lift.target });
  if (!marks.length) return null;
  const heaviest = Math.max(...marks.map((mark) => mark.kg));
  return marks.map((mark) => ({ ...mark, at: (mark.kg / heaviest) * 100 }));
}
