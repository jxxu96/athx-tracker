import { test } from "node:test";
import assert from "node:assert/strict";
import type { MealTemplateItem } from "./domain.ts";
import { SCALE_MAX, emptyDish, scaleDish, setFigure, type DishDraft } from "./meal-dishes.ts";
import { itemTotals, setItemGrams, type ItemDraft } from "./meal-items.ts";
import { ingredientTotals } from "./meal-ingredients.ts";
import { isSize, scaleAt, sizeIngredients, sizeItems, sizeTable, sizedAssumptions, tableSize } from "./meal-size.ts";

function dish(id: string, over: Partial<DishDraft> = {}): DishDraft {
  return { ...emptyDish(id), name: id, ...over };
}

const curry = dish("curry", { calories: "800", protein: "40", carbs: "80", fat: "30", fiber: "6", source: "grok" });
const naan = dish("naan", { calories: "200", protein: "6", carbs: "30", fat: "6", fiber: "2" });

test("a meal takes the sizes a dish takes", () => {
  for (const size of [1, 50, 100, 250, SCALE_MAX]) assert.equal(isSize(size), true, String(size));
  for (const size of [0, 0.5, SCALE_MAX + 1, Number.NaN, Infinity]) assert.equal(isSize(size), false, String(size));
});

test("a split meal sits at 100% until a dish is resized, and then at its dishes' size by calories", () => {
  assert.deepEqual(tableSize([]), { percent: 100, full: 0 });
  assert.deepEqual(tableSize([curry, naan]), { percent: 100, full: 1000 });
  // The curry at half is 400 of the 1000 kcal gone.
  assert.deepEqual(tableSize([scaleDish(curry, 50), naan]), { percent: 60, full: 1000 });
  // A figure typed at a size is that figure at the size shown, so the full meal follows it.
  assert.deepEqual(tableSize([setFigure(scaleDish(curry, 50), "calories", "500"), naan]), { percent: 58.3333, full: 1200 });
  // Nothing to weigh yet: every dish counts the same.
  assert.equal(tableSize([scaleDish(dish("a"), 50), dish("b")]).percent, 75);
  // A calories box that does not read weighs nothing.
  assert.deepEqual(tableSize([scaleDish(curry, 50), { ...naan, calories: "2oo" }]), { percent: 50, full: 800 });
});

test("resizing a split meal resizes every dish by the same ratio, from each one's 100%", () => {
  const half = sizeTable([curry, naan], 50);
  assert.deepEqual(half.map((one) => [one.calories, one.protein, one.fiber, one.scale?.percent]), [
    ["400", "20", "3", 50],
    ["100", "3", "1", 50],
  ]);
  assert.equal(tableSize(half).percent, 50);
  assert.equal(half[0].source, "manual", "a resized estimate is your own numbers, as a resized dish is");

  // Each keeps its size against the others, and back at 100% each is as it was.
  const mixed = [scaleDish(curry, 50), naan];
  const smaller = sizeTable(mixed, 30);
  assert.deepEqual(smaller.map((one) => one.scale?.percent), [25, 50]);
  assert.equal(tableSize(smaller).percent, 30);
  const back = sizeTable(sizeTable(smaller, 135), 60);
  assert.deepEqual(back.map((one) => [one.calories, one.scale?.percent]), [["400", 50], ["200", 100]]);
  assert.deepEqual(sizeTable(sizeTable([curry, naan], 37), 100).map((one) => one.calories), ["800", "200"]);

  // Typed past the slider, as a dish's box takes it.
  assert.deepEqual(sizeTable([curry, naan], 250).map((one) => one.calories), ["2000", "500"]);
  // No dish goes past what a dish can be.
  assert.deepEqual(sizeTable([scaleDish(curry, 500), naan], 1000).map((one) => one.scale?.percent), [SCALE_MAX, 238.0952]);
  // A size the bar cannot take, or the size it is at, changes nothing.
  const dishes = [curry, naan];
  for (const size of [0, SCALE_MAX + 1, Number.NaN, 100]) assert.equal(sizeTable(dishes, size), dishes, String(size));
});

