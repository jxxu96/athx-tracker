import { test } from "node:test";
import assert from "node:assert/strict";
import { FOOD_NOTES_LIMIT, estimatePrompt } from "./estimate-conversation.ts";
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

test("the largest valid conversation fits the estimator transport", () => {
  const input = estimateRequestSchema.parse({
    description: "\\".repeat(4000),
    refinement: {
      previous: { ...previous, name: "\\".repeat(300), assumptions: "\\".repeat(3000) },
      replies: Array(6).fill("\\".repeat(1000)),
    },
  });
  const prompt = estimatePrompt(input.description, input.refinement, "\\".repeat(FOOD_NOTES_LIMIT));
  assert.ok(prompt.length < 40000);
  assert.ok(JSON.stringify({ description: prompt, budgetMs: 25000 }).length < 64000);
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
