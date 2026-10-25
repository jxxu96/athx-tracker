import { test } from "node:test";
import assert from "node:assert/strict";
import type { Meal, RecordItem, Workout } from "./domain.ts";
import {
  athleteFuel,
  calorieTracking,
  formatAmount,
  fuelWindow,
  gapLabel,
  targetGap,
  targetPercent,
  teamSessions,
} from "./fuel.ts";

const today = "2026-03-01";

const meal = (over: Partial<Meal> = {}): Meal => ({
  id: "m",
  kind: "meal",
  athlete: "hippos",
  day: today,
  name: "lunch",
  meal: "Lunch",
  macros: { calories: 500, protein: 30, carbs: 40, fat: 15 },
  source: "manual",
  assumptions: "",
  ...over,
});

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w",
  kind: "workout",
  athlete: "hippos",
  day: today,
  title: "t",
  category: "MetCon",
  customCategory: "",
  seconds: 1800,
  notes: "",
  segments: [],
  fatigue: 10,
  transition: 0,
  goal: null,
  context: "solo",
  lifts: [],
  ...over,
});

const target = { calories: 2000, protein: 140, carbs: 200, fat: 70 };

test("the fuel window is today, yesterday, or the seven days ending today", () => {
  assert.deepEqual(fuelWindow("today", today), { start: today, end: today });
  assert.deepEqual(fuelWindow("yesterday", today), {
    start: "2026-02-28",
    end: "2026-02-28",
  });
  assert.deepEqual(fuelWindow("week", today), {
    start: "2026-02-23",
    end: today,
  });
  assert.equal(fuelWindow("overall", today), null);
  assert.deepEqual(fuelWindow("yesterday", "2028-03-01"), {
    start: "2028-02-29",
    end: "2028-02-29",
  });
});

test("amounts group by thousands without depending on the machine locale", () => {
  assert.equal(formatAmount(0), "0");
  assert.equal(formatAmount(1840.4), "1,840");
  assert.equal(formatAmount(86800), "86,800");
  assert.equal(formatAmount(-1200), "-1,200");
});

test("a gap inside five percent is on target, and the band scales with the target", () => {
  assert.equal(targetGap(2000, 2000)?.state, "on");
  assert.equal(targetGap(2100, 2000)?.state, "on");
  assert.deepEqual(targetGap(2101, 2000), {
    state: "over",
    delta: 101,
    amount: 101,
  });
  assert.equal(targetGap(1900, 2000)?.state, "on");
  assert.equal(targetGap(1899, 2000)?.state, "under");
  // 50 g short of a 140 g protein target is not "on target".
  assert.equal(targetGap(90, 140)?.state, "under");
  assert.equal(targetGap(500, 0), null);
  assert.equal(gapLabel(targetGap(2101, 2000), "kcal"), "101 kcal over");
  assert.equal(gapLabel(targetGap(2000, 2000), "kcal"), "on target");
  assert.equal(gapLabel(null, "kcal"), "");
});

test("a macro's share of its target is a whole percent", () => {
  assert.equal(targetPercent(500, 2000), 25);
  assert.equal(targetPercent(2000, 2000), 100);
  assert.equal(targetPercent(2500, 2000), 125);
  assert.equal(targetPercent(1, 2000), 0);
  assert.equal(targetPercent(500, 0), null);
});

test("a day shows that day's meals and not the days around it", () => {
  const records: RecordItem[] = [
    meal({ id: "a", macros: { calories: 800, protein: 40, carbs: 80, fat: 20 } }),
    meal({
      id: "b",
      day: "2026-02-28",
      macros: { calories: 9000, protein: 0, carbs: 0, fat: 0 },
    }),
  ];
  const fuel = athleteFuel(records, "hippos", "today", today, target, 70);
  assert.equal(fuel.shown.calories, 800);
  assert.equal(fuel.daysWithMeals, 1);
  assert.equal(fuel.eaten.calories, 800);

  const yesterday = athleteFuel(records, "hippos", "yesterday", today, target, 70);
  assert.equal(yesterday.shown.calories, 9000);
  assert.equal(yesterday.daysWithMeals, 1);
});

