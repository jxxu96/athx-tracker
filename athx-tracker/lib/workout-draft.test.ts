import assert from "node:assert/strict";
import { test } from "node:test";
import { workoutDraftSchema, type WorkoutDraft } from "./workout-draft.ts";
// The app image's build context excludes its sibling estimator directory.
// Resolve this test-only module at runtime, as the meal schema parity test does.
const { cleanWorkout } = await import(new URL("../../estimator/workout.mjs", import.meta.url).href);

const emptyLift = { kg: null, sets: null, reps: null };
const emptyStation = { completed: null, seconds: null, kg: null };
const base: WorkoutDraft = {
  title: "Deadlift and run", category: "Mixed", customCategory: "", notes: "", assumptions: "",
  elapsed: { hippos: 1800, gators: null },
  lifts: [{ name: "Deadlift", hippos: { kg: 185 * 0.45359237, sets: 1, reps: 2 }, gators: emptyLift }],
  stations: [{ name: "Run", unit: "m", target: 1609.344, block: "endurance",
    hippos: { completed: 1609.344, seconds: 600, kg: null }, gators: emptyStation }],
};

test("workout drafts preserve 1 set of 2 reps, converted weights and unknown athlete values", () => {
  assert.deepEqual(workoutDraftSchema.parse(base), base);
  assert.deepEqual(cleanWorkout(base), base);
});

test("missing lift results remain null and repeated exercises keep their distinct sets", () => {
  const draft = { ...base, lifts: [base.lifts[0],
    { name: "Deadlift", hippos: { kg: null, sets: 3, reps: 8 }, gators: emptyLift }] };
  assert.deepEqual(workoutDraftSchema.parse(draft), draft);
  assert.deepEqual(cleanWorkout(draft), draft);
});

test("app and CLI reject impossible or hidden workout fields consistently", () => {
  const invalid = [
    { ...base, extra: true },
    { ...base, category: "Endurance" },
    { ...base, category: "Strength" },
    { ...base, title: " " },
    { ...base, elapsed: { hippos: -1, gators: null } },
    { ...base, elapsed: { hippos: 100, gators: null } },
    { ...base, lifts: [{ ...base.lifts[0], hippos: { kg: 50, sets: 1.5, reps: 2 } }] },
    { ...base, lifts: [{ ...base.lifts[0], hippos: { kg: 1001, sets: 1, reps: 2 } }] },
    { ...base, lifts: [{ ...base.lifts[0], hippos: { kg: 10, sets: 51, reps: 2 } }] },
    { ...base, lifts: [{ ...base.lifts[0], hippos: { kg: 10, sets: 1, reps: 101 } }] },
    { ...base, lifts: Array.from({ length: 31 }, () => base.lifts[0]) },
    ...[
      { target: 0 }, { target: 100 },
      { hippos: { completed: 0, seconds: 60, kg: null } },
      { hippos: { completed: 100, seconds: 60, kg: 10 } },
    ].map(patch => ({ ...base, stations: [{ ...base.stations[0], ...patch }] })),
  ];
  for (const draft of invalid) {
    assert.equal(workoutDraftSchema.safeParse(draft).success, false, JSON.stringify(draft));
    assert.equal(cleanWorkout(draft), null, JSON.stringify(draft));
  }
});
