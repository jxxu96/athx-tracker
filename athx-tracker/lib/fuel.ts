import { addDays, isMeal, isWorkout } from "./client.ts";
import {
  estimateBurn,
  sumMacros,
  type Macros,
  type Meal,
  type RecordItem,
  type Workout,
} from "./domain.ts";

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

export type AthleteFuel = {
  /** Sum of every meal in the span. */
  eaten: Macros;
  /**
   * What the bars show. A single day is that day's total. A longer span is the
   * average of days that have a meal, so a day you did not log is not treated
   * as a day you ate nothing.
   */
  shown: Macros;
  dailyTarget: Macros;
  daysWithMeals: number;
  meals: number;
  burned: number;
  sessions: number;
  /** Timed sessions that still could not be estimated, which is a missing duration. */
  untimed: number;
  /** False when bodyweight is missing: burned is then withheld, not zero. */
  burnKnown: boolean;
  /** 7 for the rolling week, 1 for a day, null for the whole journal. */
  spanDays: number | null;
};

export function athleteFuel(
  records: RecordItem[],
  athlete: FuelAthlete,
  span: FuelSpan,
  today: string,
  dailyTarget: Macros,
  bodyweightKg: number,
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
  const daysWithMeals = new Set(meals.map((meal) => meal.day)).size;
  const multi = span === "week" || span === "overall";
  const burnKnown = bodyweightKg > 0;
  let burned = 0;
  let untimed = 0;
  for (const workout of workouts) {
    if (!burnKnown) continue;
    const kcal = estimateBurn(workout, bodyweightKg);
    if (kcal === null) untimed += 1;
    else burned += kcal;
  }
  return {
    eaten,
    shown: multi ? averageMacros(eaten, daysWithMeals) : eaten,
    dailyTarget,
    daysWithMeals,
    meals: meals.length,
    burned,
    sessions: workouts.length,
    untimed,
    burnKnown,
    spanDays: span === "week" ? 7 : span === "overall" ? null : 1,
  };
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
