import { bodyweightKnown, bodyweightOn, type BodyweightHistory } from "./bodyweight.ts";
import { addDays, isMeal, isWorkout } from "./client.ts";
import {
  estimateBurn,
  sumMacros,
  type Macros,
  type Meal,
  type RecordItem,
  type Settings,
  type Workout,
} from "./domain.ts";
import { restingOn } from "./energy.ts";
import { averageTargets, targetsOn } from "./targets.ts";

export type FuelSpan = "today" | "yesterday" | "week" | "overall";
export type FuelAthlete = "hippos" | "gators";

/** Null is the whole journal. A bounded span includes both ends. */
export type FuelWindow = { start: string; end: string } | null;

const EMPTY: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

/**
 * Today, yesterday, and the seven days ending today. The Monday week on the
 * session panel is a different question (how many times you trained). This one
 * is the food, so it is the days a person means by "the last week".
 */
export function fuelWindow(span: FuelSpan, today: string): FuelWindow {
  if (span === "overall") return null;
  if (span === "today") return { start: today, end: today };
  if (span === "yesterday") {
    const day = addDays(today, -1);
    return { start: day, end: day };
  }
  return { start: addDays(today, -6), end: today };
}

export function inFuelWindow(day: string, window: FuelWindow) {
  return window === null || (day >= window.start && day <= window.end);
}

