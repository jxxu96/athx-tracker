import { addDays, daysBetween, weekStart } from "./client.ts";
import { matchMovement } from "./movement-match.ts";
import {
  MAX_REPS,
  STRENGTH_2027,
  STRENGTH_LIFTS,
  WINDOW_OF,
  repMax,
  strengthLift,
  strengthTargets,
  type StrengthLift,
} from "./race.ts";
import {
  FOLLOWED_LIFTS,
  PROGRESS_LIFTS,
  displayLoad,
  type Lift,
  type LiftTargets,
  type ProgressLift,
  type RecordItem,
  type WeightUnit,
} from "./domain.ts";

export type ProgressAthlete = "hippos" | "gators";

/**
 * The most the logged sets predict for a rep max, on the same line the race
 * estimate uses, and the set it came from. The heaviest set is what was on
 * the bar; this is what that set says about the race's lift, so 100 kg for
 * five reads as more than 101 kg for one. Kilograms, like every load.
 */
export type EstimatedMax = { kg: number; day: string; setKg: number; reps: number };

/**
 * The rep max Progress measures a lift at: the one its race window asks for,
 * a single overhead, two for the back squat and three for the deadlift.
 */
export const liftReps = (key: ProgressLift) => STRENGTH_2027.reps[WINDOW_OF[key]];

/** Weeks of volume Progress shows, the current one last. */
export const VOLUME_WEEKS = 8;

/**
 * A lift's first, most recent and best day, each day at the most its sets
 * predict. Days with no set of ten reps or fewer have no figure.
 */
export type RepMaxProgress = {
  /** The first day with a figure. */
  start: EstimatedMax | null;
  /** The most recent day with a figure. */
  latest: EstimatedMax | null;
  /** The most it has predicted, from the first day it got there. */
  best: EstimatedMax | null;
};

