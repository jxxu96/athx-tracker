import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, MEAL_TEMPLATE_LIMIT, type Meal, type MealTemplate, type MealTemplateItem } from "./domain.ts";
import { settingsSchema } from "./validation.ts";
import {
  buildTemplate,
  formatGrams,
  itemsFromText,
  mealOffers,
  parseMealItems,
  templateDescription,
  upsertTemplate,
} from "./meal-templates.ts";

import {
  amountOf,
  countOf,
  ingredientTotals,
  itemWithEstimate,
  leftOut,
  servedItems,
  withAmount,
  withCount,
} from "./meal-ingredients.ts";

const today = "2026-10-23";
const macros = { calories: 455, protein: 30, carbs: 50, fat: 15, alcohol: 0, fiber: 0 };

function meal(overrides: Partial<Meal> & Pick<Meal, "day" | "name">): Meal {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    kind: "meal",
    athlete: "hippos",
    meal: "Breakfast",
    macros,
    source: "manual",
    assumptions: "",
    ...overrides,
  };
}

function template(overrides: Partial<MealTemplate> & Pick<MealTemplate, "id" | "name">): MealTemplate {
  return {
    meal: "Breakfast",
    items: [{ name: "oats", grams: 80 }],
    macros,
    assumptions: "",
    sourceKey: "",
    ...overrides,
  };
}

test("a description splits into foods, and grams can lead or follow", () => {
  assert.deepEqual(parseMealItems("80 g oats, 2 eggs, banana"), [
    { name: "oats", grams: 80 },
    { name: "2 eggs", grams: 0 },
    { name: "banana", grams: 0 },
  ]);
  assert.deepEqual(parseMealItems("oats 80g"), [{ name: "oats", grams: 80 }]);
  assert.deepEqual(parseMealItems("80g of chicken thigh"), [{ name: "chicken thigh", grams: 80 }]);
  assert.deepEqual(parseMealItems(""), []);
  assert.deepEqual(itemsFromText("", "Soup"), [{ name: "Soup", grams: 0 }]);
});

test("the description written back is what a later estimate would read", () => {
  const items = parseMealItems("Two eggs, 80 g oats with milk, banana, flat white");
  assert.equal(templateDescription(items), "Two eggs, 80 g oats with milk, banana, flat white");
  assert.equal(formatGrams(0), "");
  assert.equal(templateDescription([{ name: "2 eggs", grams: 0 }]), "2 eggs");
});

test("saving the same meal again updates it, and the list stops at the limit", () => {
  const first = buildTemplate({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Morning oats",
    meal: "Breakfast",
    items: [{ name: "oats", grams: 80 }, { name: "2 eggs", grams: 0 }],
    macros,
    assumptions: "today",
    sourceKey: "morning oats",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const again = buildTemplate({
    ...first.template,
    id: "00000000-0000-4000-8000-000000000002",
    name: "Hippos breakfast",
    items: [{ name: "oats", grams: 100 }, { name: "2 eggs", grams: 0 }],
  });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  const saved = upsertTemplate([first.template], again.template);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.templates.length, 1);
  assert.equal(saved.id, first.template.id);
  assert.equal(saved.templates[0].name, "Hippos breakfast");
  assert.equal(saved.templates[0].sourceKey, "morning oats");
  assert.equal(saved.templates[0].items[0].grams, 100);
  assert.equal(saved.templates[0].meal, "Breakfast");

  const full = Array.from({ length: MEAL_TEMPLATE_LIMIT }, (_, index) =>
    template({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `Bowl ${index}`,
    }),
  );
  const extra = upsertTemplate(full, template({
    id: "00000000-0000-4000-8000-000000000099",
    name: "One more",
  }));
  assert.equal(extra.ok, false);
});

test("a kept meal replaces its repeated suggestion, and a rename does not bring it back", () => {
  const oats = [
    meal({ day: "2026-10-23", name: "Usual oats", assumptions: "80 g oats, 2 eggs" }),
    meal({ day: "2026-10-22", name: "Usual oats" }),
  ];
  const open = mealOffers([], oats, today);
  assert.equal(open.length, 1);
  assert.equal(open[0].saved, false);
  assert.deepEqual(open[0].items, [
    { name: "oats", grams: 80 },
    { name: "2 eggs", grams: 0 },
  ]);

  const kept = template({
    id: "00000000-0000-4000-8000-000000000010",
    name: "Hippos breakfast",
    sourceKey: "usual oats",
    items: [{ name: "oats", grams: 100 }],
  });
  const offers = mealOffers([kept], oats, today);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].saved, true);
  assert.equal(offers[0].name, "Hippos breakfast");
  assert.equal(offers[0].items[0].grams, 100);

  const named = mealOffers([template({
    id: "00000000-0000-4000-8000-000000000011",
    name: "Shake",
    sourceKey: "",
    items: [{ name: "Shake", grams: 0 }],
  })], oats, today);
  assert.deepEqual(named.map((offer) => offer.name), ["Shake", "Usual oats"]);
});

