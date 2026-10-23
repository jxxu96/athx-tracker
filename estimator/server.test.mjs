import { test } from "node:test";
import assert from "node:assert/strict";

// Importing used to start a listener; it exits on a short token, so this is
// set before the module is pulled in.
process.env.ESTIMATOR_TOKEN = "test-token-at-least-16-chars";
// The module reads estimator/.env, which is gitignored and whatever the
// machine happens to hold. These pin the numbers so the test is about the
// arithmetic and not about somebody's local configuration; a real environment
// variable wins over that file, which is what makes this work.
process.env.ESTIMATOR_BUDGET_MS = "40000";
process.env.ESTIMATOR_TIMEOUT_MS = "35000";
process.env.ESTIMATOR_RESERVE_MS = "9000";
const { budgetSlice, clean, parseCliOutput, structured } = await import("./server.mjs");

const whole = {
  name: "Chicken thigh rice bowl",
  calories: 780, protein: 46, carbs: 72, fat: 33,
  assumptions: "150 g cooked thigh, 200 g rice.",
  confidence: "medium",
};

test("a usable estimate survives intact", () => {
  assert.deepEqual(clean(whole), whole);
});

test("anything that is not an estimate is refused", () => {
  // Whatever a CLI prints arrives here, so nothing may be assumed about it.
  for (const junk of [null, undefined, 0, "", "text", [], {}, { name: "x" }]) {
    assert.equal(clean(junk), null, JSON.stringify(junk) ?? "undefined");
  }
});

test("a missing or impossible macro makes the whole thing unusable", () => {
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    assert.equal(clean({ ...whole, [key]: undefined }), null, `${key} missing`);
    assert.equal(clean({ ...whole, [key]: -1 }), null, `${key} negative`);
    assert.equal(clean({ ...whole, [key]: "many" }), null, `${key} not a number`);
    assert.equal(clean({ ...whole, [key]: Infinity }), null, `${key} infinite`);
    assert.equal(clean({ ...whole, [key]: 1e9 }), null, `${key} absurd`);
  }
});

test("an estimate with no name is not an estimate", () => {
  assert.equal(clean({ ...whole, name: "" }), null);
  assert.equal(clean({ ...whole, name: "   " }), null);
});

test("confidence it did not offer becomes the lowest", () => {
  for (const given of [undefined, "", "certain", "high-ish", 5]) {
    assert.equal(clean({ ...whole, confidence: given }).confidence, "low");
  }
  for (const given of ["low", "medium", "high"]) {
    assert.equal(clean({ ...whole, confidence: given }).confidence, given);
  }
});

test("overlong text is cut rather than carried", () => {
  const cleaned = clean({
    ...whole,
    name: "n".repeat(500),
    assumptions: "a".repeat(5000),
  });
  assert.equal(cleaned.name.length, 300);
  assert.equal(cleaned.assumptions.length, 3000);
});

test("numbers are rounded to something a label could say", () => {
  assert.equal(clean({ ...whole, calories: 780.46 }).calories, 780.5);
});

test("each CLI's wrapper is unwrapped, and bare output is taken as is", () => {
  const payload = { calories: 1 };
  assert.deepEqual(structured(JSON.stringify({ structuredOutput: payload })), payload);
  assert.deepEqual(structured(JSON.stringify({ structured_output: payload })), payload);
  assert.deepEqual(structured(JSON.stringify(payload)), payload);
});

test("output that is not JSON is not an estimate", () => {
  for (const junk of ["", "not json", "{", "<html>", "undefined"]) {
    assert.equal(structured(junk), null, junk);
    assert.equal(parseCliOutput(junk), null, junk);
  }
});

test("a status line in front of the JSON still yields the estimate", () => {
  const payload = { name: "Bowl", calories: 190, protein: 12, carbs: 13, fat: 10 };
  const raw = `working\n${JSON.stringify(payload)}\n`;
  assert.deepEqual(parseCliOutput(raw), payload);
  assert.deepEqual(parseCliOutput(JSON.stringify({ structured_output: payload })), payload);
});

test("whoever goes first leaves the fallback something to work with", () => {
  // The real failure: Grok led, took its whole slice, and left Claude too
  // little to finish in, so the budget burned and nobody answered.
  const first = budgetSlice(40000, false);
  const left = 40000 - first;
  assert.ok(first < 40000, "the leader cannot take the whole budget");
  assert.ok(left >= 9000, `the fallback was left ${left}ms`);
  // The last one may use whatever remains, there being nobody after it.
  assert.equal(budgetSlice(9000, true), 9000);
});

test("a provider is never given more than its own ceiling", () => {
  for (const remaining of [40000, 150000, 1_000_000]) {
    for (const isLast of [true, false]) {
      assert.ok(budgetSlice(remaining, isLast) <= 35000, `${remaining}/${isLast}`);
    }
  }
});
