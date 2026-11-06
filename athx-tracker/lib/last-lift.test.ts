import { test } from "node:test";
import assert from "node:assert/strict";
import { lastLift } from "./last-lift.ts";
import { DEFAULT_SETS, defaultReps } from "./exercises.ts";
import { formatLiftSets, type Workout } from "./domain.ts";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w", kind: "workout", athlete: "gators", day: "2026-11-04", title: "Lifts",
  category: "Strength", customCategory: "", seconds: 0, notes: "", segments: [],
  fatigue: 10, transition: 0, goal: null, context: "solo", lifts: [], ...over,
});
const lift = (name: string, kg: number, sets = 3, reps = 5) => ({ name, kg, sets, reps });

test("a chosen lift starts at three sets, and at the reps that lift is trained for", () => {
  assert.equal(DEFAULT_SETS, 3);
  assert.equal(defaultReps("Split jerk"), 1);
  assert.equal(defaultReps("Deadlift"), 3);
  assert.equal(defaultReps("Back squat"), 5);
  assert.equal(defaultReps("Bench press"), 5);
  assert.equal(defaultReps("Curls"), 5);
});

test("the last time is the newest session on or before the day, for that athlete only", () => {
  // Newest first, the way the journal holds them.
  const workouts = [
    workout({ id: "later", day: "2026-11-06", lifts: [lift("Back squat", 105)] }),
    workout({ id: "hers", athlete: "hippos", day: "2026-11-05", lifts: [lift("Back squat", 60)] }),
    workout({ id: "last", day: "2026-11-04", lifts: [lift("Deadlift", 140, 3, 3), lift("Back squat", 100)] }),
    workout({ id: "older", day: "2026-11-01", lifts: [lift("Back squat", 95)] }),
  ];
  assert.deepEqual(
    lastLift(workouts, "gators", "Back squat", { onOrBefore: "2026-11-05" }),
    { day: "2026-11-04", lift: lift("Back squat", 100) },
  );
  assert.equal(lastLift(workouts, "gators", "Back squat", { onOrBefore: "2026-11-06" })?.lift.kg, 105);
  assert.equal(lastLift(workouts, "hippos", "Back squat", { onOrBefore: "2026-11-06" })?.lift.kg, 60);
  assert.equal(lastLift(workouts, "gators", "Split jerk", { onOrBefore: "2026-11-06" }), null);
  assert.equal(lastLift(workouts, "gators", "", { onOrBefore: "2026-11-06" }), null);
});

test("the entry being edited and together sessions are never the last time", () => {
  const workouts = [
    workout({ id: "editing", day: "2026-11-06", lifts: [lift("Deadlift", 150, 1, 3)] }),
    workout({ id: "team", athlete: "team", day: "2026-11-05", lifts: [lift("Deadlift", 200, 1, 3)] }),
    workout({ id: "before", day: "2026-11-02", lifts: [lift("Deadlift", 140, 1, 3)] }),
  ];
  assert.equal(
    lastLift(workouts, "gators", "Deadlift", { onOrBefore: "2026-11-06", exclude: "editing" })?.lift.kg,
    140,
  );
});

test("a name typed under Other is the listed lift it spells", () => {
  const workouts = [workout({ lifts: [lift("back squat", 100)] })];
  assert.equal(lastLift(workouts, "gators", "Back squat", { onOrBefore: "2026-11-06" })?.lift.kg, 100);
  const custom = [workout({ lifts: [lift("Cable Fly", 20, 3, 12)] })];
  assert.equal(lastLift(custom, "gators", "cable fly", { onOrBefore: "2026-11-06" })?.lift.reps, 12);
});

test("a lift's sets read without its name", () => {
  assert.equal(formatLiftSets({ kg: 100, sets: 3, reps: 5 }, "kg"), "100 kg 3×5");
  assert.equal(
    formatLiftSets({ kg: 100, sets: 1, reps: 1, detail: [{ kg: 90, reps: 3 }, { kg: 100, reps: 1 }] }, "kg"),
    "90 kg×3, 100 kg×1",
  );
});
