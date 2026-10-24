import { test } from "node:test";
import assert from "node:assert/strict";
import { macroCalories } from "./meal-calories.ts";
import { mealSchema, estimateSchema } from "./validation.ts";
import { fillQueuedMeal } from "./queue-rules.ts";
import type { Meal } from "./domain.ts";

const meal: Meal = {
  id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1234", kind: "meal", athlete: "gators",
  day: "2026-10-23", name: "Lunch", meal: "Lunch", source: "manual", assumptions: "",
  macros: { calories: 455, protein: 30, carbs: 50, fat: 15 },
};

test("the rough macro comparison includes fractional grams and ethanol", () => {
  assert.deepEqual(macroCalories({ protein: 12.5, carbs: 20.25, fat: 3.5 }), {
    protein: 50, carbs: 81, fat: 31.5, alcohol: 0, total: 162.5,
  });
  assert.equal(macroCalories({ protein: 0, carbs: 0, fat: 0 }).total, 0);
  assert.equal(macroCalories({ protein: 0, carbs: 20, fat: 0, alcohol: 10 }).total, 150);
});

test("saved calories are independent of the rough comparison for every source", () => {
  for (const source of ["manual", "grok", "queued"] as const) {
    for (const calories of [0, 300, 445, 455, 465, 900, 20000]) {
      const macros = { ...meal.macros, calories };
      assert.deepEqual(mealSchema.parse({ ...meal, source, macros }).macros, { ...macros, alcohol: 0 });
    }
  }
  assert.ok(mealSchema.safeParse({ ...meal, source: "queued",
    macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  }).success);
  assert.ok(mealSchema.safeParse({ ...meal,
    macros: { calories: 500, protein: 0, carbs: 0, fat: 0 },
  }).success, "calories may be known even when the gram breakdown is not");
});

test("alcohol entries keep source calories and other sittings still reject ethanol", () => {
  const drinks = { ...meal, meal: "Alcohol" as const,
    macros: { ...meal.macros, calories: 640, alcohol: 30 } };
  assert.deepEqual(mealSchema.parse(drinks).macros, drinks.macros);
  for (const sitting of ["Breakfast", "Lunch", "Dinner", "Snack"] as const) {
    assert.ok(!mealSchema.safeParse({ ...drinks, meal: sitting }).success, sitting);
  }
  assert.equal(mealSchema.parse(meal).macros.alcohol, 0, "older records still parse");
});

test("fiber-containing estimates keep their source calories and fractional grams through the queue", () => {
  // A high-fiber label need not equal its total-carb 4/4/9 calculation.
  const raw = { name: "Fiber cereal", calories: 160, protein: 6.2, carbs: 40.4, fat: 2.6,
    assumptions: "Total carbs include fiber", confidence: "medium" };
  const estimate = estimateSchema.parse(raw);
  assert.deepEqual(estimate, { ...raw, alcohol: 0 });
  assert.notEqual(macroCalories(estimate).total, raw.calories);
  const filled = fillQueuedMeal({ ...meal, source: "queued" }, estimate);
  assert.deepEqual(filled.macros, { calories: 160, protein: 6.2, carbs: 40.4, fat: 2.6, alcohol: 0 });
  assert.ok(mealSchema.safeParse(filled).success);
  assert.equal(raw.calories, 160);
});

test("independent calories and grams still have numeric bounds", () => {
  const raw = { name: "Bowl", calories: 20000, protein: 2000, carbs: 3000, fat: 1,
    alcohol: 1, assumptions: "", confidence: "low" };
  assert.ok(estimateSchema.safeParse(raw).success, "a derived total no longer imposes another cap");
  for (const [field, ceiling] of Object.entries({ calories: 20000, protein: 2000, carbs: 3000, fat: 2000, alcohol: 500 })) {
    for (const value of [-1, NaN, Infinity, ceiling + 1, "15"]) {
      assert.ok(!estimateSchema.safeParse({ ...raw, [field]: value }).success, field + "=" + value);
      assert.ok(!mealSchema.safeParse({ ...meal, meal: "Alcohol", macros: { ...meal.macros, [field]: value } }).success);
    }
  }
});

test("estimated ethanol and its independent calorie total survive queued saves", () => {
  const raw = { name: "Beer and chips", calories: 250, protein: 2.2, carbs: 20.4,
    fat: 4.6, alcohol: 14.6, assumptions: "355 mL beer, 5.2% ABV", confidence: "medium" };
  const estimate = estimateSchema.parse(raw);
  assert.deepEqual(estimate, raw);
  for (const sitting of ["Alcohol", "Dinner"] as const) {
    const filled = fillQueuedMeal({ ...meal, meal: sitting, source: "queued" }, estimate);
    assert.equal(filled.meal, "Alcohol");
    assert.equal(filled.macros.alcohol, 14.6);
    assert.equal(filled.macros.calories, 250);
    assert.ok(mealSchema.safeParse(filled).success);
  }
});
