import { test } from "node:test";
import assert from "node:assert/strict";
import { recordSchema, settingsSchema, workoutSchema } from "./validation.ts";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

const workout = (over: Record<string, unknown> = {}) => ({
  id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1234",
  kind: "workout", athlete: "gators", day: "2026-10-22",
  title: "Session", category: "MetCon", seconds: 1800, notes: "",
  segments: [], fatigue: 10, transition: 0, goal: null,
  context: "pairs", lifts: [], ...over,
});

const station = (over: Record<string, unknown> = {}) => ({
  name: "Opening row", unit: "cal", completed: 40, target: 40, seconds: 120, ...over,
});

test("a session may be logged without an elapsed time", () => {
  assert.ok(ok(workoutSchema, workout({ seconds: 0 })));
  assert.ok(!ok(workoutSchema, workout({ seconds: -1 })), "negative is not absent");
  assert.ok(!ok(workoutSchema, workout({ seconds: 90000 })), "over a day");
});

test("a station may record work without a time", () => {
  assert.ok(
    ok(workoutSchema, workout({ seconds: 0, segments: [station({ seconds: 0 })] })),
    "reps you did not time are still reps you did",
  );
});

test("a station time still needs work to go with it", () => {
  assert.ok(
    !ok(workoutSchema, workout({ segments: [station({ completed: 0, seconds: 30 })] })),
    "a pace needs both halves",
  );
});

test("stations cannot outlast the workout they belong to", () => {
  assert.ok(!ok(workoutSchema, workout({ seconds: 100, segments: [station({ seconds: 500 })] })));
  assert.ok(ok(workoutSchema, workout({ seconds: 500, segments: [station({ seconds: 100 })] })));
});

test("with no elapsed time there is nothing for stations to exceed", () => {
  assert.ok(
    ok(workoutSchema, workout({ seconds: 0, segments: [station({ seconds: 500 })] })),
    "the check applies only when a time was given",
  );
});

test("completed work cannot exceed its target", () => {
  assert.ok(!ok(workoutSchema, workout({ segments: [station({ completed: 50, target: 40 })] })));
});

test("every session type the form offers is accepted", () => {
  for (const category of ["Strength", "Endurance", "MetCon", "Solidcore", "Tennis", "Other"]) {
    assert.ok(ok(workoutSchema, workout({ category })), category);
  }
  assert.ok(!ok(workoutSchema, workout({ category: "Pilates" })));
});

test("dates must be real days", () => {
  assert.ok(!ok(recordSchema, workout({ day: "2026-02-30" })), "February has no 30th");
  assert.ok(!ok(recordSchema, workout({ day: "2026-13-01" })), "no month 13");
  assert.ok(!ok(recordSchema, workout({ day: "22-10-2026" })), "wrong order");
  assert.ok(ok(recordSchema, workout({ day: "2028-02-29" })), "2028 is a leap year");
});

test("unknown fields are refused rather than quietly stored", () => {
  assert.ok(!ok(recordSchema, workout({ sneaky: "value" })));
});

test("a meal needs an athlete who eats", () => {
  const meal = {
    id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1234", kind: "meal", athlete: "gators",
    day: "2026-10-22", name: "Oats", meal: "Breakfast",
    macros: { calories: 400, protein: 20, carbs: 50, fat: 10 },
    source: "manual", assumptions: "",
  };
  assert.ok(ok(recordSchema, meal));
  assert.ok(!ok(recordSchema, { ...meal, athlete: "team" }), "team does not eat");
  assert.ok(ok(recordSchema, { ...meal, source: "queued" }), "queued is a real source");
  assert.ok(!ok(recordSchema, { ...meal, macros: { ...meal.macros, protein: -1 } }));
});

test("settings saved before bodyweight existed still parse", () => {
  const legacy = {
    eventDate: "2027-08-28", eventName: "ATHX New York", weeklyTarget: 4,
    weightUnit: "lb",
    targets: {
      hippos: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      gators: { calories: 2500, protein: 165, carbs: 280, fat: 80 },
    },
  };
  const parsed = settingsSchema.safeParse(legacy);
  assert.ok(parsed.success, "a missing bodyweight must not lock anyone out");
  assert.deepEqual(parsed.data!.bodyweight, { hippos: 0, gators: 0 });
});

test("settings reject nonsense bodyweights", () => {
  const base = settingsSchema.parse({
    eventDate: "2027-08-28", eventName: "ATHX", weeklyTarget: 4, weightUnit: "lb",
    targets: {
      hippos: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      gators: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    },
  });
  assert.ok(ok(settingsSchema, { ...base, bodyweight: { hippos: 0, gators: 84 } }));
  assert.ok(!ok(settingsSchema, { ...base, bodyweight: { hippos: -1, gators: 84 } }));
  assert.ok(!ok(settingsSchema, { ...base, bodyweight: { hippos: 0, gators: 900 } }));
});
