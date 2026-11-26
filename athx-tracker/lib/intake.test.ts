import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTAKE_CEILINGS,
  INTAKE_KEYS,
  averageIntake,
  heldOf,
  holdIntake,
  intakeOf,
  scaledIntake,
  sumIntake,
} from "./intake.ts";
import { estimateSchema, mealSchema, settingsSchema } from "./validation.ts";
import { blendEstimates } from "./estimate-blend.ts";
import { ownPrevious, type MealEstimate } from "./estimate-conversation.ts";
import { fillQueuedMeal } from "./queue-rules.ts";
import { fanOutMeal } from "./meal-fanout.ts";
import { buildTemplate, mealOffers } from "./meal-templates.ts";
import { dishesFromEstimate, dishesOf, emptyDish, looseDishes, readDishes, scaleDish, splitMeal } from "./meal-dishes.ts";
import { expandDish } from "./meal-items.ts";
import { DEFAULT_SETTINGS, type Meal } from "./domain.ts";

const ramen = { sodium: 3800, sugar: 9, caffeine: 0, fruit: 0, vegetables: 60 };
const estimate = (over: Partial<MealEstimate> = {}): MealEstimate => ({
  name: "Ramen", calories: 900, protein: 40, carbs: 100, fat: 35, fiber: 4, alcohol: 0,
  assumptions: "Ramen [900 kcal, 40P, 100C, 35F, 4 fiber]", confidence: "medium", intake: ramen, ...over,
});
const meal = (over: Partial<Meal> = {}): Meal => ({
  id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1234", kind: "meal", athlete: "hippos", day: "2026-11-20",
  name: "Ramen", meal: "Dinner", macros: { calories: 900, protein: 40, carbs: 100, fat: 35, alcohol: 0, fiber: 4 },
  source: "grok", assumptions: "", ...over,
});

test("the app and the estimator ask for the same intake", async () => {
  // Not a literal specifier, for the reason validation.test.ts gives.
  const estimatorModule = "../../estimator/intake.mjs";
  const { INTAKE_SCHEMA } = (await import(estimatorModule)) as { INTAKE_SCHEMA: unknown };
  const { foodFormat } = await import("./grok.ts");
  assert.deepEqual(foodFormat.schema.properties.intake, INTAKE_SCHEMA);
  for (const key of INTAKE_KEYS) {
    const at = { ...estimate(), intake: { [key]: INTAKE_CEILINGS[key] } };
    assert.deepEqual(estimateSchema.parse(at).intake, { [key]: INTAKE_CEILINGS[key] }, key);
  }
});

test("an intake that does not read is dropped, never the estimate or the meal", () => {
  assert.deepEqual(estimateSchema.parse(estimate()).intake, ramen);
  for (const intake of [{ sodium: -1 }, { sodium: INTAKE_CEILINGS.sodium + 1 }, { salt: 3 }, "lots"]) {
    const parsed = estimateSchema.safeParse({ ...estimate(), intake });
    assert.ok(parsed.success, JSON.stringify(intake));
    assert.equal(parsed.data.intake, undefined);
  }
  const older: Partial<MealEstimate> = estimate();
  delete older.intake;
  assert.equal(estimateSchema.parse(older).intake, undefined);
  assert.deepEqual(estimateSchema.parse({ ...estimate(), dishes: [estimate()] }).dishes?.[0].intake, ramen);
  assert.deepEqual((mealSchema.parse(meal({ intake: ramen })) as Meal).intake, ramen);
  assert.ok(mealSchema.safeParse(meal({ intake: { sodium: -5 } as never })).success);
  assert.ok(mealSchema.safeParse(meal()).success, "a meal without intake still saves");
  const template = {
    id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1235", name: "Ramen", meal: "Dinner" as const,
    items: [{ name: "ramen", grams: 0 }], macros: meal().macros, assumptions: "", sourceKey: "", intake: ramen,
  };
  const settings = settingsSchema.parse({ ...DEFAULT_SETTINGS, mealTemplates: { hippos: [template], gators: [] } });
  assert.deepEqual(settings.mealTemplates.hippos[0].intake, ramen);
});

