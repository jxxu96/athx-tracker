import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, MEAL_TEMPLATE_LIMIT, type Meal, type MealTemplate } from "./domain.ts";
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

test("a snack template cannot keep another sitting's ethanol", () => {
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
  assert.equal(built.template.macros.alcohol, 0);
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
