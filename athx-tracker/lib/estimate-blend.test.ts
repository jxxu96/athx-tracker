import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WEIGHTS,
  blendEstimates,
  complexMeal,
  defaultIncluded,
  parseWeights,
  readWeights,
  writeWeights,
  type BlendAnswer,
  type EstimateWeights,
} from "./estimate-blend.ts";

const answer = (
  provider: BlendAnswer["provider"],
  calories: number,
  confidence: BlendAnswer["estimate"]["confidence"] = "low",
  assumptions = `${provider} guessed.`,
): BlendAnswer => ({
  provider,
  estimate: {
    name: "Bowl",
    calories,
    protein: calories / 20,
    carbs: calories / 10,
    fat: calories / 40,
    fiber: 2,
    alcohol: 0,
    assumptions,
    confidence,
  },
});

test("a link or three items is a complex meal, and a short one is not", () => {
  assert.equal(complexMeal("banana"), false);
  assert.equal(complexMeal("Chicken and rice"), false);
  assert.equal(complexMeal("Chipotle chicken burrito bowl"), false);
  assert.equal(complexMeal("mac and cheese"), false);
  assert.equal(complexMeal(JSON.stringify({ mealDescription: "banana", foodNotes: "yogurt, berries, granola" })), false);
  assert.equal(complexMeal("Rice, beans, cheese"), true);
  assert.equal(complexMeal("see https://example.com/bowl"), true);
});

test("a label is the estimate, even when a less sure answer would have been kept", () => {
  const label = answer("claude", 700, "high", "Looked up.");
  const answers = [answer("codex", 600), label, answer("grok", 1100, "low", "Searched.")];
  assert.deepEqual(defaultIncluded(answers, ["grok"]), [label]);
  assert.equal(blendEstimates(defaultIncluded(answers, ["grok"]))?.provider, "claude");
  assert.equal(blendEstimates(defaultIncluded(answers, ["grok"]))?.estimate.calories, 700);
});

test("two labels are averaged, and the guess stays out", () => {
  const chosen = defaultIncluded([
    answer("codex", 600, "high", "Looked up."),
    answer("claude", 700, "high", "Looked up."),
    answer("grok", 1100, "low"),
  ], ["grok"]);
  const blended = blendEstimates(chosen);
  assert.equal(blended?.provider, "average");
  assert.equal(blended?.estimate.calories, 646.7);
  assert.equal(blended?.estimate.confidence, "high");
  assert.match(blended?.estimate.assumptions ?? "", /^Weighted average of Codex 53% and Claude 47%, each high confidence\./);
  assert.doesNotMatch(blended?.estimate.assumptions ?? "", /From Grok/);
});

test("without a label, a kept Grok still counts, and the same footing is the built-in weights", () => {
  const kept = defaultIncluded([
    answer("codex", 600, "medium", "Reference."),
    answer("grok", 1100, "low", "Searched."),
  ], ["grok"]);
  assert.deepEqual(kept.map((item) => item.provider), ["codex", "grok"]);
  const blended = blendEstimates(kept);
  assert.equal(blended?.estimate.calories, 792.3);
  assert.match(blended?.estimate.assumptions ?? "", /Codex 62% and Grok 38%, Codex medium confidence, Grok low confidence/);

  const all = blendEstimates([answer("codex", 600), answer("claude", 700), answer("grok", 800)]);
  assert.equal(all?.provider, "average");
  assert.deepEqual(
    [all?.estimate.calories, all?.estimate.fiber, all?.estimate.confidence],
    [685, 2, "low"],
  );
  assert.match(all?.estimate.assumptions ?? "", /^Weighted average of Codex 40%, Claude 35% and Grok 25%, each low confidence\./);

  const pair = blendEstimates([answer("claude", 700), answer("grok", 800)]);
  assert.equal(pair?.estimate.calories, 741.7);
  assert.match(pair?.estimate.assumptions ?? "", /^Weighted average of Claude 58% and Grok 42%,/);
});

test("a 0 is left out of that figure, and fiber never exceeds carbs", () => {
  const empty = answer("grok", 0);
  empty.estimate = { ...empty.estimate, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, alcohol: 0 };
  const blended = blendEstimates([answer("codex", 600), answer("claude", 700), empty]);
  assert.deepEqual(
    [blended?.estimate.calories, blended?.estimate.protein, blended?.estimate.alcohol],
    [646.7, 32.3, 0],
  );

  const few = answer("codex", 600);
  few.estimate = { ...few.estimate, carbs: 1, fiber: 0 };
  const lots = answer("claude", 700);
  lots.estimate = { ...lots.estimate, carbs: 10, fiber: 10 };
  const held = blendEstimates([few, lots]);
  assert.deepEqual([held?.estimate.carbs, held?.estimate.fiber], [5.2, 5.2]);
});

test("custom weights replace the built-in ones, and a stored weight that is not a percent does not", () => {
  const weights: EstimateWeights = { codex: 10, claude: 10, grok: 80 };
  const blended = blendEstimates(
    [answer("codex", 600), answer("claude", 700), answer("grok", 800)],
    weights,
  );
  // 600 x 10 + 700 x 10 + 800 x 80, over 100.
  assert.equal(blended?.estimate.calories, 770);
  assert.match(blended?.estimate.assumptions ?? "", /Codex 10%, Claude 10% and Grok 80%/);
  assert.equal(blended?.estimate.name, "Bowl");

  const named = blendEstimates(
    [
      { ...answer("codex", 600), estimate: { ...answer("codex", 600).estimate, name: "Codex bowl" } },
      { ...answer("claude", 700), estimate: { ...answer("claude", 700).estimate, name: "Claude bowl" } },
    ],
    { codex: 20, claude: 80, grok: 25 },
  );
  assert.equal(named?.estimate.name, "Claude bowl");

  assert.deepEqual(parseWeights(null), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights({ codex: 50, claude: -1, grok: "30" }), { codex: 50, claude: 35, grok: 30 });
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  };
  writeWeights(storage, { codex: 50, claude: 30, grok: 20 });
  assert.deepEqual(readWeights(storage), { codex: 50, claude: 30, grok: 20 });
  stored.set([...stored.keys()][0], "{");
  assert.deepEqual(readWeights(storage), DEFAULT_WEIGHTS);
});
