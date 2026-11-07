import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

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
  DISH_INSTRUCTIONS,
  DISH_SCHEMA,
  DISH_TASK,
  INSTRUCTIONS,
  MEAL_PROVIDER_MS,
  MEAL_RESERVE_MS,
  PROVIDERS,
  budgetSlice,
  clean,
  cleanDishes,
  complex,
  describedFor,
  failure,
  parseCliOutput,
  providerSlice,
  settle,
  settleDishes,
  structured,
} = await import("./server.mjs");
const { WORKOUT_TASK } = await import("./workout.mjs");

const SCHEMA_REQUIRED = ["name", "calories", "protein", "carbs", "fat", "fiber", "alcohol", "assumptions", "confidence"];
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

test("an envelope with no structured field gives up the answer in its final text", () => {
  const meal = { ...whole };
  // Every turn's text joined into one, the answer after the narration.
  const searched = `I'll look up the label first.Found it on the maker's page.${JSON.stringify(meal)}`;
  assert.deepEqual(parseCliOutput(JSON.stringify({ type: "result", result: searched })), meal);
  assert.deepEqual(parseCliOutput(JSON.stringify({ text: JSON.stringify(meal) })), meal);
  // A structured field that came back as a string.
  assert.deepEqual(parseCliOutput(JSON.stringify({ structuredOutput: JSON.stringify(meal) })), meal);
  // Streamed frames, one per line: the answer is in the last one.
  const frames = [
    { type: "system", subtype: "init" },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Searching." }] } },
    { type: "result", result: "", structuredOutput: meal },
  ].map((frame) => JSON.stringify(frame)).join("\n");
  assert.deepEqual(parseCliOutput(frames), meal);
  // A shared meal keeps its dishes on the way out.
  const dinner = shared([dish("pizza", 880), dish("salad", 420)]);
  const unwrapped = parseCliOutput(JSON.stringify({ result: `Checked both.\n${JSON.stringify(dinner)}` }));
  assert.deepEqual(unwrapped.dishes.map((each) => each.name), ["pizza", "salad"]);
  // An envelope with nothing usable inside is still refused.
  assert.equal(clean(parseCliOutput(JSON.stringify({ type: "result", result: "Not signed in." }))), null);
  // A bare answer is taken as it is.
  assert.deepEqual(parseCliOutput(JSON.stringify(meal)), meal);
});

test("Grok runs a meal at low effort, off Claude Code's and Cursor's setup, with no memory", () => {
  const isolation = {
    GROK_CLAUDE_RULES_ENABLED: "false",
    GROK_CLAUDE_SKILLS_ENABLED: "false",
    GROK_CLAUDE_AGENTS_ENABLED: "false",
    GROK_CLAUDE_MCPS_ENABLED: "false",
    GROK_CLAUDE_HOOKS_ENABLED: "false",
    GROK_CURSOR_RULES_ENABLED: "false",
    GROK_CURSOR_SKILLS_ENABLED: "false",
    GROK_CURSOR_AGENTS_ENABLED: "false",
    GROK_CURSOR_MCPS_ENABLED: "false",
    GROK_CURSOR_HOOKS_ENABLED: "false",
    GROK_MEMORY: "0",
  };
  // The overlay key and value the Grok CLI documents for reasoning effort.
  const low = JSON.stringify({ models: { default_reasoning_effort: "low" } });
  assert.deepEqual(PROVIDERS.grok.env(), { ...isolation, GROK_CONFIG: low });
  assert.deepEqual(PROVIDERS.grok.env(DISH_TASK), { ...isolation, GROK_CONFIG: low });
  // A workout keeps the model's own effort.
  assert.deepEqual(PROVIDERS.grok.env(WORKOUT_TASK), isolation);
  // Only Grok has settings of its own.
  assert.equal(PROVIDERS.codex.env, undefined);
  assert.equal(PROVIDERS.claude.env, undefined);
});

test("Grok works in an empty folder outside this repository", () => {
  for (const task of [undefined, DISH_TASK, WORKOUT_TASK]) {
    const args = PROVIDERS.grok.args("pizza, salad", task);
    const folder = args[args.indexOf("--cwd") + 1];
    assert.ok(statSync(folder).isDirectory(), folder);
    const repository = dirname(dirname(fileURLToPath(import.meta.url)));
    const inside = relative(repository, folder);
    assert.ok(inside.startsWith("..") || isAbsolute(inside), `${folder} is inside ${repository}`);
  }
});