/** Whole numbers with thousands separators, independent of the machine locale. */
export function formatAmount(value: number) {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function averageMacros(total: Macros, days: number): Macros {
  if (days <= 0) return { ...EMPTY };
  return {
    calories: total.calories / days,
    protein: total.protein / days,
    carbs: total.carbs / days,
    fat: total.fat / days,
  };
}

/**
 * On target inside 5% of the target. Tighter than a flat 50, which would call
 * a protein day 50 g short a success. Null when there is no target to miss.
 */
export function targetGap(actual: number, target: number) {
  if (!(target > 0)) return null;
  const delta = Math.round(actual - target);
  const band = Math.max(1, Math.round(target * 0.05));
  if (Math.abs(delta) <= band) return { state: "on" as const, delta };
  return {
    state: (delta > 0 ? "over" : "under") as "over" | "under",
    delta,
    amount: Math.abs(delta),
  };
}

export function gapLabel(
  gap: ReturnType<typeof targetGap>,
  unit: string,
) {
  if (!gap) return "";
  if (gap.state === "on") return "on target";
  return `${formatAmount(gap.amount)} ${unit} ${gap.state}`;
}

/** Share of the daily target, as a whole percent. Null when there is no target. Past 100 when over. */
export function targetPercent(actual: number, target: number) {
  if (!(target > 0)) return null;
  return Math.round((actual / target) * 100);
}

export type AthleteFuel = {
  /** Sum of every meal in the span. */
  eaten: Macros;
  /**
   * What the bars show. A single day is that day's total. A longer span is the
   * average of days that have a meal, so a day you did not log is not treated
   * as a day you ate nothing.
   */
  shown: Macros;
  /**
   * The targets the bars are measured against: the day's own, or across a
   * longer span the average of the targets in force on its days with a meal.
   */
  dailyTarget: Macros;
  daysWithMeals: number;
  meals: number;
  /** Training burn for the whole span, each session at the weight of its day. */
  burned: number;
  sessions: number;
  /** Timed sessions that still could not be estimated, which is a missing duration. */
  untimed: number;
  /** False when no weight is known at all: burned is then withheld, not zero. */
  burnKnown: boolean;
  /**
   * Resting energy for the day, or across a longer span a day's average.
   * Null without a height, a birth year and a weight.
   */
  resting: number | null;
  /**
   * Resting energy and training together, for the day or as a day's average:
   * what eating is set against. Null while resting is unknown.
   */
  expenditure: number | null;
  /** Days the expenditure average is over: 1, 7, or every day since the first entry. */
  expenditureDays: number;
  /** 7 for the rolling week, 1 for a day, null for the whole journal. */
  spanDays: number | null;
};

export type FuelSettings = Pick<Settings, "targets" | "targetHistory" | "height" | "birthYear">;

/**
 * One athlete's food against their targets and their spend, for a span.
 *
 * Expenditure is a property of every day, logged meals or not, so a longer
 * span averages it over all of its days; eating is averaged over the days
 * with a meal, on the same reasoning that leaves a forgotten day out of the
 * bars. Resting energy needs a height and a birth year as well as a weight,
 * and without them the expenditure is withheld rather than shown as training
 * alone, which would read as a whole day's spend.
 */
export function athleteFuel(
  records: RecordItem[],
  athlete: FuelAthlete,
  span: FuelSpan,
  today: string,
  settings: FuelSettings,
  history: BodyweightHistory,
): AthleteFuel {
  const window = fuelWindow(span, today);
  const meals = records.filter(
    (record): record is Meal =>
      isMeal(record) &&
      record.athlete === athlete &&
      inFuelWindow(record.day, window),
  );
  const workouts = records.filter(
    (record): record is Workout =>
      isWorkout(record) &&
      record.athlete === athlete &&
      inFuelWindow(record.day, window),
  );
  const eaten = sumMacros(meals);
  const mealDays = [...new Set(meals.map((meal) => meal.day))];
  const daysWithMeals = mealDays.length;
  const multi = span === "week" || span === "overall";
  const burnKnown = bodyweightKnown(history, athlete);
  let burned = 0;
  let untimed = 0;
  for (const workout of workouts) {
    if (!burnKnown) continue;
    const kcal = estimateBurn(workout, bodyweightOn(history, athlete, workout.day));
    if (kcal === null) untimed += 1;
    else burned += kcal;
  }

  const days = spanDays(records, athlete, window, today);
  let resting: number | null = 0;
  for (const day of days) {
    const kcal = restingOn(settings, history, athlete, day);
    if (kcal === null) {
      resting = null;
      break;
    }
    resting += kcal;
  }
  if (resting !== null) resting /= days.length;

  return {
    eaten,
    shown: multi ? averageMacros(eaten, daysWithMeals) : eaten,
    dailyTarget: multi
      ? averageTargets(settings, athlete, mealDays)
      : targetsOn(settings, athlete, window!.start),
    daysWithMeals,
    meals: meals.length,
    burned,
    sessions: workouts.length,
    untimed,
    burnKnown,
    resting,
    expenditure: resting === null ? null : resting + burned / days.length,
    expenditureDays: days.length,
    spanDays: span === "week" ? 7 : span === "overall" ? null : 1,
  };
}

/**
 * Every day a span covers. The whole journal starts on the athlete's first
 * entry, so a day before they logged anything is not a day of theirs.
 */
function spanDays(
  records: RecordItem[],
  athlete: FuelAthlete,
  window: FuelWindow,
  today: string,
) {
  let start = window?.start;
  const end = window?.end ?? today;
  if (!start) {
    start = end;
    for (const record of records)
      if (record.athlete === athlete && record.day < start) start = record.day;
  }
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * Eaten against spent: the day's food less its expenditure, or across a
 * longer span the average day with a meal less the average day's spend.
 * Null while the expenditure is unknown.
 */
export function energyBalance(fuel: AthleteFuel) {
  if (fuel.expenditure === null || fuel.daysWithMeals === 0) return null;
  return fuel.shown.calories - fuel.expenditure;
}

/** Together sessions have no single bodyweight, so they stay out of both totals. */
export function teamSessions(
  records: RecordItem[],
  span: FuelSpan,
  today: string,
) {
  const window = fuelWindow(span, today);
  return records.filter(
    (record) =>
      isWorkout(record) &&
      record.athlete === "team" &&
      inFuelWindow(record.day, window),
  ).length;
}

/**
 * One line for the calorie target. Longer spans say "averaging" because the
 * number is a daily average, and reading it as a total would look like a fast.
 */
export function calorieTracking(
  name: string,
  fuel: AthleteFuel,
  multi: boolean,
) {
  if (fuel.daysWithMeals === 0) return `${name} has no meals logged`;
  const gap = targetGap(fuel.shown.calories, fuel.dailyTarget.calories);
  if (!gap) return `${name} has no calorie target`;
  if (gap.state === "on") {
    return multi ? `${name} is averaging on target` : `${name} is on target`;
  }
  const amount = `${formatAmount(gap.amount)} kcal ${gap.state} target`;
  return multi ? `${name} is averaging ${amount}` : `${name} is ${amount}`;
}
