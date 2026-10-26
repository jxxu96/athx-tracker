import { test } from "node:test";
import assert from "node:assert/strict";
import type { Lift, Workout } from "./domain.ts";
import { FIELD, percentile, strengthPlacing } from "./field.ts";
import { STRENGTH_2026, strengthPlan } from "./race.ts";

const workout = (athlete: Workout["athlete"], lifts: Lift[]): Workout => ({
  id: "w",
  kind: "workout",
  athlete,
  day: "2026-10-20",
  title: "Lifts",
  category: "Strength",
  customCategory: "",
  seconds: 0,
  notes: "",
  segments: [],
  fatigue: 10,
  transition: 0,
  goal: null,
  context: "solo",
  lifts,
});
const lift = (name: string, kg: number, reps: number): Lift => ({ name, kg, sets: 1, reps });

/** Gators presses 120 lb strict and jerks 57 kg; Hippos presses 32. */
const journal = [
  workout("gators", [
    lift("Overhead press", 54.43, 1),
    lift("Split jerk", 57, 1),
    lift("Back squat", 65, 2),
    lift("Deadlift", 102, 3),
  ]),
  workout("hippos", [
    lift("Overhead press", 32, 1),
    lift("Back squat", 41, 2),
    lift("Deadlift", 71, 3),
  ]),
];

test("a percentile is the share of the field below, a tie counting half", () => {
  assert.equal(percentile(352, [300, 340, 352, 400, 500]), 50);
  assert.equal(percentile(200, [300, 340]), 0);
  assert.equal(percentile(600, [300, 340]), 100);
  assert.equal(percentile(340, [340, 340]), 50);
});

test("the field is every 2026 mixed Lite pair's Strength score, lowest first", () => {
  assert.equal(FIELD.season, 2026);
  assert.ok(FIELD.strength.length > 100);
  assert.ok(FIELD.events > 0);
  assert.ok(FIELD.strength.every((kg, i) => kg > 0 && (i === 0 || FIELD.strength[i - 1] <= kg)));
});

test("2026's Strength takes a strict press, a 3RM squat and a 5RM deadlift", () => {
  const gators = strengthPlan(journal, STRENGTH_2026).athletes.gators;
  // The jerk counts in 2027, not in a season that allowed no leg drive.
  assert.equal(gators.lifts.overhead?.name, "Overhead press");
  assert.equal(gators.lifts.overhead?.shown, 54);
  assert.equal(gators.lifts.squat?.shown, 63);
  assert.equal(gators.lifts.deadlift?.shown, 96);
  assert.equal(strengthPlan(journal).athletes.gators.lifts.overhead?.name, "Split jerk");
});

test("the pair is placed on 2026's lifts, and waits for a strict press", () => {
  // Hippos 32 + 40 + 67, Gators 54 + 63 + 96.
  const placed = strengthPlacing(journal, [300, 340, 352, 400, 500]);
  assert.equal(placed.total, 352);
  assert.equal(placed.percentile, 50);
  assert.equal(placed.ahead, 2);
  assert.equal(placed.pairs, 5);
  assert.equal(placed.median, 352);
  assert.deepEqual(placed.missing, []);

  const jerkOnly = strengthPlacing([
    workout("gators", [lift("Split jerk", 57, 1), lift("Back squat", 65, 2), lift("Deadlift", 102, 3)]),
    journal[1],
  ], [300, 400]);
  assert.equal(jerkOnly.total, null);
  assert.equal(jerkOnly.percentile, null);
  assert.deepEqual(jerkOnly.missing, [{ athlete: "gators", lift: "overhead" }]);
});
