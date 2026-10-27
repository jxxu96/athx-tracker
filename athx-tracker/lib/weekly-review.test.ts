import { test } from "node:test";
import assert from "node:assert/strict";
import { type Meal, type Workout } from "./domain.ts";
import { reviewPeriod, reviewWindows } from "./weekly-review.ts";

const window = { start: "2026-10-19", end: "2026-10-25" };
const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w", kind: "workout", athlete: "gators", day: "2026-10-20", title: "Training", category: "Strength", customCategory: "",
  seconds: 0, notes: "", segments: [], fatigue: 10, transition: 0, goal: null, context: "solo", lifts: [], ...over,
});
const meal = (over: Partial<Meal> = {}): Meal => ({
  id: "m", kind: "meal", athlete: "gators", day: "2026-10-20", name: "Lunch", meal: "Lunch",
  macros: { calories: 600, protein: 40, carbs: 60, fat: 20 }, source: "manual", assumptions: "", ...over,
});

test("current week compares the same weekdays, including Monday and Sunday", () => {
  assert.deepEqual(reviewWindows("2026-10-26", "2026-10-26"), { current: { start: "2026-10-26", end: "2026-10-26" }, previous: { start: "2026-10-19", end: "2026-10-19" } });
  assert.equal(reviewWindows("2026-10-26", "2026-10-28").previous.end, "2026-10-21");
  assert.equal(reviewWindows("2026-10-26", "2026-11-01").current.end, "2026-11-01");
  assert.deepEqual(reviewWindows("2026-10-19", "2026-10-26").current, window);
});

test("training counts categories, actual times, endurance distance and every lift set", () => {
  const summary = reviewPeriod([
    workout({ lifts: [{ name: "Deadlift", kg: 100, reps: 5, sets: 3 }] }),
    workout({ category: "Mixed", seconds: 900, segments: [{ name: "Run", block: "endurance", unit: "km", target: 2, completed: 2, seconds: 600 }], lifts: [{ name: "Squat", kg: 60, reps: 5, sets: 1, detail: [{ kg: 40, reps: 10 }, { kg: 60, reps: 5 }] }] }),
    workout({ category: "Endurance", seconds: 0, segments: [{ name: "Run", unit: "mi", completed: 1, target: 1, seconds: 500 }] }),
    workout({ category: "Other", customCategory: "Hike", seconds: 100 }),
  ], "gators", window);
  assert.equal(summary.sessions, 4);
  assert.equal(summary.seconds, 1500);
  assert.equal(summary.untimed, 1);
  assert.equal(summary.liftedKg, 2200);
  assert.equal(summary.metres, 3609.344);
  assert.deepEqual(summary.mix, [{ name: "Strength", count: 1 }, { name: "Strength + Endurance", count: 1 }, { name: "Endurance", count: 1 }, { name: "Hike", count: 1 }]);
});

test("nutrition averages use days with known meals and keep queued estimates out", () => {
  const summary = reviewPeriod([
    meal(), meal({ id: "second" }), meal({ day: "2026-10-21" }),
    meal({ day: "2026-10-22", source: "queued", macros: { calories: 0, protein: 0, carbs: 0, fat: 0 } }),
  ], "gators", window);
  assert.equal(summary.daysWithMeals, 2);
  assert.equal(summary.meals, 3);
  assert.equal(summary.pendingMeals, 1);
  assert.deepEqual(summary.average, { calories: 900, protein: 60, carbs: 90, fat: 30 });
});

test("both date boundaries are inclusive and other athletes, team and out-of-window records stay out", () => {
  const summary = reviewPeriod([
    workout({ day: window.start }), workout({ day: window.end }),
    workout({ day: "2026-10-26" }), workout({ day: "2026-10-18" }),
    workout({ athlete: "team" }), workout({ athlete: "hippos" }), meal({ athlete: "hippos" }),
  ], "gators", window);
  assert.equal(summary.sessions, 2);
  assert.equal(summary.daysWithMeals, 0);
  assert.deepEqual(summary.average, { calories: 0, protein: 0, carbs: 0, fat: 0 });
});
