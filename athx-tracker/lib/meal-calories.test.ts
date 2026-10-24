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
    protein: 50, carbs: 81, fiber: 0, fat: 31.5, alcohol: 0, total: 162.5,
  });
  assert.equal(macroCalories({ protein: 0, carbs: 0, fat: 0 }).total, 0);
  assert.equal(macroCalories({ protein: 0, carbs: 20, fat: 0, alcohol: 10 }).total, 150);
});

test("fiber inside total carbs is 2 kcal/g and the rest of the carbs stay at 4", () => {
  // 40 g carbs with no fiber is 160 kcal. 10 g of that fiber is 20 kcal, not 40.
  assert.deepEqual(macroCalories({ protein: 0, carbs: 40, fat: 0, fiber: 10 }), {
    protein: 0, carbs: 120, fiber: 20, fat: 0, alcohol: 0, total: 140,
  });
  assert.equal(macroCalories({ protein: 0, carbs: 15, fat: 0, fiber: 15 }).total, 30);
  assert.equal(macroCalories({ protein: 0, carbs: 20, fat: 0, alcohol: 10, fiber: 5 }).total, 140);
  // A caller that puts fiber above carbs cannot make the comparison negative.
  assert.equal(macroCalories({ protein: 0, carbs: 10, fat: 0, fiber: 40 }).total, 20);
});

test("saved calories are independent of the rough comparison for every source", () => {
  for (const source of ["manual", "grok", "queued"] as const) {
    for (const calories of [0, 300, 445, 455, 465, 900, 20000]) {
      const macros = { ...meal.macros, calories };
      assert.deepEqual(mealSchema.parse({ ...meal, source, macros }).macros, { ...macros, alcohol: 0, fiber: 0 });
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
  assert.deepEqual(mealSchema.parse(drinks).macros, { ...drinks.macros, fiber: 0 });
  for (const sitting of ["Breakfast", "Lunch", "Dinner", "Snack"] as const) {
    assert.ok(!mealSchema.safeParse({ ...drinks, meal: sitting }).success, sitting);
  }
  assert.equal(mealSchema.parse(meal).macros.alcohol, 0, "older records still parse");
});

test("fiber-containing estimates keep their source calories and fractional grams through the queue", () => {
  // 10 g of the 40.4 g carbs is fiber: 2 kcal/g there, 4 kcal/g on the rest.
  // The label total is still kept when that rough sum is different.
  const raw = { name: "Fiber cereal", calories: 160, protein: 6.2, carbs: 40.4, fat: 2.6,
    fiber: 10, assumptions: "Total carbs include fiber", confidence: "medium" as const };
  const estimate = estimateSchema.parse(raw);
  assert.deepEqual(estimate, { ...raw, alcohol: 0 });
  assert.equal(macroCalories(estimate).total, 189.8);
  assert.notEqual(macroCalories(estimate).total, raw.calories);
  const filled = fillQueuedMeal({ ...meal, source: "queued" }, estimate);
  assert.deepEqual(filled.macros, {
    calories: 160, protein: 6.2, carbs: 40.4, fat: 2.6, alcohol: 0, fiber: 10,
  });
  assert.ok(mealSchema.safeParse(filled).success);
  assert.equal(raw.calories, 160);
  assert.ok(!estimateSchema.safeParse({ ...raw, fiber: 41 }).success, "fiber above carbs");
  assert.ok(!mealSchema.safeParse({
    ...meal, macros: { ...meal.macros, carbs: 20, fiber: 21 },
  }).success);
  assert.equal(mealSchema.parse(meal).macros.fiber, 0, "older records still parse");
});

test("independent calories and grams still have numeric bounds", () => {
  const raw = { name: "Bowl", calories: 20000, protein: 2000, carbs: 3000, fat: 1,
    alcohol: 1, assumptions: "", confidence: "low" };
  assert.ok(estimateSchema.safeParse(raw).success, "a derived total no longer imposes another cap");
  for (const [field, ceiling] of Object.entries({ calories: 20000, protein: 2000, carbs: 3000, fat: 2000, alcohol: 500, fiber: 3000 })) {
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
  assert.deepEqual(estimate, { ...raw, fiber: 0 });
  for (const sitting of ["Alcohol", "Dinner"] as const) {
    const filled = fillQueuedMeal({ ...meal, meal: sitting, source: "queued" }, estimate);
    assert.equal(filled.meal, "Alcohol");
    assert.equal(filled.macros.alcohol, 14.6);
    assert.equal(filled.macros.calories, 250);
    assert.ok(mealSchema.safeParse(filled).success);
  }
});
