import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKOUT_BURN_INSTRUCTIONS, WORKOUT_BURN_TASK, WORKOUT_INSTRUCTIONS, WORKOUT_TASK, bodyweightLine } from "./workout.mjs";

process.env.ESTIMATOR_TOKEN = "test-token-at-least-16-chars";
process.env.ESTIMATOR_ORDER = "codex,claude";
const { estimate, PROVIDERS } = await import("./server.mjs");
const whole = {
  title: "Deadlift", category: "Strength", customCategory: "", notes: "", assumptions: "",
  elapsed: { hippos: null, gators: null }, stations: [],
  lifts: [{ name: "Deadlift", hippos: { kg: 83.91458845, sets: 1, reps: 2, detail: [] },
    gators: { kg: null, sets: null, reps: null, detail: [] } }],
};

test("workout requests reject a meal-shaped answer and fall back to a usable workout", async () => {
  const original = { codex: { ...PROVIDERS.codex }, claude: { ...PROVIDERS.claude } };
  try {
    PROVIDERS.codex.bin = PROVIDERS.claude.bin = () => process.execPath;
    PROVIDERS.codex.args = () => ["-e", 'process.stdout.write(JSON.stringify({name:"rice",calories:100,protein:2,carbs:20,fat:1}))'];
    PROVIDERS.claude.args = () => ["-e", `process.stdout.write(${JSON.stringify(JSON.stringify({ structured_output: whole }))})`];
    const result = await estimate("Hippos deadlift 1 x 2 at 185 lb", 20000, WORKOUT_TASK);
    assert.equal(result.provider, "claude");
    assert.deepEqual(result.estimate, whole);
  } finally {
    Object.assign(PROVIDERS.codex, original.codex);
    Object.assign(PROVIDERS.claude, original.claude);
  }
});

test("a burn is asked for only with bodyweights, under its own schema file", () => {
  assert.notEqual(WORKOUT_BURN_TASK.name, WORKOUT_TASK.name);
  assert.equal("burn" in WORKOUT_TASK.schema.properties, false);
  assert.deepEqual(WORKOUT_BURN_TASK.schema.required, [...WORKOUT_TASK.schema.required, "burn"]);
  assert.ok(WORKOUT_INSTRUCTIONS.endsWith("Output only the required JSON."));
  assert.ok(WORKOUT_BURN_INSTRUCTIONS.endsWith("Output only the required JSON."));
  assert.ok(WORKOUT_BURN_INSTRUCTIONS.includes("MET x 3.5 x bodyweight in kg / 200 per minute"));
  assert.equal(WORKOUT_INSTRUCTIONS.includes("burn"), false);
});

test("each athlete's burn is whole kcal or null, and a draft without one is not a burn answer", () => {
  const burned = { ...whole, burn: { hippos: 180, gators: null } };
  assert.deepEqual(WORKOUT_BURN_TASK.clean(burned), burned);
  assert.equal(WORKOUT_BURN_TASK.clean(whole), null);
  assert.equal(WORKOUT_TASK.clean(burned), null);
  for (const hippos of [0, 182.5, 20001, -10, "180"])
    assert.equal(WORKOUT_BURN_TASK.clean({ ...whole, burn: { hippos, gators: null } }), null, String(hippos));
});

test("the estimator is told each selected athlete's weight, or that there is none", () => {
  assert.equal(bodyweightLine(["hippos", "gators"], { hippos: 82.345, gators: 64 }),
    "Bodyweight on the session's day: hippos 82.3 kg, gators 64 kg.");
  assert.equal(bodyweightLine(["gators"], {}), "Bodyweight on the session's day: gators not given.");
  assert.equal(bodyweightLine(["hippos", "gators"], { hippos: 0, gators: "heavy" }),
    "Bodyweight on the session's day: hippos not given, gators not given.");
  assert.equal(bodyweightLine(["hippos"], { hippos: 900 }), "Bodyweight on the session's day: hippos not given.");
});

test("two numbers joined by x are reps x weight, and three are sets x reps x weight", () => {
  assert.ok(WORKOUT_INSTRUCTIONS.includes("Two numbers are reps x weight, one set"));
  assert.ok(WORKOUT_INSTRUCTIONS.includes("Three numbers are sets x reps x weight"));
  assert.equal(WORKOUT_INSTRUCTIONS.includes("sets first, reps second"), false);
  assert.equal(WORKOUT_INSTRUCTIONS.includes("above 50"), false);
});
