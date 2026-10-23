import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateSchema,
  recordSchema,
  settingsSchema,
  workoutSchema,
} from "./validation.ts";

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

test("the schema cannot permit a record the server would refuse to read", () => {
  // readBody stops at 64 KB. These two limits were set in different files on
  // different days and nothing connects them, so if a max length is raised
  // later the save fails as "Request too large" with nothing on the form
  // looking wrong. This is the thread between them.
  const MAX_BODY_BYTES = 64_000;
  const fill = (n: number, c: string) => c.repeat(n);

  const biggestWorkout = {
    id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1234",
    kind: "workout", athlete: "gators", day: "2026-10-22",
    title: fill(120, "T"), category: "Other", customCategory: fill(60, "C"),
    seconds: 86400, notes: fill(2000, "N"),
    segments: Array.from({ length: 30 }, () => ({
      name: fill(100, "S"), unit: "reps", completed: 30, target: 30, seconds: 120,
    })),
    fatigue: 50, transition: 3600, goal: 86400, context: "pairs",
    lifts: Array.from({ length: 30 }, () => ({
      name: fill(80, "L"), kg: 1000, sets: 50, reps: 100,
    })),
  };

  const biggestMeal = {
    id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1235",
    kind: "meal", athlete: "gators", day: "2026-10-22",
    name: fill(300, "M"), meal: "Lunch",
    macros: { calories: 20000, protein: 2000, carbs: 3000, fat: 2000 },
    source: "grok", assumptions: fill(3000, "A"),
  };

  // The sizes above are the schema's limits, so these prove they still are.
  // Raise one and this fails here, where the reason it matters is written down,
  // rather than later as a save that will not go through.
  const over = (record: object, patch: object) =>
    recordSchema.safeParse({ ...record, ...patch }).success;
  assert.ok(!over(biggestWorkout, { title: fill(121, "T") }), "title limit moved");
  assert.ok(!over(biggestWorkout, { notes: fill(2001, "N") }), "notes limit moved");
  assert.ok(
    !over(biggestWorkout, { customCategory: fill(61, "C") }),
    "custom category limit moved",
  );
  assert.ok(
    !over(biggestWorkout, {
      segments: [
        ...biggestWorkout.segments,
        { name: "x", unit: "reps", completed: 1, target: 1, seconds: 1 },
      ],
    }),
    "station count limit moved",
  );
  assert.ok(
    !over(biggestWorkout, {
      lifts: [...biggestWorkout.lifts, { name: "x", kg: 1, sets: 1, reps: 1 }],
    }),
    "lift count limit moved",
  );
  assert.ok(!over(biggestMeal, { name: fill(301, "M") }), "meal name limit moved");
  assert.ok(
    !over(biggestMeal, { assumptions: fill(3001, "A") }),
    "assumptions limit moved",
  );

  for (const [what, record] of [
    ["workout", biggestWorkout],
    ["meal", biggestMeal],
  ] as const) {
    assert.ok(
      recordSchema.safeParse(record).success,
      `the largest legal ${what} must actually be legal`,
    );
    const bytes = Buffer.byteLength(JSON.stringify(record));
    assert.ok(
      bytes < MAX_BODY_BYTES,
      `the largest legal ${what} is ${bytes} bytes, past the ${MAX_BODY_BYTES} the server reads`,
    );
  }
});

test("the app and the estimator describe an estimate the same way", async () => {
  // The estimator ships on its own and states this shape as JSON Schema, so it
  // cannot import anything from here. Nothing kept the two in step, which is
  // how the direct API path spent a while asking a different question from the
  // one the estimator was asking.
  const { SCHEMA } = await import("../../estimator/server.mjs");
  const { foodFormat } = await import("./grok.ts");

  assert.deepEqual(
    SCHEMA.required,
    foodFormat.schema.required,
    "the two JSON schemas require different fields",
  );

  const base = {
    name: "x", assumptions: "", confidence: "low",
    calories: 0, protein: 0, carbs: 0, fat: 0,
  };
  for (const field of ["calories", "protein", "carbs", "fat"] as const) {
    const ceiling = SCHEMA.properties[field].maximum;
    assert.equal(
      ceiling,
      foodFormat.schema.properties[field].maximum,
      `${field}: the two JSON schemas disagree`,
    );
    assert.ok(
      estimateSchema.safeParse({ ...base, [field]: ceiling }).success,
      `${field}: the app rejects what the estimator is allowed to send`,
    );
    assert.ok(
      !estimateSchema.safeParse({ ...base, [field]: ceiling + 1 }).success,
      `${field}: the app accepts more than the estimator may send`,
    );
  }

  assert.deepEqual(
    SCHEMA.properties.confidence.enum,
    foodFormat.schema.properties.confidence.enum,
    "the two offer different confidences",
  );
  for (const level of SCHEMA.properties.confidence.enum) {
    assert.ok(
      estimateSchema.safeParse({ ...base, confidence: level }).success,
      `the app rejects confidence "${level}", which the estimator may send`,
    );
  }
});