test("resizing weighed ingredients moves each one's amount, and the meal follows", () => {
  const oats: MealTemplateItem = {
    name: "Oats",
    grams: 80,
    nutrition: { grams: 80, macros: { calories: 300, protein: 10, carbs: 54, fat: 5, fiber: 8, alcohol: 0 } },
  };
  const eggs: MealTemplateItem = {
    name: "2 eggs",
    grams: 0,
    nutrition: { grams: 0, macros: { calories: 140, protein: 12, carbs: 1, fat: 10, fiber: 0, alcohol: 0 } },
  };
  const milk: MealTemplateItem = { ...oats, name: "Milk", grams: 0, nutrition: { ...oats.nutrition!, grams: 250 } };
  const bigger = sizeIngredients([oats, eggs, milk], 1.5);
  assert.deepEqual(bigger.map((item) => [item.name, item.grams]), [["Oats", 120], ["3 eggs", 0], ["Milk", 0]]);
  assert.equal(bigger[1].nutrition?.count, 2, "the count its figures are for is kept");
  assert.equal(ingredientTotals(bigger)?.calories, 660);
  assert.deepEqual(sizeIngredients(bigger, 1 / 1.5).map((item) => [item.name, item.grams]), [
    ["Oats", 80],
    ["2 eggs", 0],
    ["Milk", 0],
  ]);
  // An option slid to zero stays out, and nothing goes past the most an ingredient can weigh.
  assert.equal(sizeIngredients([milk], 3)[0], milk);
  assert.equal(sizeIngredients([{ ...oats, grams: 4000 }], 3)[0].grams, 5000);
});

function item(over: Partial<ItemDraft>): ItemDraft {
  return {
    id: "i", name: "Item", grams: "", calories: "", protein: "", carbs: "", fat: "", fiber: "", ethanol: "",
    per: null, scale: null, ...over,
  };
}

test("resizing items moves a weighed one's grams and any other's own size", () => {
  const rice = item({
    name: "Rice", grams: "300", calories: "390", protein: "8", carbs: "84", fat: "1", fiber: "1", ethanol: "0",
    per: { grams: 300, macros: { calories: 390, protein: 8, carbs: 84, fat: 1, fiber: 1, alcohol: 0 } },
  });
  // Grams with figures but not yet tied to them are tied first.
  const chicken = item({ name: "Chicken", grams: "200", calories: "330", protein: "62", carbs: "0", fat: "7", fiber: "0", ethanol: "0" });
  const sauce = item({ name: "1 serving sauce", calories: "80", protein: "1", carbs: "6", fat: "6", fiber: "0", ethanol: "0" });
  const half = sizeItems([rice, chicken, sauce], 0.5);
  assert.deepEqual(half.map((one) => [one.grams, one.calories, one.scale?.percent ?? null]), [
    ["150", "195", null],
    ["100", "165", null],
    ["", "40", 50],
  ]);
  assert.equal(itemTotals(half).calories, "400");
  const back = sizeItems(half, 2);
  assert.deepEqual(back.map((one) => one.calories), ["390", "330", "80"]);
  // One weighed at zero stays there.
  const none = setItemGrams(rice, "0");
  assert.equal(sizeItems([none], 2)[0].grams, "0");
});

test("figures shown at a size are the meal at 100% divided by it", () => {
  assert.deepEqual(scaleAt({ calories: "400", protein: "20", carbs: "", fat: "x", fiber: "3", ethanol: "0" }, 50), {
    percent: 50,
    base: { calories: 800, protein: 40, carbs: 0, fat: 0, fiber: 6, ethanol: 0 },
  });
});

test("a resized meal says so in its assumptions, after its list of items when it has one", () => {
  const working = "Chicken thigh, 200 g [400 kcal, 36P, 0C, 28F]";
  assert.equal(sizedAssumptions(working, 100, 800), working);
  assert.equal(sizedAssumptions(working, 100.04, 800), working, "100% to a tenth is 100%");
  assert.equal(sizedAssumptions(working, 62.5, 800), `Scaled to 62.5% of 800 kcal.\n\n${working}`);
  assert.equal(sizedAssumptions("", 150, 799.6), "Scaled to 150% of 800 kcal.");
  const listed = `Adjusted item by item:\nRice, 150 g [195 kcal, 4P, 42C, 1F]\n\n${working}`;
  assert.equal(
    sizedAssumptions(listed, 50, 800),
    `Adjusted item by item:\nRice, 150 g [195 kcal, 4P, 42C, 1F]\n\nScaled to 50% of 800 kcal.\n\n${working}`,
  );
  assert.equal(
    sizedAssumptions("Adjusted item by item:\nRice, 150 g [195 kcal, 4P, 42C, 1F]", 50, 390),
    "Adjusted item by item:\nRice, 150 g [195 kcal, 4P, 42C, 1F]\n\nScaled to 50% of 390 kcal.",
  );
});
