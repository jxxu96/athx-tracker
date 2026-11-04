import assert from "node:assert/strict";
import test from "node:test";
import {
  ITEM_LIST_HEAD,
  anchorItem,
  assumptionSources,
  blankSeeds,
  breakdown,
  emptyItem,
  expandDish,
  fitItems,
  itemBlocks,
  itemDraft,
  itemDraftsOf,
  itemTotals,
  readItems,
  seedsFromIngredients,
  setItemFigure,
  setItemGrams,
  withItemList,
  withoutItemList,
} from "./meal-items.ts";
import { emptyDish } from "./meal-dishes.ts";
import { blendEstimates } from "./estimate-blend.ts";

const totals = (calories: number, protein: number, carbs: number, fat: number, fiber = 0, alcohol = 0) =>
  ({ calories, protein, carbs, fat, fiber, alcohol });

const BOWL = [
  "Chicken breast, 150 g cooked [248 kcal, 47P, 0C, 5F]",
  "USDA reference for grilled breast.",
  "",
  "White rice, 200 g [260 kcal, 5P, 56C, 1F, 1 fiber]",
  "",
  "**2 large eggs** [140 kcal, 12P, 1C, 10F] - boiled, no oil",
  "",
  "Assumed no sauce.",
].join("\n");

test("an estimate's working lists its items, each with what it said about that item", () => {
  const rows = itemBlocks(BOWL);
  assert.deepEqual(rows.map((row) => [row.name, row.grams, row.macros.calories, row.working]), [
    ["Chicken breast", 150, 248, "USDA reference for grilled breast."],
    ["White rice", 200, 260, ""],
    ["2 large eggs", 0, 140, "boiled, no oil"],
  ]);
  assert.equal(rows[0].label, "Chicken breast, 150 g cooked");
});

test("a blend's summary lines and a split meal's whole dishes are not items", () => {
  const blended = "Weighted average of Codex 60% and Claude 40%.\n\nFrom Codex [700 kcal, 40P, 60C, 20F]:\nRice, 200 g [260 kcal, 5P, 56C, 1F]";
  assert.deepEqual(itemBlocks(blended).map((row) => row.name), ["Rice"]);

  const shared = [
    "50% of Pizza, 400 g (4 of 8 slices) [1000 kcal, 40P, 120C, 40F]",
    "The whole dish [2000 kcal, 80P, 240C, 80F]",
    "Crust, 300 g [1200 kcal, 40P, 200C, 20F]",
    "",
    "100% of Fries [400 kcal, 5P, 50C, 20F]",
  ].join("\n");
  const rows = itemBlocks(shared);
  assert.deepEqual(rows.map((row) => [row.name, row.grams, row.macros.calories]), [
    ["50% of Pizza, 400 g (4 of 8 slices)", 0, 1000],
    ["100% of Fries", 0, 400],
  ]);
});

test("items are shared out to add up to the meal's figures exactly, with fiber inside each item's carbs", () => {
  const seeds = breakdown([{ assumptions: BOWL, weight: 1 }], totals(650, 63.3, 57, 16, 1));
  assert.equal(seeds.length, 3);
  const sum = (key: keyof NonNullable<(typeof seeds)[number]["macros"]>) =>
    Math.round(seeds.reduce((total, seed) => total + seed.macros![key] * 10, 0)) / 10;
  assert.deepEqual([sum("calories"), sum("protein"), sum("carbs"), sum("fat"), sum("fiber")], [650, 63.3, 57, 16, 1]);
  for (const seed of seeds) assert.ok(seed.macros!.fiber <= seed.macros!.carbs);
  // A weighed item keeps its weight and scales from it; a counted one keeps its count in the name.
  assert.deepEqual(seeds.map((seed) => [seed.name, seed.grams, seed.per?.grams ?? null]), [
    ["Chicken breast", 150, 150],
    ["White rice", 200, 200],
    ["2 large eggs", 0, null],
  ]);

  // Rounding goes to whoever lost most to it.
  assert.deepEqual(fitItems([totals(1, 0, 0, 0), totals(1, 0, 0, 0), totals(1, 0, 0, 0)], totals(10, 0, 0, 0))
    .map((item) => item.calories), [3.4, 3.3, 3.3]);
  // Fiber nobody listed follows the carbs.
  const fitted = fitItems([totals(100, 0, 20, 0), totals(100, 0, 0, 0)], totals(200, 0, 24, 0, 4));
  assert.deepEqual(fitted.map((item) => [item.carbs, item.fiber]), [[24, 4], [0, 0]]);
});

