import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WEIGHTS,
  CONFIDENCE_FACTOR,
  blendEstimates,
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

test("every answer counts unless two found the label, when one that could not find it is left out", () => {
  const providers = (list: BlendAnswer[]) => defaultIncluded(list).map((item) => item.provider);
  // Two labels and a guess: the guess is out.
  assert.deepEqual(providers([answer("codex", 600, "high"), answer("claude", 700, "high"), answer("grok", 1100, "low")]), ["codex", "claude"]);
  // Two labels and a reference value: it stays, and counts for less.
  assert.deepEqual(providers([answer("codex", 600, "high"), answer("claude", 700, "high"), answer("grok", 1100, "medium")]), ["codex", "claude", "grok"]);
  // One label: nobody is left out, low or not.
  assert.deepEqual(providers([answer("codex", 600, "low"), answer("claude", 700, "high"), answer("grok", 1100, "low")]), ["codex", "claude", "grok"]);
  // No label: everyone, however sure.
  assert.deepEqual(providers([answer("codex", 600, "low"), answer("claude", 700, "medium"), answer("grok", 1100, "medium")]), ["codex", "claude", "grok"]);
  assert.deepEqual(providers([answer("codex", 600, "high"), answer("claude", 700, "high"), answer("grok", 1100, "high")]), ["codex", "claude", "grok"]);
  assert.deepEqual(providers([]), []);
});

test("a less sure answer gives part of its share to the surer ones", () => {
  assert.deepEqual(CONFIDENCE_FACTOR, { low: 0.5, medium: 1, high: 2 });
  // Two references and a guess: Codex's 40 counts as 20, so 20, 35 and 25 of 80.
  const guess = blendEstimates([answer("codex", 600, "low"), answer("claude", 700, "medium"), answer("grok", 1100, "medium")]);
  assert.equal(guess?.provider, "average");
  // (600 x 20 + 700 x 35 + 1100 x 25) / 80.
  assert.equal(guess?.estimate.calories, 800);
  assert.equal(guess?.estimate.confidence, "low");
  assert.match(
    guess?.estimate.assumptions ?? "",
    /^Weighted average of Codex 25%, Claude 44% and Grok 31%, Codex low confidence, Claude medium confidence, Grok medium confidence, a high answer counting double its weight and a low one half\./,
  );

  // One label among guesses: Claude's 35 counts as 70, the others as 20 and 12.5.
  const label = blendEstimates([answer("codex", 600, "low"), answer("claude", 700, "high", "Looked up."), answer("grok", 1100, "low")]);
  // (600 x 20 + 700 x 70 + 1100 x 12.5) / 102.5.
  assert.equal(label?.estimate.calories, 729.3);
  assert.match(label?.estimate.assumptions ?? "", /^Weighted average of Codex 20%, Claude 68% and Grok 12%,/);
  // The name comes from whoever counts for most, not whoever weighs most.
  const named = (provider: BlendAnswer["provider"], calories: number, confidence: BlendAnswer["estimate"]["confidence"]) => {
    const each = answer(provider, calories, confidence);
    return { ...each, estimate: { ...each.estimate, name: `${provider} bowl` } };
  };
  assert.equal(blendEstimates([named("codex", 600, "low"), named("claude", 700, "high")])?.estimate.name, "claude bowl");
  assert.equal(blendEstimates([named("codex", 600, "medium"), named("claude", 700, "medium")])?.estimate.name, "codex bowl");

  // Two labels, the guess left out: the labels share as their weights do.
  const two = blendEstimates(defaultIncluded([
    answer("codex", 600, "high", "Looked up."),
    answer("claude", 700, "high", "Looked up."),
    answer("grok", 1100, "low"),
  ]));
  assert.equal(two?.estimate.calories, 646.7);
  assert.equal(two?.estimate.confidence, "high");
  assert.match(two?.estimate.assumptions ?? "", /^Weighted average of Codex 53% and Claude 47%, each high confidence\./);
  assert.doesNotMatch(two?.estimate.assumptions ?? "", /From Grok/);
});

test("on the same footing the shares are the weights as they are", () => {
  const all = blendEstimates([answer("codex", 600), answer("claude", 700), answer("grok", 800)]);
  assert.equal(all?.provider, "average");
  assert.deepEqual(
    [all?.estimate.calories, all?.estimate.fiber, all?.estimate.confidence],
    [685, 2, "low"],
  );
  assert.match(all?.estimate.assumptions ?? "", /^Weighted average of Codex 40%, Claude 35% and Grok 25%, each low confidence\./);

  const pair = blendEstimates([answer("claude", 700, "high"), answer("grok", 800, "high")]);
  assert.equal(pair?.estimate.calories, 741.7);
  assert.match(pair?.estimate.assumptions ?? "", /^Weighted average of Claude 58% and Grok 42%, each high confidence\./);
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
