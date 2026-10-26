import assert from "node:assert/strict";
import { test } from "node:test";
import { workoutDraftSchema, type WorkoutDraft } from "./workout-draft.ts";
// The app image's build context excludes its sibling estimator directory.
// Resolve this test-only module at runtime, as the meal schema parity test does.
const { cleanWorkout } = await import(new URL("../../estimator/workout.mjs", import.meta.url).href);

const emptyLift = { kg: null, sets: null, reps: null, detail: [] };
const emptyStation = { completed: null, seconds: null, kg: null };
const base: WorkoutDraft = {
  title: "Deadlift and run", category: "Mixed", customCategory: "", notes: "", assumptions: "",
  elapsed: { hippos: 1800, gators: null },
  lifts: [{ name: "Deadlift", hippos: { kg: 185 * 0.45359237, sets: 1, reps: 2, detail: [] }, gators: emptyLift }],
  stations: [{ name: "Run", unit: "m", target: 1609.344, block: "endurance",
    hippos: { completed: 1609.344, seconds: 600, kg: null }, gators: emptyStation }],
};

test("a run keeps the unit it was stated in", () => {
  const miles = { ...base, category: "Endurance" as const, lifts: [],
    stations: [{ name: "Run", unit: "mi" as const, target: 3, block: "endurance" as const,
      hippos: { completed: 3, seconds: 1440, kg: null }, gators: emptyStation }] };
  assert.equal(workoutDraftSchema.safeParse(miles).success, true);
  assert.deepEqual(cleanWorkout(miles), miles);
  const kilometres = { ...miles, stations: [{ ...miles.stations[0], unit: "km" as const, target: 5,
    hippos: { completed: 5, seconds: 1500, kg: null } }] };
  assert.deepEqual(cleanWorkout(kilometres), kilometres);
});

test("workout drafts preserve 1 set of 2 reps, converted weights and unknown athlete values", () => {
  assert.deepEqual(workoutDraftSchema.parse(base), base);
  assert.deepEqual(cleanWorkout(base), base);
});

test("missing lift results remain null and repeated exercises keep their distinct sets", () => {
  const draft = { ...base, lifts: [base.lifts[0],
    { name: "Deadlift", hippos: { kg: null, sets: 3, reps: 8, detail: [] }, gators: emptyLift }] };
  assert.deepEqual(workoutDraftSchema.parse(draft), draft);
  assert.deepEqual(cleanWorkout(draft), draft);
});

test("sets that differ come back one by one, with what was not said left empty", () => {
  const ramp = { ...base, lifts: [{ name: "Back squat", gators: emptyLift, hippos: {
    kg: null, sets: null, reps: null,
    detail: [{ kg: 60, reps: 5 }, { kg: 80, reps: 3 }, { kg: 100, reps: 1 }, { kg: null, reps: 1 }, { kg: 100, reps: null }],
  } }] };
  assert.deepEqual(workoutDraftSchema.parse(ramp), ramp);
  assert.deepEqual(cleanWorkout(ramp), ramp);
});

test("the app still reads a draft from an estimator that predates set detail", () => {
  const older = { ...base, lifts: [{ name: "Deadlift",
    hippos: { kg: 185 * 0.45359237, sets: 1, reps: 2 }, gators: { kg: null, sets: null, reps: null } }] };
  assert.deepEqual(workoutDraftSchema.parse(older), older);
  // The CLI is held to the whole schema, so a current estimator always says.
  assert.equal(cleanWorkout(older), null);
});

test("app and CLI reject impossible or hidden workout fields consistently", () => {
  const invalid = [
    { ...base, extra: true },
    { ...base, category: "Endurance" },
    { ...base, category: "Strength" },
    { ...base, title: " " },
    { ...base, elapsed: { hippos: -1, gators: null } },
    { ...base, elapsed: { hippos: 100, gators: null } },
    ...[
      { kg: 50, sets: 1.5, reps: 2 }, { kg: 1001, sets: 1, reps: 2 },
      { kg: 10, sets: 51, reps: 2 }, { kg: 10, sets: 1, reps: 101 },
      { detail: [{ kg: 60, reps: 0 }] }, { detail: [{ kg: 60, reps: 1.5 }] },
      { detail: [{ kg: 60, reps: 101 }] }, { detail: [{ kg: 0, reps: 5 }] },
      { detail: [{ kg: 1001, reps: 5 }] }, { detail: [{ kg: 60, reps: 5, sets: 1 }] },
      { detail: Array.from({ length: 51 }, () => ({ kg: 60, reps: 5 })) }, { detail: null },
    ].map(patch => ({ ...base, lifts: [{ ...base.lifts[0], hippos: { ...base.lifts[0].hippos, ...patch } }] })),
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