test("an older template can recover item nutrition from its saved estimate", () => {
  const items = parseMealItems("80 g oats, 2 eggs");
  const macros = { calories: 460, protein: 22, carbs: 55, fat: 16, fiber: 8 };
  const assumptions = [
    "80 g oats [300 kcal, 10P, 54C, 6F, 8 fiber]",
    "Eggs, 2 large [160 kcal, 12P, 1C, 10F]",
  ].join("\n\n");
  const legacy = template({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Oats and eggs",
    items,
    macros,
    assumptions,
  });
  const [offer] = mealOffers([legacy], [], today);
  const oats = offer.items[0];
  assert.equal(oats.nutrition?.grams, 80);
  assert.deepEqual(ingredientTotals([{ ...oats, grams: 40 }, offer.items[1]]), {
    calories: 310, protein: 17, carbs: 28, fat: 13, fiber: 4, alcohol: 0,
  });
  const [countFirst] = mealOffers([{ ...legacy, assumptions: assumptions.replace("Eggs, 2 large", "2 eggs") }], [], today);
  assert.deepEqual(countFirst.items, offer.items);
  const [stale] = mealOffers([{ ...legacy, items: [{ ...items[0], grams: 50 }, items[1]] }], [], today);
  assert.equal(stale.items[0].nutrition, undefined);
});

test("a snack template keeps its ethanol, as any sitting does", () => {
  const built = buildTemplate({
    id: "00000000-0000-4000-8000-000000000003",
    name: "Evening",
    meal: "Snack",
    items: [{ name: "yogurt", grams: 170 }],
    macros: { ...macros, alcohol: 12 },
    assumptions: "",
    sourceKey: "",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.template.macros.alcohol, 12);
});

test("settings saved before templates still parse, and a template has to be a real meal", () => {
  const legacy: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS };
  delete legacy.mealTemplates;
  assert.deepEqual(settingsSchema.parse(legacy).mealTemplates, { hippos: [], gators: [] });

  const base = settingsSchema.parse(DEFAULT_SETTINGS);
  const good = template({
    id: "00000000-0000-4000-8000-000000000004",
    name: "Oats",
  });
  assert.equal(settingsSchema.safeParse({
    ...base,
    mealTemplates: { hippos: [good], gators: [] },
  }).success, true);
  assert.equal(settingsSchema.safeParse({
    ...base,
    mealTemplates: { hippos: [{ ...good, items: [] }], gators: [] },
  }).success, false);
  assert.equal(settingsSchema.safeParse({
    ...base,
    mealTemplates: {
      hippos: [{ ...good, macros: { ...good.macros, fiber: 80 } }],
      gators: [],
    },
  }).success, false);
});

const per = (calories: number, protein: number, carbs: number, fat: number) =>
  ({ calories, protein, carbs, fat, fiber: 0, alcohol: 0 });