test("one item is not a breakdown", () => {
  assert.deepEqual(breakdown([{ assumptions: "Burrito bowl [800 kcal, 40P, 90C, 30F]", weight: 1 }], totals(800, 40, 90, 30)), []);
  assert.deepEqual(breakdown([{ assumptions: "No items here.", weight: 1 }], totals(800, 40, 90, 30)), []);
});

test("estimators that list the same foods are averaged by weight; one that lists them otherwise is left out", () => {
  const codex = "Chicken, 150 g [200 kcal, 40P, 0C, 4F]\n\nRice, 200 g [300 kcal, 6P, 60C, 2F]";
  const claude = "Rice, 180 g [100 kcal, 2P, 20C, 1F]\n\nChicken, 160 g [400 kcal, 44P, 0C, 6F]";
  const grok = "Chicken and rice [900 kcal, 50P, 80C, 10F]";
  const sources = [
    { assumptions: codex, weight: 75 },
    { assumptions: claude, weight: 25 },
    { assumptions: grok, weight: 100 },
  ];
  // Grok counts most but lists one item, so it gives no list; Codex leads.
  // Chicken 200 x 0.75 + 400 x 0.25 = 250, rice 300 x 0.75 + 100 x 0.25 = 250,
  // shared out over the 600 on the meal.
  const seeds = breakdown(sources, totals(600, 50, 60, 8));
  assert.deepEqual(seeds.map((seed) => [seed.name, seed.grams, seed.macros!.calories]), [
    ["Chicken", 150, 300],
    ["Rice", 200, 300],
  ]);

  const apart = breakdown([
    { assumptions: codex, weight: 75 },
    { assumptions: "Beef, 100 g [250 kcal, 26P, 0C, 15F]\n\nRice, 200 g [260 kcal, 5P, 56C, 1F]", weight: 25 },
  ], totals(500, 46, 60, 6));
  // Codex's own split, 200 to 300.
  assert.deepEqual(apart.map((seed) => seed.macros!.calories), [200, 300]);
});

test("a blended meal's working gives each estimator's items with its share", () => {
  const blend = blendEstimates([
    { provider: "codex", estimate: { name: "Bowl", calories: 500, protein: 46, carbs: 60, fat: 6, fiber: 0, alcohol: 0, confidence: "medium", assumptions: "Chicken, 150 g [200 kcal, 40P, 0C, 4F]\n\nRice, 200 g [300 kcal, 6P, 60C, 2F]" } },
    { provider: "claude", estimate: { name: "Bowl", calories: 500, protein: 46, carbs: 60, fat: 6, fiber: 0, alcohol: 0, confidence: "medium", assumptions: "Chicken, 150 g [400 kcal, 40P, 0C, 4F]\n\nRice, 200 g [100 kcal, 6P, 60C, 2F]" } },
  ], { codex: 50, claude: 50, grok: 0 })!;
  const sources = assumptionSources(blend.estimate.assumptions);
  assert.deepEqual(sources.map((source) => source.weight), [50, 50]);
  assert.deepEqual(breakdown(sources, totals(500, 46, 60, 6)).map((seed) => seed.macros!.calories), [300, 200]);
});