test("held intake follows the calories it is saved with", () => {
  const held = holdIntake(estimate());
  assert.deepEqual(held, { intake: ramen, calories: 900 });
  assert.deepEqual(scaledIntake(held, 450), { sodium: 1900, sugar: 4.5, caffeine: 0, fruit: 0, vegetables: 30 });
  assert.deepEqual(scaledIntake(held, 900), ramen);
  // No calories on either side, as with a diet soda: as it came.
  const soda = holdIntake(estimate({ calories: 0, intake: { caffeine: 46, sodium: 40 } }));
  assert.deepEqual(scaledIntake(soda, 0), { caffeine: 46, sodium: 40 });
  assert.deepEqual(scaledIntake(soda, 5), { caffeine: 46, sodium: 40 });
  // Never past a ceiling.
  assert.equal(scaledIntake({ intake: { sodium: 40000 }, calories: 100 }, 1000)?.sodium, INTAKE_CEILINGS.sodium);
  assert.equal(scaledIntake(null, 900), undefined);
  assert.equal(holdIntake(estimate({ intake: undefined })), null);
  // A draft's copy, read without trusting it.
  assert.deepEqual(heldOf(JSON.parse(JSON.stringify(held))), held);
  assert.equal(heldOf({ intake: { sodium: "x" }, calories: 900 }), null);
  assert.equal(heldOf("x"), null);
  assert.deepEqual(intakeOf({ sodium: 1.04, fruit: Number.NaN }), { sodium: 1 });
});

test("intake adds and averages only what was given, and a 0 counts", () => {
  assert.deepEqual(sumIntake([{ sodium: 1 }, undefined, { sodium: 2, fruit: 3 }]), { sodium: 3, fruit: 3 });
  assert.equal(sumIntake([]), undefined);
  assert.deepEqual(
    averageIntake([{ intake: { caffeine: 0 }, weight: 1 }, { intake: { caffeine: 90 }, weight: 2 }, { weight: 5 }]),
    { caffeine: 60 },
  );
});

test("blending answers averages their intake by the same shares", () => {
  const blended = blendEstimates([
    { provider: "codex", estimate: estimate({ intake: { sodium: 4000, caffeine: 0 } }) },
    { provider: "claude", estimate: estimate({ intake: { sodium: 3000, caffeine: 70 } }) },
    { provider: "grok", estimate: estimate({ intake: undefined }) },
  ]);
  // 40 to 35: Grok gave none.
  assert.deepEqual(blended?.estimate.intake, { sodium: 3533.3, caffeine: 32.7 });
  assert.doesNotMatch(blended?.estimate.assumptions ?? "", /sodium/i);
  const own = ownPrevious(estimate(), { assumptions: estimate().assumptions }, [{ provider: "codex", estimate: estimate() }]);
  assert.deepEqual(own?.codex?.intake, ramen);
});

test("a background estimate fills the intake, for both records alike", () => {
  const queued = meal({ source: "queued", assumptions: "ramen", macros: { calories: 0, protein: 0, carbs: 0, fat: 0, alcohol: 0, fiber: 0 } });
  assert.deepEqual(fillQueuedMeal(queued, estimate()).intake, ramen);
  assert.equal("intake" in fillQueuedMeal(queued, estimate({ intake: undefined })), false);

  const both = fanOutMeal({ loggingFor: "both", editing: null, draft: meal({ intake: ramen }), ids: { hippos: "h", gators: "g" } });
  assert.deepEqual(both.map((record) => record.intake), [ramen, ramen]);
  assert.notEqual(both[0].intake, both[1].intake, "the two records cannot change each other");
});