test("an item slid to zero stays with the template but out of the meal", () => {
  const items = [
    { name: "whey concentrate", grams: 34, nutrition: { grams: 34, macros: per(130, 26, 3, 2) } },
    { name: "2% milk", grams: 250, nutrition: { grams: 250, macros: per(125, 8.5, 12, 5) } },
    { name: "0% milk", grams: 0, nutrition: { grams: 250, macros: per(85, 8.5, 12, 0) } },
    { name: "decaf coffee powder", grams: 0, nutrition: { grams: 3, macros: per(3, 0.4, 0.2, 0) } },
  ];
  assert.equal(templateDescription(items), "34 g whey concentrate, 250 g 2% milk");
  assert.deepEqual(servedItems(items).map((item) => item.name), ["whey concentrate", "2% milk"]);
  assert.deepEqual(ingredientTotals(items), { calories: 255, protein: 34.5, carbs: 15, fat: 7, fiber: 0, alcohol: 0 });

  // Swap the milk and add half a portion of coffee.
  const swapped = [items[0], withAmount(items[1], 0), withAmount(items[2], 250), withAmount(items[3], 1.5)];
  assert.equal(templateDescription(swapped), "34 g whey concentrate, 250 g 0% milk, 1.5 g decaf coffee powder");
  assert.deepEqual(ingredientTotals(swapped), { calories: 216.5, protein: 34.7, carbs: 15.1, fat: 2, fiber: 0, alcohol: 0 });

  // Zero is only an option once the item has its own figures; otherwise it is counted, as "2 eggs" is.
  assert.equal(leftOut({ name: "oats", grams: 0 }), false);
  assert.equal(templateDescription([{ name: "oats", grams: 0 }]), "oats");
  // One without its own figures could not be slid up, so there are no totals.
  assert.equal(ingredientTotals([...items, { name: "honey", grams: 10 }]), undefined);

  const built = buildTemplate({
    id: "00000000-0000-4000-8000-000000000005",
    name: "Shake",
    meal: "Snack",
    items,
    macros: ingredientTotals(items)!,
    assumptions: "",
    sourceKey: "",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.deepEqual(built.template.items.map((item) => item.grams), [34, 250, 0, 0]);
  const base = settingsSchema.parse(DEFAULT_SETTINGS);
  assert.equal(settingsSchema.safeParse({
    ...base,
    mealTemplates: { hippos: [built.template], gators: [] },
  }).success, true);

  const allZero = buildTemplate({
    id: "00000000-0000-4000-8000-000000000006",
    name: "Nothing",
    meal: "Snack",
    items: items.map((item) => withAmount(item, 0)),
    macros,
    assumptions: "",
    sourceKey: "",
  });
  assert.deepEqual(allZero, { ok: false, error: "Keep at least one item above zero." });
});

test("an option ticked off in an older template reads as zero and is not written again", () => {
  const ticked = template({
    id: "00000000-0000-4000-8000-000000000007",
    name: "Shake",
    items: [
      { name: "whey concentrate", grams: 34, nutrition: { grams: 34, macros: per(130, 26, 3, 2) } },
      { name: "0% milk", grams: 250, nutrition: { grams: 250, macros: per(85, 8.5, 12, 0) }, off: true },
      { name: "1 banana", grams: 0, nutrition: { grams: 0, macros: per(105, 1, 27, 0) }, off: true },
    ],
    macros: per(130, 26, 3, 2),
  });
  // Still readable from settings saved while it was written.
  const base = settingsSchema.parse(DEFAULT_SETTINGS);
  assert.equal(settingsSchema.safeParse({ ...base, mealTemplates: { hippos: [ticked], gators: [] } }).success, true);

  const [offer] = mealOffers([ticked], [], today);
  assert.deepEqual(offer.items.map((item) => [item.name, item.grams, "off" in item]), [
    ["whey concentrate", 34, false],
    ["0% milk", 0, false],
    ["0 banana", 0, false],
  ]);
  assert.equal(templateDescription(offer.items), "34 g whey concentrate");
  assert.equal(ingredientTotals(offer.items)?.calories, 130);
  const built = buildTemplate({ ...ticked, items: ticked.items });
  assert.equal(built.ok && built.template.items.some((item) => "off" in item), false);
});

test("a counted item slides by how many, from the count in its name", () => {
  assert.deepEqual(countOf("2 eggs"), { count: 2, base: "eggs", plain: true });
  assert.deepEqual(countOf("1.5 × 250ml 2% milk"), { count: 1.5, base: "250ml 2% milk", plain: false });
  assert.deepEqual(countOf("2% milk"), { count: 1, base: "2% milk", plain: false });
  assert.deepEqual(countOf("250ml 2% milk"), { count: 1, base: "250ml 2% milk", plain: false });
  assert.equal(withCount("2 eggs", 3), "3 eggs");
  assert.equal(withCount("250ml 2% milk", 1.5), "1.5 × 250ml 2% milk");
  assert.equal(withCount("1.5 × 250ml 2% milk", 1), "250ml 2% milk");

  const eggs: MealTemplateItem = { name: "2 eggs", grams: 0, nutrition: { grams: 0, macros: per(140, 12, 1, 10) } };
  const milk: MealTemplateItem = { name: "250ml 2% milk", grams: 0, nutrition: { grams: 0, macros: per(125, 8, 12, 5) } };
  const oats: MealTemplateItem = { name: "oats", grams: 80, nutrition: { grams: 80, macros: per(300, 10, 54, 6) } };
  // Before any slide, the count in the name is the one its figures are for.
  assert.equal(ingredientTotals([oats, eggs, milk])?.calories, 565);

  const more = withAmount(eggs, 3);
  assert.deepEqual(more, { name: "3 eggs", grams: 0, nutrition: { grams: 0, macros: eggs.nutrition!.macros, count: 2 } });
  assert.equal(amountOf(more), 3);
  const less = withAmount(withAmount(milk, 1.5), 0.5);
  assert.equal(less.name, "0.5 × 250ml 2% milk");
  assert.equal(less.nutrition?.count, 1);
  assert.deepEqual(ingredientTotals([oats, more, less]), {
    calories: 572.5, protein: 32, carbs: 61.5, fat: 23.5, fiber: 0, alcohol: 0,
  });
  assert.equal(templateDescription([oats, more, less]), "80 g oats, 3 eggs, 0.5 × 250ml 2% milk");

  const none = withAmount(eggs, 0);
  assert.equal(leftOut(none), true);
  assert.equal(templateDescription([oats, none]), "80 g oats");
  // Back up from zero, against the two it was estimated for.
  assert.equal(ingredientTotals([oats, withAmount(none, 1)])?.calories, 370);
});

test("a food estimated on its own keeps the estimate as its figures at that portion", () => {
  const item = itemWithEstimate(
    { name: "decaf coffee powder", grams: 3 },
    { calories: 4, protein: 0.4, carbs: 0.5, fat: 0, fiber: 0.9 },
  );
  assert.deepEqual(item, {
    name: "decaf coffee powder",
    grams: 3,
    nutrition: { grams: 3, macros: { calories: 4, protein: 0.4, carbs: 0.5, fat: 0, fiber: 0.5, alcohol: 0 } },
  });
  // A counted food keeps a fixed portion.
  assert.equal(itemWithEstimate({ name: "1 banana", grams: 0 }, macros).nutrition?.grams, 0);
});