test("a changed item list is written first, replaces the last one, and is what opening the items reads", () => {
  const items = [
    { name: "Chicken breast", grams: 200, nutrition: { grams: 200, macros: totals(330.7, 62.7, 0, 6.7) } },
    { name: "2 large eggs", grams: 0, nutrition: { grams: 0, macros: totals(140, 12, 1, 10, 0.5) } },
  ];
  const written = withItemList(BOWL, items);
  assert.equal(written.split("\n\n")[0], [
    ITEM_LIST_HEAD,
    "Chicken breast, 200 g [330.7 kcal, 62.7P, 0C, 6.7F]",
    "2 large eggs [140 kcal, 12P, 1C, 10F, 0.5 fiber]",
  ].join("\n"));
  assert.ok(written.endsWith("Assumed no sauce."));
  assert.equal(withoutItemList(written), BOWL);
  assert.equal(withItemList(written, items), written);

  const seeds = breakdown(assumptionSources(written), totals(470.7, 74.7, 1, 16.7, 0.5));
  assert.deepEqual(seeds.map((seed) => [seed.name, seed.grams, seed.macros!.calories]), [
    ["Chicken breast", 200, 330.7],
    ["2 large eggs", 0, 140],
  ]);
  assert.ok(withItemList("x".repeat(5000), items).length <= 3000);
});

test("saved ingredients open at the grams they are at, and keep scaling from their reference", () => {
  const seeds = seedsFromIngredients([
    { name: "yogurt", grams: 450, nutrition: { grams: 225, macros: totals(120, 23, 7, 0) } },
    { name: "granola", grams: 0, nutrition: { grams: 30, macros: totals(130, 4, 18, 5, 3) } },
  ], totals(240, 46, 14, 0));
  assert.deepEqual(seeds.map((seed) => [seed.grams, seed.macros!.calories, seed.per?.grams]), [
    [450, 240, 225],
    [0, 0, 30],
  ]);
  const slid = setItemGrams(itemDraft("g", seeds[1]), "15");
  assert.deepEqual([slid.calories, slid.fiber, slid.carbs], ["65", "1.5", "9"]);
  assert.deepEqual(seedsFromIngredients([{ name: "yogurt", grams: 100 }], totals(1, 1, 1, 1)), []);
});

test("a meal with no figures opens into blank items where it was written as several", () => {
  assert.deepEqual(blankSeeds("2 eggs, toast and a flat white").map((seed) => [seed.name, seed.macros]), [
    ["2 eggs", null],
    ["toast", null],
    ["a flat white", null],
  ]);
  assert.deepEqual(blankSeeds("mac and cheese"), []);
});

test("grams scale a weighed item's figures, typing a figure sets them at its weight, and leaving the box ties them", () => {
  const [chicken] = breakdown([{ assumptions: BOWL, weight: 1 }], totals(648, 64, 57, 16, 1));
  const item = itemDraft("a", chicken);
  const doubled = setItemGrams(item, "300");
  assert.equal(Number(doubled.calories), Math.round(Number(item.calories) * 20) / 10);
  // Sliding to nothing and back loses nothing.
  assert.equal(setItemGrams(setItemGrams(item, "0"), "150").calories, item.calories);
  assert.equal(setItemGrams(item, "abc").calories, item.calories);

  const typed = setItemFigure(doubled, "calories", "500");
  assert.deepEqual(typed.per, { grams: 300, macros: { ...typed.per!.macros, calories: 500 } });
  assert.equal(setItemGrams(typed, "150").calories, "250");

  // An item with no weight takes one without scaling, digit by digit.
  let blank = setItemFigure({ ...emptyItem("b"), name: "Oil" }, "fat", "10");
  assert.equal(blank.per, null);
  blank = setItemGrams(setItemGrams(blank, "1"), "10");
  assert.deepEqual([blank.fat, blank.per], ["10", null]);
  blank = anchorItem(blank);
  assert.equal(setItemGrams(blank, "20").fat, "20");
});

