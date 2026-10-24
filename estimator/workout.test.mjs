import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKOUT_TASK } from "./workout.mjs";

process.env.ESTIMATOR_TOKEN = "test-token-at-least-16-chars";
process.env.ESTIMATOR_ORDER = "codex,claude";
const { estimate, PROVIDERS } = await import("./server.mjs");
const whole = {
  title: "Deadlift", category: "Strength", customCategory: "", notes: "", assumptions: "",
  elapsed: { hippos: null, gators: null }, stations: [],
  lifts: [{ name: "Deadlift", hippos: { kg: 83.91458845, sets: 1, reps: 2 },
    gators: { kg: null, sets: null, reps: null } }],
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
