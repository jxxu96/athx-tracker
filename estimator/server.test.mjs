import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Importing used to start a listener; it exits on a short token, so this is
// set before the module is pulled in.
process.env.ESTIMATOR_TOKEN = "test-token-at-least-16-chars";
// The module reads estimator/.env, which is gitignored and whatever the
// machine happens to hold. These pin the numbers so the test is about the
// arithmetic and not about somebody's local configuration; a real environment
// variable wins over that file, which is what makes this work.
process.env.ESTIMATOR_BUDGET_MS = "56000";
process.env.ESTIMATOR_TIMEOUT_MS = "49000";
process.env.ESTIMATOR_RESERVE_MS = "12600";
const {
  INSTRUCTIONS,
  MEAL_PROVIDER_MS,
  MEAL_RESERVE_MS,
  PROVIDERS,
  budgetSlice,
  clean,
  parseCliOutput,
  settle,
  structured,
} = await import("./server.mjs");
const { WORKOUT_TASK } = await import("./workout.mjs");

const whole = {
  name: "Chicken thigh rice bowl",
  calories: 780, protein: 46, carbs: 72, fat: 33, fiber: 0, alcohol: 0,
  assumptions: "150 g cooked thigh, 200 g rice.",
  confidence: "medium",
};

test("a usable estimate survives intact", () => {
  assert.deepEqual(clean(whole), whole);
});

test("the gateway preserves fiber, accepts an answer with none, and rejects fiber above carbs", () => {
  assert.equal(clean({ ...whole, fiber: 8.26 }).fiber, 8.3);
  assert.equal(clean({ ...whole, fiber: 72 }).fiber, 72);
  const { fiber: omitted, ...old } = whole;
  assert.equal(omitted, 0);
  assert.equal(clean(old).fiber, 0);
  assert.equal(clean({ ...whole, fiber: 80 }), null, "fiber above total carbs");
  assert.equal(clean({ ...whole, carbs: 10.04, fiber: 10.06 }), null, "rounding must not invent fiber");
  for (const fiber of [-1, Infinity, "many", 3001]) {
    assert.equal(clean({ ...whole, carbs: 3000, fiber }), null, String(fiber));
  }
});

test("the gateway preserves ethanol, accepts old responses and rejects invalid grams", () => {
  assert.equal(clean({ ...whole, alcohol: 14.56 }).alcohol, 14.6);
  const { alcohol: omitted, ...old } = whole;
  assert.equal(omitted, 0);
  assert.equal(clean(old).alcohol, 0);
  for (const alcohol of [-1, Infinity, "many", 501]) {
    assert.equal(clean({ ...whole, alcohol }), null);
  }
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
  const first = budgetSlice(56000, false);
  const left = 56000 - first;
  assert.ok(first < 56000, "the leader cannot take the whole budget");
  assert.ok(left >= 12600, `the fallback was left ${left}ms`);
  // The last one may use whatever remains, there being nobody after it.
  assert.equal(budgetSlice(12600, true), 12600);
  // What the app sends on a click: the cap, plus the reserve for whoever follows.
  assert.equal(budgetSlice(49000 + 12600, false), 49000);
});

