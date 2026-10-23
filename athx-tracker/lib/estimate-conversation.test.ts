import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatePrompt } from "./estimate-conversation.ts";
import { estimateRequestSchema } from "./validation.ts";

const previous = {
  name: "Chicken and rice", calories: 600, protein: 40, carbs: 65, fat: 20,
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
  const prompt = estimatePrompt(input.description, input.refinement);
  assert.ok(prompt.length < 40000);
  assert.ok(JSON.stringify({ description: prompt, budgetMs: 25000 }).length < 64000);
});