test("a shared meal gives each of you your share of each dish's intake", () => {
  const ids = { hippos: "a1b2c3d4-0000-4000-8000-000000000001", gators: "a1b2c3d4-0000-4000-8000-000000000002" };
  const [pizza] = dishesFromEstimate(estimate({ name: "Pizza", calories: 1000, intake: { sodium: 2000, vegetables: 100 } }), "codex", () => "p");
  const [coke] = dishesFromEstimate(estimate({ name: "Coke", calories: 140, carbs: 39, fiber: 0, intake: { caffeine: 34, sugar: 39 } }), "codex", () => "c");
  const salad = { ...emptyDish("s"), name: "Salad", calories: "200", carbs: "10" };
  const drafts = [
    { ...pizza, share: { hippos: "40", gators: "60" } },
    { ...coke, share: { hippos: "100", gators: "0" } },
    salad,
  ];
  const read = readDishes(drafts);
  assert.ok(read.ok);
  const split = splitMeal({ eaters: ["hippos", "gators"], meal: { kind: "meal", day: "2026-11-20", meal: "Dinner" }, name: "", dishes: read.dishes, ids });
  assert.ok(split.ok);
  const [hippos, gators] = split.meals;
  // The salad was typed by hand, so it adds nothing.
  assert.deepEqual(hippos.intake, { sodium: 800, sugar: 39, caffeine: 34, vegetables: 40 });
  assert.deepEqual(gators.intake, { sodium: 1200, vegetables: 60 });
  for (const record of split.meals) assert.ok(mealSchema.safeParse(record).success);

  // A dish made smaller is saved with less of everything.
  const [half] = looseDishes([scaleDish(pizza, 50)]);
  assert.deepEqual(half.intake, { sodium: 1000, vegetables: 50 });
  // Nothing with an estimate's intake: none.
  const plain = readDishes([salad]);
  assert.ok(plain.ok);
  const none = splitMeal({ eaters: ["gators"], meal: { kind: "meal", day: "2026-11-20", meal: "Dinner" }, name: "", dishes: plain.dishes, ids });
  assert.ok(none.ok);
  assert.equal("intake" in none.meals[0], false);
  // A draft keeps it.
  assert.deepEqual(dishesOf(JSON.parse(JSON.stringify([pizza])))[0].intake, pizza.intake);
  assert.equal(dishesOf([{ id: "old", name: "Older draft" }])[0].intake, null);
});

test("a dish opened into its items shares its intake out by their calories", () => {
  let next = 0;
  const [bowl] = dishesFromEstimate(estimate({
    name: "Burrito bowl", calories: 648, protein: 64, carbs: 57, fat: 16, fiber: 1,
    assumptions: "Chicken breast, 150 g cooked [248 kcal, 47P, 0C, 5F]\nUSDA.\n\nWhite rice, 200 g [260 kcal, 5P, 57C, 1F, 1 fiber]\n\n2 large eggs [140 kcal, 12P, 0C, 10F]",
    intake: { sodium: 648 },
  }), "codex", () => "bowl");
  const items = expandDish(bowl, () => `d${++next}`);
  assert.equal(items.length, 3);
  const total = looseDishes(items).reduce((sum, item) => sum + (item.intake?.sodium ?? 0), 0);
  assert.equal(Math.round(total), 648);
});

test("templates and repeated meals keep the intake they came with", () => {
  const built = buildTemplate({
    id: "t", name: "Ramen", meal: "Dinner", items: [{ name: "ramen", grams: 0 }],
    macros: meal().macros, assumptions: "", sourceKey: "", intake: { ...ramen, sodium: -1 },
  });
  assert.ok(built.ok);
  assert.deepEqual(built.template.intake, { sugar: 9, caffeine: 0, fruit: 0, vegetables: 60 });
  const offers = mealOffers([built.template], [], "2026-11-20");
  assert.deepEqual(offers[0].intake, built.template.intake);
  const repeated = mealOffers([], [
    meal({ id: "a", day: "2026-11-18", name: "Oats", intake: { fruit: 120 } }),
    meal({ id: "b", day: "2026-11-19", name: "Oats", intake: { fruit: 80 } }),
  ], "2026-11-20");
  assert.deepEqual(repeated[0].intake, { fruit: 80 }, "the latest one's");
});