test("a named product is looked up, and a workout is not", () => {
  assert.match(INSTRUCTIONS, /look that exact product up/);
  assert.match(INSTRUCTIONS, /do not estimate a named product by analogy/);
  assert.equal(INSTRUCTIONS.includes("no network access"), false);

  const mealCodex = PROVIDERS.codex.args("Fairlife Core Power");
  assert.ok(mealCodex.includes("--search"));
  assert.ok(mealCodex.indexOf("--search") < mealCodex.indexOf("exec"));

  const workoutCodex = PROVIDERS.codex.args("easy 5k", WORKOUT_TASK);
  assert.equal(workoutCodex.includes("--search"), false);

  const mealGrok = PROVIDERS.grok.args("Chobani flip");
  assert.equal(mealGrok.includes("--disable-web-search"), false);
  assert.equal(mealGrok[mealGrok.indexOf("--tools") + 1], "web_search,web_fetch");
  assert.equal(mealGrok[mealGrok.indexOf("--allow") + 1], "WebFetch");
  assert.equal(mealGrok[mealGrok.indexOf("--max-turns") + 1], "10");

  const workoutGrok = PROVIDERS.grok.args("easy 5k", WORKOUT_TASK);
  assert.ok(workoutGrok.includes("--disable-web-search"));
  assert.equal(workoutGrok[workoutGrok.indexOf("--tools") + 1], "");
  assert.equal(workoutGrok[workoutGrok.indexOf("--max-turns") + 1], "1");

  const mealClaude = PROVIDERS.claude.args("RxBar");
  assert.equal(mealClaude[mealClaude.indexOf("--tools") + 1], "WebSearch,WebFetch");
  assert.equal(mealClaude[mealClaude.indexOf("--allowedTools") + 1], "WebSearch,WebFetch");
  assert.equal(mealClaude[mealClaude.indexOf("--max-turns") + 1], "10");

  const workoutClaude = PROVIDERS.claude.args("easy 5k", WORKOUT_TASK);
  assert.equal(workoutClaude[workoutClaude.indexOf("--tools") + 1], "");
  assert.equal(workoutClaude.includes("WebSearch,WebFetch"), false);
  assert.equal(workoutClaude[workoutClaude.indexOf("--max-turns") + 1], "1");
});

test("a click leaves time to look a product up", () => {
  assert.equal(MEAL_PROVIDER_MS, 90_000);
  assert.equal(MEAL_RESERVE_MS, 40_000);
  const click = MEAL_PROVIDER_MS + MEAL_RESERVE_MS;
  assert.equal(budgetSlice(click, false, MEAL_PROVIDER_MS, MEAL_RESERVE_MS), MEAL_PROVIDER_MS);
  assert.equal(budgetSlice(MEAL_RESERVE_MS, true, MEAL_PROVIDER_MS, MEAL_RESERVE_MS), MEAL_RESERVE_MS);
  const route = readFileSync(
    new URL("../athx-tracker/app/api/estimate/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /90_000 \+ 40_000/);
});

test("a provider is never given more than its own ceiling", () => {
  for (const remaining of [56000, 210000, 1_000_000]) {
    for (const isLast of [true, false]) {
      assert.ok(budgetSlice(remaining, isLast) <= 49000, `${remaining}/${isLast}`);
    }
  }
});

const guess = (provider, calories, assumptions = `${provider} guessed.`, confidence = "low") => ({
  provider,
  estimate: {
    ...whole, calories, protein: calories / 20, carbs: calories / 10, fat: calories / 40, fiber: 2,
    assumptions, confidence,
  },
});

test("a label one estimator found is not averaged with guesses", () => {
  const label = guess("claude", 700, "Looked up.", "high");
  assert.deepEqual(settle([guess("codex", 600), label, guess("grok", 800)]), label);
  assert.deepEqual(settle([guess("codex", 600)]), guess("codex", 600));
});

test("guesses on the same footing are averaged, each one's working kept", () => {
  const { estimate, provider } = settle([guess("codex", 600), guess("claude", 700), guess("grok", 800)]);
  assert.equal(provider, "average");
  assert.deepEqual(
    [estimate.calories, estimate.protein, estimate.carbs, estimate.fat, estimate.fiber, estimate.confidence],
    [700, 35, 70, 17.5, 2, "low"],
  );
  assert.match(estimate.assumptions, /^Averaged from Codex, Claude and Grok: each was low confidence/);
  assert.match(estimate.assumptions, /\n\nFrom Claude \[700 kcal, 35P, 70C, 18F, 2 fiber\]:\nclaude guessed\./);
  assert.match(settle([guess("codex", 600), guess("grok", 800)]).estimate.assumptions, /^Averaged from Codex and Grok:/);
});

test("averaged working still fits the app's 3000 characters, whole items first", () => {
  const long = `Rice, 200 g [260 kcal, 5P, 57C, 0F]\nReference values.\n\n${"x".repeat(2900)}`;
  const { estimate } = settle(["codex", "claude", "grok"].map((name) => guess(name, 600, long)));
  assert.ok(estimate.assumptions.length <= 3000);
  for (const name of ["Codex", "Claude", "Grok"])
    assert.match(estimate.assumptions, new RegExp(`From ${name} [^\\n]*:\\nRice, 200 g \\[260 kcal, 5P, 57C, 0F\\]\\nReference values\\.…`));
});
