import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  fillQueuedMeal,
  nextRetryDelay,
} from "./queue-rules.ts";
import type { Meal } from "./domain.ts";

const queued = (over: Partial<Meal> = {}): Meal => ({
  id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1234", kind: "meal", athlete: "gators",
  day: "2026-10-22", name: "", meal: "Lunch",
  macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  source: "queued", assumptions: "chicken thigh rice bowl", ...over,
});

const estimate = {
  name: "Chicken thigh rice bowl", calories: 780, protein: 46, carbs: 72, fat: 33,
  assumptions: "Assumed 150 g cooked thigh.",
};

test("an estimate that arrives fills the meal in", () => {
  const filled = fillQueuedMeal(queued(), estimate);
  assert.deepEqual(filled.macros, { calories: 780, protein: 46, carbs: 72, fat: 33 });
  assert.equal(filled.name, estimate.name);
  assert.equal(filled.assumptions, estimate.assumptions);
  assert.equal(filled.source, "grok", "no longer waiting");
});

test("a name you gave it is not overwritten by one it guessed", () => {
  assert.equal(fillQueuedMeal(queued({ name: "Post-session bowl" }), estimate).name,
    "Post-session bowl");
  assert.equal(fillQueuedMeal(queued({ name: "   " }), estimate).name, estimate.name,
    "but blank is blank");
});

test("everything identifying the meal survives the fill", () => {
  const before = queued({ day: "2026-10-01", meal: "Dinner", athlete: "hippos" });
  const after = fillQueuedMeal(before, estimate);
  for (const key of ["id", "kind", "day", "meal", "athlete"] as const) {
    assert.equal(after[key], before[key], key);
  }
});

test("a quiet queue is not a failing one", () => {
  assert.equal(nextRetryDelay(RETRY_MAX_MS, { filled: 0, waiting: 0 }), RETRY_MIN_MS);
});

test("getting one through means the estimator is back", () => {
  assert.equal(nextRetryDelay(RETRY_MAX_MS, { filled: 1, waiting: 4 }), RETRY_MIN_MS);
});

test("work that is not getting done slows the retries down", () => {
  let wait = RETRY_MIN_MS;
  const seen = [wait];
  for (let i = 0; i < 8; i += 1) {
    wait = nextRetryDelay(wait, { filled: 0, waiting: 3 });
    seen.push(wait);
  }
  assert.deepEqual(seen.slice(0, 5), [
    RETRY_MIN_MS, 4 * 60_000, 8 * 60_000, 16 * 60_000, RETRY_MAX_MS,
  ]);
  assert.equal(wait, RETRY_MAX_MS, "and stops there rather than growing forever");
});

test("a drain that threw is treated as work not getting done", () => {
  assert.equal(nextRetryDelay(RETRY_MIN_MS, "failed"), 4 * 60_000);
  assert.equal(nextRetryDelay(RETRY_MAX_MS, "failed"), RETRY_MAX_MS);
});

test("the wait is never longer than the ceiling or shorter than the floor", () => {
  const outcomes = [
    { filled: 0, waiting: 0 }, { filled: 0, waiting: 1 },
    { filled: 2, waiting: 0 }, { filled: 2, waiting: 2 }, "failed",
  ] as const;
  for (const start of [RETRY_MIN_MS, 7 * 60_000, RETRY_MAX_MS, RETRY_MAX_MS * 4]) {
    for (const outcome of outcomes) {
      const next = nextRetryDelay(start, outcome);
      assert.ok(next >= RETRY_MIN_MS && next <= RETRY_MAX_MS, `${start} ${JSON.stringify(outcome)} -> ${next}`);
    }
  }
});