export type LiftProgress = RepMaxProgress & {
  key: ProgressLift;
  name: string;
  /** The rep max every figure is at. */
  reps: number;
  /** Sessions that logged it. */
  sessions: number;
  /** Kilograms, at the same rep max. Zero is no target. */
  target: number;
  /**
   * Kilograms times reps for each Monday week, oldest first, the current
   * week, which may not be over, last. Empty without a day to count from.
   */
  weeks: number[];
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

/** Every set of a lift: each one when they differed, otherwise the one line. */
function setsOf(lift: Pick<Lift, "kg" | "sets" | "reps" | "detail">) {
  return lift.detail?.length
    ? lift.detail
    : Array.from({ length: Math.max(1, Math.floor(lift.sets ?? 1)) }, () => ({ kg: lift.kg, reps: lift.reps }));
}

/** Load times reps across every set: what the lift moved. */
export function liftVolume(lift: Pick<Lift, "kg" | "sets" | "reps" | "detail">) {
  return setsOf(lift).reduce((sum, set) => sum + set.kg * Math.max(0, Math.floor(set.reps)), 0);
}

/**
 * The most any set of ten reps or fewer predicts for a rep max, a single
 * unless asked for more. Past ten, a set says little about a max, which is
 * the race estimate's rule too.
 */
export function estimatedMax(
  lift: Pick<Lift, "kg" | "sets" | "reps" | "detail">,
  day: string,
  target = 1,
): EstimatedMax | null {
  let best: EstimatedMax | null = null;
  for (const set of setsOf(lift)) {
    const reps = Math.floor(set.reps);
    if (!(set.kg > 0) || !(reps >= 1 && reps <= MAX_REPS)) continue;
    const kg = repMax(set.kg, reps, target);
    if (!best || kg > best.kg) best = { kg, day, setKg: set.kg, reps };
  }
  return best;
}

/** Keeps the higher figure for its day, so a warm-up never stands in for it. */
function keepDay(days: Map<string, EstimatedMax>, figure: EstimatedMax | null) {
  if (!figure) return;
  const held = days.get(figure.day);
  if (!held || figure.kg > held.kg) days.set(figure.day, figure);
}

/** First, latest and best of some days' figures, a best going to the first day it was reached. */
function repMaxProgress(days: Map<string, EstimatedMax> | undefined): RepMaxProgress {
  const sorted = [...(days?.values() ?? [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let best: EstimatedMax | null = null;
  for (const figure of sorted) if (!best || figure.kg > best.kg) best = figure;
  return { start: sorted[0] ?? null, latest: sorted[sorted.length - 1] ?? null, best };
}

/**
 * Start, latest and best of each followed lift for one athlete, at the rep
 * max its race window asks for. A day counts as the most any of its sets
 * predicts, so a warm-up never reads as the figure for the day, and a best is
 * credited to the first day it was reached. With today, the volume of each of
 * the last eight weeks as well.
 */
export function liftProgress(
  records: RecordItem[],
  athlete: ProgressAthlete,
  targets: LiftTargets,
  today?: string,
): LiftProgress[] {
  const days = new Map<ProgressLift, Map<string, EstimatedMax>>();
  const sessions = new Map<ProgressLift, number>();
  const firstWeek = today ? addDays(weekStart(today), -7 * (VOLUME_WEEKS - 1)) : "";
  const volume = new Map<ProgressLift, number[]>();
  for (const record of records) {
    if (record.kind !== "workout" || record.athlete !== athlete) continue;
    const logged = new Set<ProgressLift>();
    const week = today && record.day >= firstWeek && record.day <= today
      ? Math.floor(daysBetween(firstWeek, weekStart(record.day)) / 7)
      : -1;
    for (const lift of record.lifts) {
      const key = progressLift(lift.name);
      if (!key) continue;
      logged.add(key);
      if (week >= 0) {
        const weeks = volume.get(key) ?? Array.from({ length: VOLUME_WEEKS }, () => 0);
        weeks[week] += liftVolume(lift);
        volume.set(key, weeks);
      }
      const byDay = days.get(key) ?? new Map<string, EstimatedMax>();
      keepDay(byDay, estimatedMax(lift, record.day, liftReps(key)));
      days.set(key, byDay);
    }
    for (const key of logged) sessions.set(key, (sessions.get(key) ?? 0) + 1);
  }
  return FOLLOWED_LIFTS[athlete].map(({ key, name }) => ({
    key,
    name,
    reps: liftReps(key),
    ...repMaxProgress(days.get(key)),
    sessions: sessions.get(key) ?? 0,
    target: targets[key] ?? 0,
    weeks: today ? volume.get(key) ?? Array.from({ length: VOLUME_WEEKS }, () => 0) : [],
  }));
}

/** One athlete's three Strength windows, each at the rep max the race asks for. */
export type StrengthProgress = Record<StrengthLift, RepMaxProgress>;

/**
 * Each of the race's Strength windows the way the race estimate counts it:
 * shoulder to overhead takes any press or jerk logged, followed or not, so its
 * best is the race estimate's figure for the athlete.
 */
export function strengthProgress(records: RecordItem[], athlete: ProgressAthlete): StrengthProgress {
  const days: Record<StrengthLift, Map<string, EstimatedMax>> = {
    overhead: new Map(),
    squat: new Map(),
    deadlift: new Map(),
  };
  for (const record of records) {
    if (record.kind !== "workout" || record.athlete !== athlete) continue;
    for (const lift of record.lifts) {
      const key = strengthLift(lift.name);
      if (key) keepDay(days[key], estimatedMax(lift, record.day, STRENGTH_2027.reps[key]));
    }
  }
  return {
    overhead: repMaxProgress(days.overhead),
    squat: repMaxProgress(days.squat),
    deadlift: repMaxProgress(days.deadlift),
  };
}

export type LiftTotal = {
  start: number | null;
  latest: number | null;
  best: number | null;
  /** Kilograms. Null until all three windows have a target. */
  target: number | null;
};

/**
 * The race's three Strength lifts added together: the athlete's share of the
 * Strength score. A column stays empty until every one of them has that
 * figure, so a missing deadlift cannot look like a small total.
 */
export function liftTotal(
  windows: StrengthProgress,
  targets: LiftTargets,
  athlete: ProgressAthlete,
): LiftTotal {
  const goals = strengthTargets(targets, athlete);
  const sum = (value: (key: StrengthLift) => number | null | undefined) => {
    let total = 0;
    for (const { key } of STRENGTH_LIFTS) {
      const kg = value(key);
      if (kg == null || !(kg > 0)) return null;
      total += kg;
    }
    return total;
  };
  return {
    start: sum((key) => windows[key].start?.kg),
    latest: sum((key) => windows[key].latest?.kg),
    best: sum((key) => windows[key].best?.kg),
    target: sum((key) => goals[key]),
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
export function toGo(lift: { best: { kg: number } | null; target: number }, unit: WeightUnit) {
  if (!(lift.target > 0) || !lift.best) return null;
  return shownGap(lift.best.kg, lift.target, unit);
}

export type ProgressMark = "start" | "latest" | "best" | "target";

/** Round steps a scale can count in: 1, 2, 2.5 and 5 of each power of ten. */
const STEPS = [1, 2, 2.5, 5, 10];

/**
 * A scale that just covers the given weights, counted in round steps. It does
 * not start at zero, which squeezed a year of progress into the last tenth of
 * the line. One weight alone gets a step either side, so it sits mid-line.
 */
export function progressScale(values: number[]) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || Math.max(high * 0.1, 1);
  const rough = span / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = STEPS.find((s) => s * power >= rough * (1 - 1e-9))! * power;
  let from = Math.floor(low / step + 1e-9) * step;
  let to = Math.ceil(high / step - 1e-9) * step;
  if (from === to) {
    from -= step;
    to += step;
  }
  from = Math.max(0, from);
  const ticks: number[] = [];
  for (let value = from; value <= to + step / 2; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return { from, to, ticks };
}

export type ProgressBar = {
  marks: { key: ProgressMark; kg: number; at: number }[];
  /** Scale labels in the unit on screen, placed like the marks. */
  ticks: { value: number; at: number }[];
};

/**
 * Where each figure and each scale label sits on the bar, as a percent of its
 * length, on a scale fitted to the figures in the unit on screen. Null when
 * there is nothing to place.
 */
export function progressMarks(
  lift: { [key in Exclude<ProgressMark, "target">]: { kg: number } | null } & { target: number },
  unit: WeightUnit,
): ProgressBar | null {
  const marks: { key: ProgressMark; kg: number }[] = [];
  if (lift.start && lift.start.kg > 0) marks.push({ key: "start", kg: lift.start.kg });
  if (lift.latest && lift.latest.kg > 0) marks.push({ key: "latest", kg: lift.latest.kg });
  if (lift.best && lift.best.kg > 0) marks.push({ key: "best", kg: lift.best.kg });
  if (lift.target > 0) marks.push({ key: "target", kg: lift.target });
  if (!marks.length) return null;
  // The figures as printed, so a mark sits where its number reads on the scale.
  const shown = (kg: number) => Number(displayLoad(kg, unit));
  const { from, to, ticks } = progressScale(marks.map((mark) => shown(mark.kg)));
  const place = (value: number) => ((value - from) / (to - from)) * 100;
  return {
    marks: marks.map((mark) => ({ ...mark, at: place(shown(mark.kg)) })),
    ticks: ticks.map((value) => ({ value, at: place(value) })),
  };
}

/**
 * Which lane each leader turns in, top lane first. A leader drops from its
 * mark, runs across in its lane, and drops again to its figure; the lanes are
 * the order with the fewest crossings, so a leader is easy to follow.
 * Positions are percents of the width.
 */
export function leaderLanes(leaders: { from: number; to: number }[]) {
  const crossings = (lanes: number[]) => {
    let count = 0;
    leaders.forEach((a, i) => {
      const left = Math.min(a.from, a.to) + 0.5;
      const right = Math.max(a.from, a.to) - 0.5;
      const inside = (x: number) => x > left && x < right;
      leaders.forEach((b, j) => {
        if (i === j) return;
        // Its first drop reaches past this lane, or its second starts above it.
        if (inside(b.from) && lanes[j] > lanes[i]) count++;
        if (inside(b.to) && lanes[j] < lanes[i]) count++;
      });
    });
    return count;
  };
  let best = leaders.map((_, index) => index);
  let fewest = crossings(best);
  const order = (rest: number[], taken: number[]) => {
    if (!rest.length) {
      const count = crossings(taken);
      if (count < fewest) [best, fewest] = [taken, count];
      return;
    }
    for (const lane of rest) order(rest.filter((other) => other !== lane), [...taken, lane]);
  };
  order(best, []);
  return best;
}