test("a week averages days with a meal and ignores the empty ones", () => {
  const records: RecordItem[] = [
    meal({ id: "a", day: "2026-02-23", macros: { calories: 1000, protein: 50, carbs: 100, fat: 30 } }),
    meal({ id: "b", day: "2026-02-23", macros: { calories: 1000, protein: 50, carbs: 100, fat: 30 } }),
    meal({ id: "c", day: "2026-03-01", macros: { calories: 3000, protein: 150, carbs: 300, fat: 90 } }),
    // Eighth day back, and the other athlete: neither belongs in this average.
    meal({ id: "d", day: "2026-02-22", macros: { calories: 9000, protein: 0, carbs: 0, fat: 0 } }),
    meal({
      id: "e",
      athlete: "gators",
      day: "2026-03-01",
      macros: { calories: 9000, protein: 0, carbs: 0, fat: 0 },
    }),
  ];
  const fuel = athleteFuel(records, "hippos", "week", today, target, 70);
  assert.equal(fuel.daysWithMeals, 2);
  assert.equal(fuel.meals, 3);
  assert.equal(fuel.eaten.calories, 5000);
  assert.equal(fuel.shown.calories, 2500);
  assert.equal(fuel.shown.protein, 125);
  assert.equal(fuel.spanDays, 7);
});

test("overall keeps the whole journal, including days outside the last week", () => {
  const records: RecordItem[] = [
    meal({ id: "old", day: "2025-01-01", macros: { calories: 1800, protein: 100, carbs: 150, fat: 60 } }),
    meal({ id: "now", macros: { calories: 2200, protein: 140, carbs: 200, fat: 70 } }),
  ];
  const fuel = athleteFuel(records, "hippos", "overall", today, target, 70);
  assert.equal(fuel.daysWithMeals, 2);
  assert.equal(fuel.eaten.calories, 4000);
  assert.equal(fuel.shown.calories, 2000);
  assert.equal(fuel.spanDays, null);
});

test("no meals is an empty day, not a day of zeros against the target", () => {
  const fuel = athleteFuel([], "gators", "today", today, target, 80);
  assert.equal(fuel.daysWithMeals, 0);
  assert.equal(fuel.shown.calories, 0);
  assert.equal(calorieTracking("Gators", fuel, false), "Gators has no meals logged");
});

test("tracking names the calorie gap, and a longer span says it is an average", () => {
  const under = athleteFuel(
    [meal({ macros: { calories: 1500, protein: 100, carbs: 150, fat: 40 } })],
    "hippos",
    "today",
    today,
    target,
    70,
  );
  assert.equal(
    calorieTracking("Hippos", under, false),
    "Hippos is 500 kcal under target",
  );
  const on = athleteFuel(
    [meal({ macros: { calories: 2000, protein: 140, carbs: 200, fat: 70 } })],
    "hippos",
    "week",
    today,
    target,
    70,
  );
  assert.equal(calorieTracking("Hippos", on, true), "Hippos is averaging on target");
  const bare = athleteFuel(
    [meal()],
    "hippos",
    "overall",
    today,
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
    70,
  );
  assert.equal(calorieTracking("Hippos", bare, true), "Hippos has no calorie target");
});

test("expenditure sums timed sessions and withholds a burn without a bodyweight", () => {
  const records: RecordItem[] = [
    workout({ id: "a", seconds: 1800 }),
    workout({ id: "b", seconds: 0 }),
    workout({ id: "c", athlete: "gators", seconds: 1800 }),
    workout({ id: "d", athlete: "team", seconds: 1800 }),
    workout({ id: "e", day: "2026-02-01", seconds: 3600 }),
  ];
  const fuel = athleteFuel(records, "hippos", "today", today, target, 80);
  // MetCon, 80 kg, 30 min: 336 rounded to 340. The untimed session is counted apart.
  assert.equal(fuel.burned, 340);
  assert.equal(fuel.sessions, 2);
  assert.equal(fuel.untimed, 1);
  assert.equal(fuel.burnKnown, true);
  assert.equal(teamSessions(records, "today", today), 1);

  const unknown = athleteFuel(records, "hippos", "today", today, target, 0);
  assert.equal(unknown.burnKnown, false);
  assert.equal(unknown.burned, 0);
  assert.equal(unknown.untimed, 0);
  assert.equal(unknown.sessions, 2);

  const all = athleteFuel(records, "hippos", "overall", today, target, 80);
  assert.ok(all.burned > fuel.burned);
});