test("a reply asks each provider to continue from its own last answer", () => {
  const average = { ...whole, calories: 646.7, assumptions: "Weighted average." };
  const reply = JSON.stringify({ mealDescription: "rice bowl", previousEstimate: average, replies: ["and a beer"] });
  const own = { codex: { ...whole, calories: 600 }, claude: { ...whole, calories: 700 } };
  const codex = describedFor(reply, own, "codex");
  // Only the previous estimate changes, in its place, and the rest as it was.
  assert.equal(codex, JSON.stringify({ mealDescription: "rice bowl", previousEstimate: own.codex, replies: ["and a beer"] }));
  assert.equal(JSON.parse(describedFor(reply, own, "claude")).previousEstimate.calories, 700);
  // Nobody sent for Grok, no answers at all, or one that is not an answer: the average.
  assert.equal(describedFor(reply, own, "grok"), reply);
  assert.equal(describedFor(reply, undefined, "codex"), reply);
  assert.equal(describedFor(reply, { codex: "600" }, "codex"), reply);
  assert.equal(describedFor(reply, { codex: [whole] }, "codex"), reply);
  // Not a reply: a first estimate is left as it came, notes and all.
  assert.equal(describedFor("rice bowl", own, "codex"), "rice bowl");
  const notes = JSON.stringify({ mealDescription: "rice bowl", foodNotes: "rice is jasmine" });
  assert.equal(describedFor(notes, own, "codex"), notes);
});

test("a timeout says what the CLI last printed", () => {
  assert.equal(
    failure({ timedOut: true, code: null, out: "", err: "warning: one\nrate limit exceeded; sleeping.\n\n" }, 130_000),
    "timed out after 130 s, last said: rate limit exceeded; sleeping.",
  );
  // Nothing on stderr: the last line of stdout, then nothing at all.
  assert.equal(failure({ timedOut: true, code: null, out: "Searching.\r\n", err: "" }, 89_600), "timed out after 90 s, last said: Searching.");
  assert.equal(failure({ timedOut: true, code: null, out: "", err: "  \n" }, 130_000), "timed out after 130 s");
  assert.equal(failure({ timedOut: true, code: null, out: undefined, err: undefined }, 130_000), "timed out after 130 s");
  // A long line is cut, so the reason still fits what the form shows.
  const said = failure({ timedOut: true, code: null, out: "", err: "x".repeat(500) }, 130_000);
  assert.equal(said, `timed out after 130 s, last said: ${"x".repeat(160)}`);
  // An exit is reported as before.
  assert.equal(failure({ timedOut: false, code: 1, out: "", err: "Not signed in.\n" }, 130_000), "exit 1 Not signed in.");
});

test("output that is not JSON is not an estimate", () => {
  for (const junk of ["", "not json", "{", "<html>", "undefined"]) {
    assert.equal(structured(junk), null, junk);
    assert.equal(parseCliOutput(junk), null, junk);
  }
});

