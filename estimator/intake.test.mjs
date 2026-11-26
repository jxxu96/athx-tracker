import { test } from "node:test";
import assert from "node:assert/strict";
import { averageIntake, cleanIntake, sumIntake } from "./intake.mjs";
import { calculateNutrition, nutritionTask } from "./nutrition.mjs";
import { DISH_INSTRUCTIONS, DISH_SCHEMA, INSTRUCTIONS, SCHEMA } from "./prompts.mjs";
import { MEAL_TASK } from "./providers.mjs";
import { clean, cleanDishes, settle, settleDishes } from "./settle.mjs";

const answer = (over = {}) => ({
  name: "Ramen", calories: 900, protein: 40, carbs: 100, fat: 35, fiber: 4, alcohol: 0,
  assumptions: "Ramen, 1 bowl [900 kcal, 40P, 100C, 35F, 4 fiber]\nReference values.",
  confidence: "medium",
  intake: { sodium: 3800, sugar: 9, caffeine: 0, fruit: 0, vegetables: 60 },
  ...over,
});

test("every provider is asked for intake, for the meal and for each dish", () => {
  for (const instructions of [INSTRUCTIONS, DISH_INSTRUCTIONS]) {
    assert.match(instructions, /sodium in mg/);
    assert.match(instructions, /total sugars in g/);
    assert.match(instructions, /caffeine in mg/);
    assert.match(instructions, /Fruit juice is not fruit/);
    assert.match(instructions, /Potatoes, sweet potatoes, cassava and other starchy roots are not vegetables/);
    assert.match(instructions, /Intake does not change confidence/);
  }
  assert.match(DISH_INSTRUCTIONS, /Give each dish its own intake/);
  assert.ok(SCHEMA.required.includes("intake"));
  assert.deepEqual(SCHEMA.properties.intake.required, ["sodium", "sugar", "caffeine", "fruit", "vegetables"]);
  assert.equal(SCHEMA.properties.intake.additionalProperties, false);
  assert.ok(DISH_SCHEMA.properties.dishes.items.required.includes("intake"));
});

test("intake rides along, and never makes an answer unusable", () => {
  assert.deepEqual(clean(answer()).intake, { sodium: 3800, sugar: 9, caffeine: 0, fruit: 0, vegetables: 60 });
  // An answer from before intake, or with none that reads, is the same answer without it.
  const { intake: _, ...older } = answer();
  assert.equal(clean(older).intake, undefined);
  assert.equal(clean(older).calories, 900);
  assert.equal(clean(answer({ intake: "lots" })).intake, undefined);
  // Only the figure that does not read is left out.
  assert.deepEqual(
    clean(answer({ intake: { sodium: -1, sugar: "x", caffeine: 95.04, fruit: 999999, vegetables: null } })).intake,
    { caffeine: 95 },
  );
  // Sugar is part of the carbs, so it is held to them.
  assert.equal(clean(answer({ carbs: 20, fiber: 0, intake: { sugar: 30 } })).intake.sugar, 20);
});

test("intake is averaged by the same weights, and a 0 counts", () => {
  const codex = { provider: "codex", estimate: clean(answer({ confidence: "low", intake: { sodium: 4000, caffeine: 0, fruit: 0, vegetables: 80, sugar: 10 } })) };
  const claude = { provider: "claude", estimate: clean(answer({ confidence: "low", intake: { sodium: 3000, caffeine: 70, fruit: 0, vegetables: 40, sugar: 6 } })) };
  const { intake: _, ...bare } = answer({ confidence: "low" });
  const grok = { provider: "grok", estimate: clean(bare) };
  const { estimate } = settle([codex, claude, grok]);
  // Codex 40 to Claude 35; Grok gave none, so it is not in intake's average.
  assert.equal(estimate.intake.sodium, 3533.3);
  assert.equal(estimate.intake.caffeine, 32.7);
  assert.equal(estimate.intake.fruit, 0);
  // Intake stays out of the working.
  assert.doesNotMatch(estimate.assumptions, /sodium|caffeine/i);
  // Nobody gave any: none.
  assert.equal(settle([grok, { ...grok, provider: "claude" }]).estimate.intake, undefined);
});

test("a shared meal's intake is its dishes added up, and each dish is averaged", () => {
  const pizza = answer({ name: "Pizza", intake: { sodium: 2000, sugar: 8, caffeine: 0, fruit: 0, vegetables: 50 } });
  const coke = answer({ name: "Coke", calories: 140, protein: 0, carbs: 39, fat: 0, fiber: 0, intake: { sodium: 45, sugar: 39, caffeine: 34, fruit: 0, vegetables: 0 } });
  const meal = cleanDishes(answer({ name: "Dinner", intake: { sodium: 1 }, dishes: [pizza, coke] }));
  assert.deepEqual(meal.intake, { sodium: 2045, sugar: 47, caffeine: 34, fruit: 0, vegetables: 50 });
  // A dish without intake: the meal's own, as it gave it.
  const { intake: _, ...bareCoke } = coke;
  assert.deepEqual(cleanDishes(answer({ name: "Dinner", intake: { sodium: 1 }, dishes: [pizza, bareCoke] })).intake, { sodium: 1 });

  const shared = (provider, sodium) => ({
    provider,
    estimate: cleanDishes(answer({
      name: "Dinner",
      dishes: [
        answer({ name: "Pizza", intake: { sodium, sugar: 8, caffeine: 0, fruit: 0, vegetables: 50 } }),
        coke,
      ],
    })),
  });
  const { estimate } = settleDishes([shared("codex", 2000), shared("claude", 3000)]);
  // 40 to 35 on the pizza; the Coke is the same either way.
  assert.equal(estimate.dishes[0].intake.sodium, 2466.7);
  assert.equal(estimate.dishes[1].intake.caffeine, 34);
  assert.equal(estimate.intake.sodium, 2511.7);
});

test("source-backed totals keep the intake the provider gave", () => {
  const item = {
    identity: "Ramen", variant: "tonkotsu", region: "US", dish: 0, amount: 1, basisAmount: 1, unit: "bowl",
    calories: 900, protein: 40, carbs: 100, fat: 35, fiber: 4, alcohol: 0, basis: "reference", url: "", excerpt: "",
  };
  const nutrition = { complete: true, notes: "", items: [item] };
  assert.ok(calculateNutrition(nutrition));
  const task = nutritionTask(MEAL_TASK, () => {});
  assert.equal(task.clean({ ...answer(), nutrition }).intake.sodium, 3800);
});

test("intake helpers add and average only what was given", () => {
  assert.equal(cleanIntake(undefined), undefined);
  assert.equal(cleanIntake({}), undefined);
  assert.deepEqual(sumIntake([{ sodium: 1 }, { sodium: 2, fruit: 3 }, undefined]), { sodium: 3, fruit: 3 });
  assert.equal(sumIntake([undefined]), undefined);
  assert.deepEqual(averageIntake([{ intake: { sodium: 10 }, weight: 1 }, { intake: { sodium: 20 }, weight: 3 }]), { sodium: 17.5 });
  assert.equal(averageIntake([{ intake: { sodium: 10 }, weight: 0 }]), undefined);
});
