import { test } from "node:test";
import assert from "node:assert/strict";
import { macroCalories, mealCalorieError } from "./meal-calories.ts";
import { mealSchema, reconciledEstimateSchema } from "./validation.ts";
import { fillQueuedMeal } from "./queue-rules.ts";
import type { Meal } from "./domain.ts";

const meal: Meal = {
  id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1234", kind: "meal", athlete: "gators",
  day: "2026-10-23", name: "Lunch", meal: "Lunch", source: "manual", assumptions: "",
  macros: { calories: 455, protein: 30, carbs: 50, fat: 15 },
};

test("each macro contributes its calories, including fractional grams", () => {
  assert.deepEqual(macroCalories({ protein: 12.5, carbs: 20.25, fat: 3.5 }), {
    protein: 50, carbs: 81, fat: 31.5, alcohol: 0, total: 162.5,
  });
  assert.equal(macroCalories({ protein: 0, carbs: 0, fat: 0 }).total, 0);
  assert.equal(macroCalories({ protein: 0, carbs: 20, fat: 0, alcohol: 10 }).total, 150);
});

test("meal saves allow rounding but refuse discrepancies in either direction", () => {
  for (const source of ["manual", "grok", "queued"] as const) {
    for (const offset of [-10.01, -10, 0, 10, 10.01, 100]) {
      const macros = { ...meal.macros, calories: 455 + offset };
      const matches = Math.abs(offset) <= 10;
      assert.equal(mealCalorieError(macros) === "", matches);
      assert.equal(mealSchema.safeParse({ ...meal, source, macros }).success, matches);
    }
  }
});

test("an alcohol sitting counts ethanol and food, and other sittings refuse ethanol", () => {
  const drinks = {
    ...meal,
    meal: "Alcohol" as const,
    macros: { calories: 665, protein: 30, carbs: 50, fat: 15, alcohol: 30 },
  };
  assert.equal(mealCalorieError(drinks.macros), "");
  assert.ok(mealSchema.safeParse(drinks).success, "snacks alongside the drinks");
  assert.ok(mealSchema.safeParse({
    ...drinks,
    macros: { calories: 70, protein: 0, carbs: 0, fat: 0, alcohol: 10 },
  }).success, "drinks with nothing alongside");
  assert.ok(!mealSchema.safeParse({
    ...drinks,
    macros: { ...drinks.macros, calories: 676 },
  }).success, "eleven kcal off still fails");

  assert.ok(mealSchema.safeParse(meal).success, "older meals omit ethanol");
  assert.equal(mealSchema.parse(meal).macros.alcohol, 0);
  assert.ok(!mealSchema.safeParse({
    ...meal,
    meal: "Breakfast",
    macros: { calories: 525, protein: 30, carbs: 50, fat: 15, alcohol: 10 },
  }).success, "breakfast cannot carry ethanol");
  for (const sitting of ["Lunch", "Dinner", "Snack"] as const) {
    assert.ok(!mealSchema.safeParse({
      ...meal,
      meal: sitting,
      macros: { ...meal.macros, alcohol: 1 },
    }).success, sitting);
  }
});

test("the queue can still store a placeholder with no estimate yet", () => {
  assert.ok(mealSchema.safeParse({ ...meal, source: "queued",
    macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  }).success);
  assert.ok(!mealSchema.safeParse({ ...meal,
    macros: { calories: 500, protein: 0, carbs: 0, fat: 0 },
  }).success, "calories alone must not bypass the check");
});

test("estimates and queued meals use calories from the same rounded grams", () => {
  const raw = { name: "Bowl", calories: 900, protein: 12.4, carbs: 13.4, fat: 9.6,
    assumptions: "One bowl", confidence: "medium" };
  const estimate = reconciledEstimateSchema.parse(raw);
  assert.deepEqual(estimate, { ...raw, calories: 190, protein: 12, carbs: 13, fat: 10 });
  const filled = fillQueuedMeal({ ...meal, source: "queued" }, estimate);
  assert.deepEqual(filled.macros, { calories: 190, protein: 12, carbs: 13, fat: 10 });
  assert.ok(mealSchema.safeParse(filled).success);
  assert.equal(raw.calories, 900, "reconciliation must not mutate the response");
});

test("reconciliation validates both the input and the derived calorie limit", () => {
  const raw = { name: "Bowl", calories: 20000, protein: 2000, carbs: 3000, fat: 0,
    assumptions: "", confidence: "low" };
  assert.ok(reconciledEstimateSchema.safeParse(raw).success);
  assert.ok(!reconciledEstimateSchema.safeParse({ ...raw, fat: 1 }).success);
  for (const protein of [-1, NaN, Infinity, 2001]) {
    assert.ok(!reconciledEstimateSchema.safeParse({ ...raw, protein }).success);
  }
});