test("a status line in front of a shared meal still yields the whole meal, not its last dish", () => {
  const meal = shared([dish("pizza", 880), dish("salad", 420)]);
  for (const raw of [
    `codex: done\n${JSON.stringify(meal)}`,
    `status {not json}\n${JSON.stringify(meal, null, 2)}\n`,
  ]) {
    const parsed = parseCliOutput(raw);
    assert.equal(parsed?.name, "Dinner", raw.slice(0, 20));
    assert.deepEqual(parsed.dishes.map((each) => each.name), ["pizza", "salad"]);
  }
  // Cut off, what is left whole is not a usable answer.
  assert.equal(cleanDishes(parseCliOutput("codex: done\n{\"dishes\":[{\"name\":\"pizza\"}")), null);
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
  // web_search alone: it opens pages itself, and a fetched page costs a round.
  assert.equal(mealGrok[mealGrok.indexOf("--tools") + 1], "web_search");
  assert.equal(mealGrok.includes("--allow"), false);
  assert.equal(mealGrok.some((arg) => /web_?fetch/i.test(arg)), false);
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

test("a click leaves time to look a product up, and a fallback time to search", () => {
  assert.equal(MEAL_PROVIDER_MS, 90_000);
  assert.equal(MEAL_RESERVE_MS, 40_000);
  const click = MEAL_PROVIDER_MS + MEAL_RESERVE_MS;
  assert.equal(budgetSlice(click, false, MEAL_PROVIDER_MS, MEAL_RESERVE_MS), MEAL_PROVIDER_MS);
  assert.equal(budgetSlice(MEAL_RESERVE_MS, true, MEAL_PROVIDER_MS, MEAL_RESERVE_MS), MEAL_RESERVE_MS);
  // In order, the first meal estimator gets the cap and leaves the reserve.
  assert.equal(providerSlice(click, { meal: true, isLast: false }), MEAL_PROVIDER_MS);
  assert.equal(providerSlice(click, { meal: true, isLast: true }), MEAL_PROVIDER_MS);
  // Asked at once nobody is after them, so each gets all of what is left:
  // Grok's search is no longer cut off at 90 s with 40 s of the click unused.
  assert.equal(providerSlice(click, { meal: true, isLast: true, together: true }), click);
  assert.equal(providerSlice(70_000, { meal: true, isLast: true, together: true }), 70_000);
  // The background queue's budget, likewise.
  assert.equal(providerSlice(210_000, { meal: true, isLast: true, together: true }), 210_000);
  const route = readFileSync(
    new URL("../athx-tracker/app/api/estimate/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /INTERACTIVE_BUDGET_MS = 90_000 \+ 40_000;/);
});

test("a link or three items make a meal complex", () => {
  for (const meal of [
    "https://www.chick-fil-a.com/menu/chick-fil-a-chicken-sandwich",
    "www.sweetgreen.com harvest bowl",
    "Two eggs, 80 g oats with milk, banana, flat white",
    "burrito bowl with chicken, rice and beans",
    JSON.stringify({ mealDescription: "eggs, toast, coffee", replies: ["no butter"] }),
  ])
    assert.equal(complex(meal), true, meal);
  for (const meal of [
    "banana",
    "Chicken and rice",
    "Chipotle chicken burrito bowl",
    "mac and cheese",
    // Notes list foods too, and are not the meal.
    JSON.stringify({ mealDescription: "banana", foodNotes: "yogurt, berries, granola" }),
  ])
    assert.equal(complex(meal), false, meal);
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

test("every answer counts unless two found the label, when one that could not find it is left out", () => {
  const label = (provider, calories) => guess(provider, calories, "Looked up.", "high");
  const providers = (answers) => {
    const settled = settle(answers);
    return settled.provider === "average"
      ? [...settled.estimate.assumptions.matchAll(/^From (\w+)/gm)].map(([, name]) => name.toLowerCase())
      : [settled.provider];
  };
  // Two labels and a guess: the guess is out, and the labels share as their weights do.
  const two = settle([label("codex", 600), label("claude", 700), guess("grok", 1100)]);
  assert.equal(two.estimate.calories, 646.7);
  assert.equal(two.estimate.confidence, "high");
  assert.match(two.estimate.assumptions, /^Weighted average of Codex 53% and Claude 47%, each high confidence\./);
  assert.doesNotMatch(two.estimate.assumptions, /From Grok/);
  // Two labels and a reference value: it stays.
  assert.deepEqual(providers([label("codex", 600), label("claude", 700), guess("grok", 1100, "Reference.", "medium")]), ["codex", "claude", "grok"]);
  // One label: nobody is left out.
  assert.deepEqual(providers([guess("codex", 600), label("claude", 700), guess("grok", 800)]), ["codex", "claude", "grok"]);
  // One answer is itself.
  assert.deepEqual(settle([guess("codex", 600)]), guess("codex", 600));
});

test("a less sure answer gives part of its share to the surer ones", () => {
  // Two references and a guess: Codex's 40 counts as 20, so 20, 35 and 25 of 80.
  const guessed = settle([guess("codex", 600), guess("claude", 700, "Reference.", "medium"), guess("grok", 1100, "Reference.", "medium")]);
  assert.equal(guessed.provider, "average");
  // (600 x 20 + 700 x 35 + 1100 x 25) / 80.
  assert.equal(guessed.estimate.calories, 800);
  assert.equal(guessed.estimate.confidence, "low");
  assert.match(
    guessed.estimate.assumptions,
    /^Weighted average of Codex 25%, Claude 44% and Grok 31%, Codex low confidence, Claude medium confidence, Grok medium confidence, a high answer counting double its weight and a low one half\./,
  );
  // One label among guesses: Claude's 35 counts as 70, the others as 20 and 12.5.
  const label = settle([guess("codex", 600), guess("claude", 700, "Looked up.", "high"), guess("grok", 1100)]);
  // (600 x 20 + 700 x 70 + 1100 x 12.5) / 102.5.
  assert.equal(label.estimate.calories, 729.3);
  assert.match(label.estimate.assumptions, /^Weighted average of Codex 20%, Claude 68% and Grok 12%,/);
  // The name is the answer that counts for most.
  const named = (provider, confidence) => ({ ...guess(provider, 600, "x", confidence), estimate: { ...guess(provider, 600, "x", confidence).estimate, name: provider } });
  assert.equal(settle([named("codex", "low"), named("claude", "high")]).estimate.name, "claude");
  assert.equal(settle([named("codex", "low"), named("claude", "low")]).estimate.name, "codex");
});

test("guesses on the same footing are averaged by weight, each one's working kept", () => {
  const { estimate, provider } = settle([guess("codex", 600), guess("claude", 700), guess("grok", 800)]);
  assert.equal(provider, "average");
  // 40% Codex, 35% Claude, 25% Grok.
  assert.deepEqual([estimate.calories, estimate.fiber, estimate.confidence], [685, 2, "low"]);
  assert.match(
    estimate.assumptions,
    /^Weighted average of Codex 40%, Claude 35% and Grok 25%, each low confidence\./,
  );
  assert.match(estimate.assumptions, /\n\nFrom Claude \[700 kcal, 35P, 70C, 18F, 2 fiber\]:\nclaude guessed\./);
  // The weights are shared out again over whoever answered.
  const pair = settle([guess("claude", 700), guess("grok", 800)]).estimate;
  assert.match(pair.assumptions, /^Weighted average of Claude 58% and Grok 42%,/);
  assert.equal(pair.calories, 741.7);
});

test("a 0 is left out of that figure's average", () => {
  const empty = {
    provider: "grok",
    estimate: { ...whole, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, alcohol: 0,
      assumptions: "Not found.", confidence: "low" },
  };
  const { estimate } = settle([guess("codex", 600), guess("claude", 700), empty]);
  // Codex and Claude only, 40 to 35.
  assert.deepEqual([estimate.calories, estimate.protein, estimate.alcohol], [646.7, 32.3, 0]);

  // Fiber can come from fewer answers than carbs do, and still never exceeds them.
  const few = { ...guess("codex", 600), estimate: { ...guess("codex", 600).estimate, carbs: 1, fiber: 0 } };
  const lots = { ...guess("claude", 700), estimate: { ...guess("claude", 700).estimate, carbs: 10, fiber: 10 } };
  const held = settle([few, lots]).estimate;
  assert.deepEqual([held.carbs, held.fiber], [5.2, 5.2]);
});

test("averaged working still fits the app's 3000 characters, whole items first", () => {
  const long = `Rice, 200 g [260 kcal, 5P, 57C, 0F]\nReference values.\n\n${"x".repeat(2900)}`;
  const { estimate } = settle(["codex", "claude", "grok"].map((name) => guess(name, 600, long)));
  assert.ok(estimate.assumptions.length <= 3000);
  for (const name of ["Codex", "Claude", "Grok"])
    assert.match(estimate.assumptions, new RegExp(`From ${name} [^\\n]*:\\nRice, 200 g \\[260 kcal, 5P, 57C, 0F\\]\\nReference values\\.…`));
});

const dish = (name, calories, confidence = "medium") => ({
  name, calories, protein: calories / 20, carbs: calories / 10, fat: calories / 40,
  fiber: 0, alcohol: 0, assumptions: `${name}, worked out.`, confidence,
});
const shared = (dishes, over = {}) => ({ ...whole, name: "Dinner", assumptions: "Shared.", dishes, ...over });

test("a shared meal is the meal's question, and then dish by dish", () => {
  assert.ok(DISH_INSTRUCTIONS.startsWith(INSTRUCTIONS.replace(/ Output only the required JSON\.$/, " ")));
  assert.ok(DISH_INSTRUCTIONS.endsWith("Output only the required JSON."));
  for (const phrase of [
    "dish by dish in dishes", "'burger fries shake' is three dishes", "'mac and cheese'",
    "When the description contains dishes", "household's own words", "The dishes add up to the totals",
  ])
    assert.ok(DISH_INSTRUCTIONS.includes(phrase), phrase);
  assert.deepEqual(DISH_SCHEMA.required, [...SCHEMA_REQUIRED, "dishes"]);
  assert.deepEqual(DISH_SCHEMA.properties.dishes.items.required, SCHEMA_REQUIRED);
  // Still a meal: it searches as a meal does.
  assert.ok(PROVIDERS.codex.args("pizza, salad", DISH_TASK).includes("--search"));
  const grok = PROVIDERS.grok.args("pizza, salad", DISH_TASK);
  assert.equal(grok[grok.indexOf("--tools") + 1], "web_search");
  assert.ok(JSON.parse(grok[grok.indexOf("--json-schema") + 1]).required.includes("dishes"));
  const claude = PROVIDERS.claude.args("pizza, salad", DISH_TASK);
  assert.equal(claude[claude.indexOf("--tools") + 1], "WebSearch,WebFetch");
  assert.equal(claude[claude.indexOf("--system-prompt") + 1], DISH_INSTRUCTIONS);
});

test("a shared meal's totals are its dishes added up, and its confidence the weakest", () => {
  const cleaned = cleanDishes(shared([dish("Pizza", 880.04, "high"), dish("Salad", 420, "medium")], { calories: 5 }));
  assert.equal(cleaned.calories, 1300);
  assert.equal(cleaned.protein, 65);
  assert.equal(cleaned.confidence, "medium");
  assert.deepEqual(cleaned.dishes.map((each) => [each.name, each.calories]), [["Pizza", 880], ["Salad", 420]]);
});

test("one unusable dish makes the whole answer unusable, since nobody would be given it", () => {
  assert.equal(cleanDishes(shared([dish("Pizza", 880), { ...dish("Salad", 420), carbs: 1, fiber: 5 }])), null);
  assert.equal(cleanDishes(shared([dish("Pizza", 880), { ...dish("", 420) }])), null);
  assert.equal(cleanDishes(shared([])), null);
  assert.equal(cleanDishes(whole), null, "a meal with no dishes is not a shared meal");
  assert.equal(cleanDishes(shared(Array.from({ length: 21 }, (_, index) => dish(`Dish ${index}`, 10)))), null);
  assert.equal(cleanDishes(shared([dish("Feast", 15000), dish("Second feast", 15000)])), null, "totals past a meal's ceiling");
});

test("shared meals average dish by dish, and an answer split another way is left out", () => {
  const answers = [
    { provider: "codex", estimate: cleanDishes(shared([dish("pizza", 800), dish("salad", 400)])) },
    { provider: "claude", estimate: cleanDishes(shared([dish("pizza", 900, "high"), dish("salad", 300)])) },
    { provider: "grok", estimate: cleanDishes(shared([dish("pizza and salad", 1200)])) },
  ];
  const { provider, estimate } = settleDishes(answers);
  assert.equal(provider, "average");
  // Each dish by weight times that answer's confidence for it. Pizza: Codex
  // 800 at 40, Claude's label 900 at 35 doubled. Salad: 400 at 40, 300 at 35.
  assert.deepEqual(estimate.dishes.map((each) => [each.name, each.calories]), [["pizza", 863.6], ["salad", 353.3]]);
  assert.equal(estimate.calories, 1216.9);
  assert.equal(estimate.dishes[0].confidence, "medium", "a dish is as sure as its least sure answer");
  assert.match(estimate.dishes[0].assumptions, /^Weighted average of Codex 36% and Claude 64%\./);
  assert.match(estimate.dishes[1].assumptions, /^Weighted average of Codex 53% and Claude 47%\./);
  // The meal's shares are each answer's whole-meal footing.
  assert.match(estimate.assumptions, /^Weighted average of Codex 53% and Claude 47%, dish by dish, each medium confidence/);
  assert.match(estimate.assumptions, /Grok split the meal into a different number of dishes, so it is left out\./);
  assert.match(estimate.dishes[0].assumptions, /From Codex \[800 kcal, 40P, 80C, 20F\]:\npizza, worked out\./);

  // Two labels and a guess split the same way: the guess is left out.
  const labelled = (provider, pizza, salad, confidence) => ({
    provider,
    estimate: cleanDishes(shared([dish("pizza", pizza, confidence), dish("salad", salad, confidence)], { confidence })),
  });
  const two = settleDishes([labelled("codex", 800, 400, "high"), labelled("claude", 900, 300, "high"), labelled("grok", 1000, 200, "low")]);
  assert.equal(two.provider, "average");
  assert.deepEqual(two.estimate.dishes.map((each) => [each.name, each.calories]), [["pizza", 846.7], ["salad", 353.3]]);
  assert.match(two.estimate.assumptions, /^Weighted average of Codex 53% and Claude 47%, dish by dish, each high confidence/);
  assert.doesNotMatch(two.estimate.assumptions, /From Grok/);
  // One label: the guess stays, at half its weight, and the label's split leads.
  const one = settleDishes([labelled("codex", 800, 400, "medium"), labelled("claude", 900, 300, "high"), labelled("grok", 1000, 200, "low")]);
  // Pizza: (800 x 40 + 900 x 70 + 1000 x 12.5) / 122.5.
  assert.equal(one.estimate.dishes[0].calories, 877.6);
  assert.match(one.estimate.assumptions, /From Grok:/);
  // With nobody to average it with, the best-weighted answer stands as it is.
  const alone = [answers[0], answers[2]];
  assert.equal(settleDishes(alone), answers[0]);
});