test("the meal's boxes are the items added up, blank where nothing was typed", () => {
  const items = [
    { ...emptyItem("a"), calories: "0.1", protein: "10" },
    { ...emptyItem("b"), calories: "0.2", protein: "" },
  ];
  assert.deepEqual(itemTotals(items), {
    calories: "0.3", protein: "10", carbs: "", fat: "", fiber: "", ethanol: "",
  });
});

test("saving reads every item strictly, at the grams it is at", () => {
  const good = [
    { ...emptyItem("a"), name: "Rice", grams: "200", calories: "260", protein: "5", carbs: "56", fat: "1", fiber: "1", ethanol: "3" },
    { ...emptyItem("b"), name: "Black coffee", calories: "" },
  ];
  const read = readItems(good, "Lunch");
  assert.ok(read.ok);
  assert.deepEqual(read.items, [
    { name: "Rice", grams: 200, nutrition: { grams: 200, macros: totals(260, 5, 56, 1, 1, 0) } },
    { name: "Black coffee", grams: 0, nutrition: { grams: 0, macros: totals(0, 0, 0, 0) } },
  ]);
  const drinks = readItems(good, "Alcohol");
  assert.equal(drinks.ok && drinks.items[0].nutrition?.macros.alcohol, 3);

  assert.deepEqual(readItems([{ ...good[0], name: " " }], "Lunch"), { ok: false, error: "Name item 1." });
  assert.deepEqual(readItems([good[1], { ...good[0], fiber: "60" }], "Lunch"), {
    ok: false,
    error: "Item 2: Fiber is part of total carbs, so it cannot be higher.",
  });
  assert.deepEqual(readItems([{ ...good[0], grams: "6000" }], "Lunch"), {
    ok: false,
    error: "Item 1: Grams need a number up to 5000.",
  });
  assert.deepEqual(readItems([{ ...good[0], protein: "x" }], "Lunch"), {
    ok: false,
    error: "Item 1: Protein needs a number of zero or more.",
  });
  assert.deepEqual(readItems([], "Lunch"), { ok: false, error: "Add an item." });
});

test("items survive a draft, and a damaged one keeps what still reads", () => {
  const [chicken] = breakdown([{ assumptions: BOWL, weight: 1 }], totals(648, 64, 57, 16, 1));
  const item = itemDraft("a", chicken);
  assert.deepEqual(itemDraftsOf(JSON.parse(JSON.stringify([item, { id: "" }, null, { id: "b", per: { grams: 5 } }]))), [
    item,
    { ...emptyItem("b") },
  ]);
  assert.deepEqual(itemDraftsOf("nope"), []);
});

test("a shared dish opens into dishes of its own, each with the dish's share and a weighed one counted in grams", () => {
  let next = 0;
  const id = () => `d${++next}`;
  const dish = {
    ...emptyDish("bowl"),
    name: "Burrito bowl",
    calories: "648", protein: "64", carbs: "57", fat: "16", fiber: "1", ethanol: "0",
    quantity: "1 bowl",
    share: { hippos: "30", gators: "70" },
    source: "grok" as const,
    estimator: "codex" as const,
    confidence: "medium" as const,
    assumptions: BOWL,
  };
  const dishes = expandDish(dish, "Lunch", id);
  assert.deepEqual(dishes.map((made) => [made.id, made.name, made.quantity, made.share.gators, made.assumptions]), [
    ["d1", "Chicken breast, 150 g cooked", "150 g", "70", "USDA reference for grilled breast."],
    ["d2", "White rice, 200 g", "200 g", "70", ""],
    ["d3", "2 large eggs", "", "70", "boiled, no oil"],
  ]);
  assert.equal(dishes.reduce((sum, made) => sum + Number(made.calories) * 10, 0) / 10, 648);
  assert.ok(dishes.every((made) => made.source === "grok" && made.estimator === "codex" && made.confidence === "medium"));
  assert.deepEqual(expandDish({ ...dish, assumptions: "One thing [648 kcal, 64P, 57C, 16F]" }, "Lunch", id), []);
});
