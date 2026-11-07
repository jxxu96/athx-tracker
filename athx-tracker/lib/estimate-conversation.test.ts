import { test } from "node:test";
import assert from "node:assert/strict";
import { FOOD_NOTES_LIMIT, estimatePrompt, ownPrevious } from "./estimate-conversation.ts";
import { estimateRequestSchema, settingsSchema } from "./validation.ts";
import { DEFAULT_SETTINGS } from "./domain.ts";

const previous = {
  name: "Chicken and rice", calories: 600, protein: 40, carbs: 65, fat: 20, fiber: 2, alcohol: 0,
  assumptions: "200 g rice, one tablespoon of oil.", confidence: "medium" as const,
};

test("fresh estimates keep the existing request and prompt", () => {
  const input = estimateRequestSchema.parse({ description: "  chicken and rice  " });
  assert.equal(estimatePrompt(input.description, input.refinement), "chicken and rice");
});

test("a follow-up keeps all corrections and the latest values as data", () => {
  const refinement = { previous, replies: ["150 g cooked rice", "No oil. Why is fat so high?"] };
  const input = estimateRequestSchema.parse({ description: "Chicken and rice", refinement });
  const prompt = JSON.parse(estimatePrompt(input.description, input.refinement));
  assert.deepEqual(prompt, {
    mealDescription: "Chicken and rice", previousEstimate: previous, replies: refinement.replies,
  });
});

test("a reply cannot carry missing macros or unbounded conversation history", () => {
  for (const refinement of [
    { previous: {}, replies: ["no oil"] },
    { previous, replies: [] },
    { previous, replies: ["   "] },
    { previous, replies: ["x".repeat(1001)] },
    { previous, replies: Array(21).fill("no oil") },
    { previous, replies: Array(7).fill("x".repeat(1000)) },
  ]) {
    assert.equal(estimateRequestSchema.safeParse({ description: "meal", refinement }).success, false);
  }
});

test("the largest valid conversation fits the estimator transport", async () => {
  // Backslashes, because each one doubles every time it is put in JSON.
  const biggest = { ...previous, name: "\\".repeat(300), assumptions: "\\".repeat(3000) };
  const input = estimateRequestSchema.parse({
    description: "\\".repeat(4000),
    refinement: {
      previous: biggest,
      replies: Array(6).fill("\\".repeat(1000)),
      byEstimator: { codex: biggest, claude: biggest, grok: biggest },
    },
  });
  const prompt = estimatePrompt(input.description, input.refinement, "\\".repeat(FOOD_NOTES_LIMIT));
  assert.ok(prompt.length < 40000);
  // What the route sends the estimator, held to the limit the estimator reads.
  const estimatorModule = "../../estimator/server.mjs";
  const { BODY_LIMIT } = (await import(estimatorModule)) as { BODY_LIMIT: number };
  const body = JSON.stringify({
    description: prompt, budgetMs: 130000, stream: true, previousEstimates: input.refinement!.byEstimator,
  });
  assert.ok(body.length < BODY_LIMIT, `${body.length} >= ${BODY_LIMIT}`);
});

const answer = (calories: number, assumptions = `${calories} kcal of working.`) => ({
  ...previous, calories, assumptions,
});

test("a reply continues each estimator's own answer while the form shows the average as it came", () => {
  const average = answer(646.7, "Weighted average of Codex 53% and Claude 47%.");
  const shown = {
    figures: { calories: 646.7, protein: 40, carbs: 65, fat: 20, fiber: 2, alcohol: 0 },
    assumptions: average.assumptions,
  };
  const answers = [
    { provider: "codex", estimate: answer(600) },
    { provider: "claude", estimate: { ...answer(700), dishes: [answer(700)] } },
    { provider: "average", estimate: average },
    { provider: "gemini", estimate: answer(1) },
  ];
  // The whole meal's answer from each estimator, with no dishes, and nobody else's.
  assert.deepEqual(ownPrevious(average, shown, answers), { codex: answer(600), claude: answer(700) });
  // Nothing usable in the boxes yet: the form adds nothing to the average either.
  assert.deepEqual(ownPrevious(average, { ...shown, figures: undefined }, answers), {
    codex: answer(600), claude: answer(700),
  });
  // A figure or the working edited by hand is a correction everyone starts from.
  assert.equal(ownPrevious(average, { ...shown, figures: { ...shown.figures, fat: 12 } }, answers), undefined);
  assert.equal(ownPrevious(average, { ...shown, assumptions: "No oil." }, answers), undefined);
  // A meal that was never estimated by them, such as a saved one reopened.
  assert.equal(ownPrevious(average, shown, []), undefined);
});

test("a reply carries the estimators' own answers, and never their dishes", () => {
  const refinement = { previous, replies: ["and a beer"], byEstimator: { codex: answer(600), grok: answer(1100) } };
  const input = estimateRequestSchema.parse({ description: "Chicken and rice", refinement });
  assert.deepEqual(input.refinement?.byEstimator, refinement.byEstimator);
  // The shared prompt is the average's, as before.
  assert.deepEqual(JSON.parse(estimatePrompt(input.description, input.refinement)), {
    mealDescription: "Chicken and rice", previousEstimate: previous, replies: ["and a beer"],
  });
  for (const byEstimator of [
    { codex: { ...answer(600), dishes: [answer(600)] } },
    { average: answer(600) },
    { codex: { ...answer(600), fiber: 90 } },
  ]) {
    assert.equal(
      estimateRequestSchema.safeParse({ description: "meal", refinement: { ...refinement, byEstimator } }).success,
      false,
      JSON.stringify(Object.keys(byEstimator)),
    );
  }
});

test("food notes ride along with a first estimate and a follow-up", () => {
  const notes = "Yogurt means Fage Total 0% plain, 170 g cup";
  assert.deepEqual(JSON.parse(estimatePrompt("yogurt and berries", undefined, ` ${notes}\n`)), {
    mealDescription: "yogurt and berries", foodNotes: notes,
  });
  const refinement = { previous, replies: ["no oil"] };
  assert.deepEqual(JSON.parse(estimatePrompt("Chicken and rice", refinement, notes)), {
    mealDescription: "Chicken and rice", previousEstimate: previous, replies: ["no oil"], foodNotes: notes,
  });
});

test("blank notes leave the prompt as it was", () => {
  assert.equal(estimatePrompt("chicken and rice", undefined, "  \n "), "chicken and rice");
});

test("settings saved before food notes still parse, and notes are bounded", () => {
  const legacy: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS };
  delete legacy.foodNotes;
  assert.equal(settingsSchema.parse(legacy).foodNotes, "");
  assert.equal(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, foodNotes: "x".repeat(FOOD_NOTES_LIMIT) }).success, true);
  assert.equal(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, foodNotes: "x".repeat(FOOD_NOTES_LIMIT + 1) }).success, false);
});
