import { test } from "node:test";
import assert from "node:assert/strict";
import { mealSchema } from "./validation.ts";
import {
  ASSUMPTIONS_LIMIT,
  DISH_LIMIT,
  countShare,
  dishHint,
  dishesFromEstimate,
  dishesOf,
  emptyDish,
  fillDish,
  looseDishes,
  otherShare,
  portionOf,
  readDishes,
  readQuantity,
  setFigure,
  setShare,
  shareAssumptions,
  shareTotals,
  slideShare,
  sliderSteps,
  sliderValue,
  splitMeal,
  tidyShare,
  type Dish,
  type DishDraft,
} from "./meal-dishes.ts";

const ids = {
  hippos: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  gators: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
const dinner = { kind: "meal" as const, day: "2026-10-31", time: "19:30", meal: "Dinner" as const };

function dish(id: string, over: Partial<DishDraft> = {}): DishDraft {
  return { ...emptyDish(id), ...over };
}

const pizza = dish("d1", {
  name: "Margherita pizza, 12 inch",
  calories: "880", protein: "36", carbs: "100", fat: "30", fiber: "6",
  share: { hippos: "40", gators: "60" },
});
const salad = dish("d2", {
  name: "Caesar salad",
  calories: "420", protein: "12", carbs: "16", fat: "34", fiber: "4",
});
const tiramisu = dish("d3", {
  name: "Tiramisu",
  calories: "490", protein: "8", carbs: "45", fat: "30",
  share: { hippos: "0", gators: "100" },
});

function read(drafts: DishDraft[], sitting: "Dinner" | "Alcohol" = "Dinner"): Dish[] {
  const result = readDishes(drafts, sitting);
  if (!result.ok) throw new Error(result.error);
  return result.dishes;
}

function problem(drafts: DishDraft[], sitting: "Dinner" | "Alcohol" = "Dinner") {
  const result = readDishes(drafts, sitting);
  return result.ok ? "" : result.error;
}

test("typing one share sets the other to the rest of 100", () => {
  assert.equal(otherShare("40"), "60");
  assert.equal(otherShare("100"), "0");
  assert.equal(otherShare("0"), "100");
  assert.equal(otherShare(""), "100", "blank counts as 0");
  assert.equal(otherShare("33.3"), "66.7");
  assert.equal(otherShare("40%"), "60");
  assert.equal(otherShare("abc"), null);
  assert.equal(otherShare("150"), null);
  assert.equal(otherShare("-5"), null);

  let shared = setShare(emptyDish("x"), "hippos", "30");
  assert.deepEqual(shared.share, { hippos: "30", gators: "70" });
  shared = setShare(shared, "gators", "25");
  assert.deepEqual(shared.share, { hippos: "75", gators: "25" });
  shared = setShare(shared, "gators", "2x");
  assert.deepEqual(shared.share, { hippos: "75", gators: "2x" }, "nonsense leaves the other alone");
});

test("each person's meal is their share of every dish, and the two add up to the table", () => {
  const dishes = read([pizza, salad, tiramisu]);
  const split = splitMeal({ eaters: ["hippos", "gators"], meal: dinner, name: "", dishes, ids });
  assert.ok(split.ok);
  const [hippos, gators] = split.meals;
  assert.equal(hippos.athlete, "hippos");
  assert.equal(gators.athlete, "gators");
  assert.equal(hippos.id, ids.hippos);
  assert.equal(gators.id, ids.gators);
  // 40% of the pizza and half the salad; none of the tiramisu.
  assert.deepEqual(hippos.macros, { calories: 562, protein: 20.4, carbs: 48, fat: 29, alcohol: 0, fiber: 4.4 });
  // 60% of the pizza, half the salad, all of the tiramisu.
  assert.deepEqual(gators.macros, { calories: 1228, protein: 35.6, carbs: 113, fat: 65, alcohol: 0, fiber: 5.6 });
  for (const key of ["calories", "protein", "carbs", "fat", "fiber"] as const) {
    const table = dishes.reduce((sum, item) => sum + item.macros[key], 0);
    assert.equal(Math.round(((hippos.macros[key] ?? 0) + (gators.macros[key] ?? 0)) * 10) / 10, table, key);
  }
  for (const meal of split.meals) {
    assert.equal(meal.kind, "meal");
    assert.equal(meal.day, dinner.day);
    assert.equal(meal.time, dinner.time);
    assert.equal(meal.meal, "Dinner");
    assert.equal(meal.source, "manual");
    assert.equal("estimator" in meal, false);
  }
  for (const meal of split.meals) assert.deepEqual(mealSchema.parse(meal), meal, "the server takes it as it is");
  assert.equal(hippos.name, "Margherita pizza, 12 inch, Caesar salad", "named after what she had");
  assert.equal(gators.name, "Margherita pizza, 12 inch, Caesar salad, Tiramisu");
  assert.doesNotMatch(hippos.assumptions, /Tiramisu/);
});

test("a typed name names both meals, and the time is left off when there is none", () => {
  const split = splitMeal({
    eaters: ["hippos", "gators"],
    meal: { kind: "meal", day: "2026-10-31", meal: "Dinner" },
    name: "  Friday pizza  ",
    dishes: read([pizza]),
    ids,
  });
  assert.ok(split.ok);
  assert.deepEqual(split.meals.map((meal) => meal.name), ["Friday pizza", "Friday pizza"]);
  assert.equal("time" in split.meals[0], false);
});

test("someone with no share of any dish gets no meal", () => {
  const dishes = read([tiramisu]);
  const split = splitMeal({ eaters: ["hippos", "gators"], meal: dinner, name: "", dishes, ids });
  assert.ok(split.ok);
  assert.deepEqual(split.meals.map((meal) => meal.athlete), ["gators"]);

  const alone = splitMeal({ eaters: ["hippos"], meal: dinner, name: "", dishes, ids });
  assert.deepEqual(alone, { ok: false, error: "Hippos has no share of these dishes." });
});

test("logging for one person saves only their share", () => {
  const split = splitMeal({ eaters: ["gators"], meal: dinner, name: "", dishes: read([pizza, salad]), ids });
  assert.ok(split.ok);
  assert.equal(split.meals.length, 1);
  assert.equal(split.meals[0].athlete, "gators");
  assert.equal(split.meals[0].macros.calories, 738);
});

test("a meal reads as estimated only when all of its dishes were, and names a shared estimator", () => {
  const estimate = { calories: 880, protein: 36, carbs: 100, fat: 30, fiber: 6, alcohol: 0, name: "Pizza", assumptions: "One 12-inch pie.", confidence: "medium" as const };
  const estimatedPizza = fillDish(pizza, estimate, "codex");
  const estimatedSalad = fillDish(salad, { ...estimate, calories: 420, protein: 12, carbs: 16, fat: 34, fiber: 4 }, "codex");
  assert.equal(estimatedPizza.name, pizza.name, "the dish keeps what was typed");
  assert.equal(estimatedPizza.calories, "880");
  assert.equal(estimatedPizza.source, "grok");

  let split = splitMeal({ eaters: ["hippos", "gators"], meal: dinner, name: "", dishes: read([estimatedPizza, estimatedSalad]), ids });
  assert.ok(split.ok);
  assert.deepEqual(split.meals.map((meal) => [meal.source, meal.estimator]), [["grok", "codex"], ["grok", "codex"]]);
  for (const meal of split.meals) assert.deepEqual(mealSchema.parse(meal), meal);

  const otherEstimator = fillDish(salad, { ...estimate, calories: 420 }, "claude");
  split = splitMeal({ eaters: ["hippos", "gators"], meal: dinner, name: "", dishes: read([estimatedPizza, otherEstimator]), ids });
  assert.ok(split.ok);
  assert.deepEqual(split.meals.map((meal) => [meal.source, meal.estimator]), [["grok", undefined], ["grok", undefined]]);

  const edited = setFigure(estimatedSalad, "protein", "14");
  assert.equal(edited.source, "manual");
  assert.equal(edited.adjusted, true);
  // Gators had all of the estimated dish and none of the edited one.
  const mixed = [estimatedPizza, setShare(edited, "hippos", "100")];
  mixed[0] = setShare(mixed[0], "gators", "100");
  split = splitMeal({ eaters: ["hippos", "gators"], meal: dinner, name: "", dishes: read(mixed), ids });
  assert.ok(split.ok);
  assert.deepEqual(split.meals.map((meal) => [meal.athlete, meal.source, meal.estimator]), [
    ["hippos", "manual", undefined],
    ["gators", "grok", "codex"],
  ]);
});

test("the assumptions say each share and the whole dish, and keep each dish's working", () => {
  const working = fillDish(pizza, {
    calories: 880, protein: 36, carbs: 100, fat: 30, fiber: 6, alcohol: 0,
    name: "Pizza", assumptions: "Joe's Pizza published nutrition, 8 slices.", confidence: "high",
  }, "claude");
  const dishes = read([working, tiramisu]);
  assert.equal(
    shareAssumptions(dishes, "hippos"),
    "40% of Margherita pizza, 12 inch [352 kcal, 14P, 40C, 12F, 2 fiber]\n" +
      "The whole dish [880 kcal, 36P, 100C, 30F, 6 fiber]\n" +
      "Joe's Pizza published nutrition, 8 slices.",
  );
  assert.equal(
    shareAssumptions(dishes, "gators"),
    "60% of Margherita pizza, 12 inch [528 kcal, 22P, 60C, 18F, 4 fiber]\n" +
      "The whole dish [880 kcal, 36P, 100C, 30F, 6 fiber]\n" +
      "Joe's Pizza published nutrition, 8 slices.\n\n" +
      "100% of Tiramisu [490 kcal, 8P, 45C, 30F]",
  );
});

test("long working is cut to fit, and the shares stay whole", () => {
  const long = "Item one, cut nowhere.\n\n" + "x".repeat(4000);
  const many = Array.from({ length: 4 }, (_, index) => ({
    ...read([pizza])[0],
    name: `Dish ${index + 1}`,
    assumptions: long,
  }));
  const text = shareAssumptions(many, "hippos");
  assert.ok(text.length <= ASSUMPTIONS_LIMIT, String(text.length));
  for (let index = 1; index <= 4; index += 1) assert.match(text, new RegExp(`40% of Dish ${index} \\[`));
  assert.match(text, /Item one, cut nowhere\.…/);
});

test("a long dish is kept whole, and clipped only where it names the meal", () => {
  const long = `Tasting menu: ${"course with sauce, ".repeat(200)}`.trim().slice(0, 3500);
  const dishes = read([dish("long", { name: long, calories: "1800", protein: "90", carbs: "150", fat: "80" })]);
  assert.equal(dishes[0].name, long, "the estimate still reads all of it");
  const split = splitMeal({ eaters: ["hippos", "gators"], meal: dinner, name: "", dishes, ids });
  assert.ok(split.ok);
  for (const meal of split.meals) {
    assert.ok(meal.name.length <= 300, String(meal.name.length));
    assert.ok(meal.name.endsWith("…"));
    assert.ok(meal.assumptions.length <= ASSUMPTIONS_LIMIT);
    assert.match(meal.assumptions, /… \[900 kcal, 45P, 75C, 40F\]\n/);
    assert.deepEqual(mealSchema.parse(meal), meal);
  }
  assert.equal(
    problem([dish("long", { name: "x".repeat(4001), calories: "100" })]),
    "Dish 1: the description is too long.",
  );
});

test("ethanol counts only on an Alcohol sitting", () => {
  const wine = dish("w", { name: "Red wine, 2 glasses", calories: "250", carbs: "8", ethanol: "28" });
  assert.equal(read([wine], "Dinner")[0].macros.alcohol, 0);
  const drinks = read([wine], "Alcohol");
  assert.equal(drinks[0].macros.alcohol, 28);
  assert.equal(shareTotals(drinks, "hippos").alcohol, 14);
  assert.equal(problem([dish("w", { ...wine, ethanol: "501" })], "Alcohol"), "Dish 1: Ethanol looks too high.");
  assert.equal(problem([dish("w", { ...wine, ethanol: "lots" })], "Alcohol"), "Dish 1: Ethanol needs a number of zero or more.");
  assert.equal(problem([dish("w", { name: "Shot", ethanol: "14" })], "Alcohol"), "", "ethanol alone is a value");
  assert.equal(problem([dish("w", { name: "Shot", ethanol: "14" })], "Dinner"), "Dish 1 needs at least one macro value.");
});

test("a dish is held to what a meal is held to", () => {
  assert.equal(problem([]), "Add a dish.");
  assert.equal(problem([pizza, dish("e")]), "Name dish 2.");
  assert.equal(problem([dish("n", { name: "Soup", calories: "-1" })]), "Dish 1: Calories needs a number of zero or more.");
  assert.equal(problem([dish("n", { name: "Soup", protein: "a lot" })]), "Dish 1: Protein needs a number of zero or more.");
  assert.equal(problem([dish("n", { name: "Soup", fat: "2001" })]), "Dish 1: Fat looks too high.");
  assert.equal(problem([dish("n", { name: "Soup", carbs: "5", fiber: "6" })]), "Dish 1: Fiber is part of total carbs, so it cannot be higher.");
  assert.equal(problem([dish("n", { name: "Soup" })]), "Dish 1 needs at least one macro value.");
  assert.equal(problem([dish("n", { name: "Soup", calories: "100", share: { hippos: "4o", gators: "60" } })]), "Dish 1: a share is a percentage from 0 to 100.");
  assert.equal(problem([dish("n", { name: "Soup", calories: "100", share: { hippos: "40", gators: "50" } })]), "Dish 1: the two shares have to add up to 100%.");
  assert.equal(problem([dish("n", { name: "Soup", calories: "100", share: { hippos: "", gators: "100" } })]), "");
  assert.equal(problem(Array.from({ length: DISH_LIMIT + 1 }, (_, index) => dish(String(index), { name: "Soup", calories: "1" }))), `A meal holds up to ${DISH_LIMIT} dishes.`);
});

test("a share too large for one meal is refused before it reaches the server", () => {
  const huge = Array.from({ length: 3 }, (_, index) => dish(String(index), { name: `Feast ${index}`, calories: "15000", share: { hippos: "100", gators: "0" } }));
  const split = splitMeal({ eaters: ["hippos", "gators"], meal: dinner, name: "", dishes: read(huge), ids });
  assert.deepEqual(split, { ok: false, error: "Hippos' share: Calories looks too high." });
});

test("shares are to a tenth and fiber never comes out above carbs", () => {
  const thirds = read([dish("t", { name: "Bread", calories: "100", carbs: "10", fiber: "10", share: { hippos: "33.3", gators: "66.7" } })]);
  const hippos = shareTotals(thirds, "hippos");
  assert.equal(hippos.calories, 33.3);
  assert.ok((hippos.fiber ?? 0) <= hippos.carbs);
  assert.equal(shareTotals(thirds, "gators").calories, 66.7);
});

test("the shares shown while typing count what cannot be read yet as nothing", () => {
  const loose = looseDishes([dish("l", { name: "", calories: "300", protein: "x", share: { hippos: "abc", gators: "50" } })], "Dinner");
  assert.equal(loose[0].macros.protein, 0);
  assert.equal(loose[0].share.hippos, 0);
  assert.equal(shareTotals(loose, "gators").calories, 150);
});

test("dishes come back from a draft, and a damaged one keeps what still reads", () => {
  assert.deepEqual(dishesOf(undefined), []);
  assert.deepEqual(dishesOf({ id: "x" }), []);
  const back = dishesOf([
    { ...pizza, estimator: "codex", confidence: "high", source: "grok", adjusted: false },
    { id: "", name: "no id" },
    "not a dish",
    { id: "d9", name: 7, calories: "120", share: { hippos: 1 }, estimator: "gpt", source: "queued" },
  ]);
  assert.equal(back.length, 2);
  assert.deepEqual(back[0], { ...pizza, estimator: "codex", confidence: "high", source: "grok", adjusted: false });
  assert.deepEqual(back[1], { ...emptyDish("d9"), calories: "120" });
  assert.equal(dishesOf(Array.from({ length: DISH_LIMIT + 5 }, (_, index) => ({ id: String(index) }))).length, DISH_LIMIT);
});

test("a quantity reads as a count only when it starts with a number above 0", () => {
  assert.deepEqual(readQuantity("8 slices"), { amount: 8, unit: "slices" });
  assert.deepEqual(readQuantity("  400g "), { amount: 400, unit: "g" });
  assert.deepEqual(readQuantity("6"), { amount: 6, unit: "" });
  assert.deepEqual(readQuantity("1.5 lb"), { amount: 1.5, unit: "lb" });
  assert.deepEqual(readQuantity(".5 cup"), { amount: 0.5, unit: "cup" });
  assert.deepEqual(readQuantity("8 slices (12 inch)"), { amount: 8, unit: "slices (12 inch)" });
  for (const text of ["", "slices", "eight slices", "0 slices", "1/2 pizza", "1,000 g", "2-3 tacos"])
    assert.equal(readQuantity(text), null, text);
});

test("the slider moves a unit at a time for two or more whole units, and a percent otherwise", () => {
  assert.equal(sliderSteps("8 slices"), 8);
  assert.equal(sliderSteps("400 g"), 400);
  assert.equal(sliderSteps("2 burritos"), 2);
  // One of something would be all or nothing, and part of a unit is not a step.
  assert.equal(sliderSteps("1 pizza"), 100);
  assert.equal(sliderSteps("1.5 lb"), 100);
  assert.equal(sliderSteps(""), 100);
  assert.equal(sliderSteps("a few"), 100);
});

test("sliding sets Hippos' share in the slider's steps, and Gators takes the rest", () => {
  const pie = dish("p", { name: "Margherita pizza", calories: "880", quantity: "8 slices" });
  assert.equal(sliderValue(pie), 4, "half each to start");
  const three = slideShare(pie, 3);
  assert.deepEqual(three.share, { hippos: "37.5", gators: "62.5" });
  assert.equal(sliderValue(three), 3);
  assert.deepEqual(slideShare(pie, 0).share, { hippos: "0", gators: "100" });
  assert.deepEqual(slideShare(pie, 8).share, { hippos: "100", gators: "0" });

  // Thirds still add up to the whole dish.
  const tacos = slideShare(dish("t", { name: "Tacos", calories: "600", quantity: "3 tacos" }), 1);
  assert.deepEqual(tacos.share, { hippos: "33.3333", gators: "66.6667" });
  assert.equal(problem([tacos]), "");

  // Without a count it is a percent at a time.
  const soup = dish("s", { name: "Soup", calories: "300" });
  assert.deepEqual(slideShare(soup, 70).share, { hippos: "70", gators: "30" });

  // A share typed between steps sits between them.
  assert.equal(sliderValue(setShare(pie, "hippos", "40")), 3.2);
  // A box that does not read yet leaves the slider where the other one says.
  assert.equal(sliderValue({ ...pie, share: { hippos: "4o", gators: "75" } }), 2);
  assert.equal(sliderValue({ ...pie, share: { hippos: "4o", gators: "x" } }), 4);
});

test("each of you reads as a percentage, calories, and a count when there is one", () => {
  const [pie] = looseDishes([dish("p", {
    name: "Margherita pizza", calories: "880", quantity: "8 slices", share: { hippos: "37.5", gators: "62.5" },
  })], "Dinner");
  assert.deepEqual(portionOf(pie, "hippos"), { percent: "37.5%", calories: 330, count: "3 of 8 slices" });
  assert.deepEqual(portionOf(pie, "gators"), { percent: "62.5%", calories: 550, count: "5 of 8 slices" });
  const [salad] = looseDishes([dish("s", { name: "Caesar salad", calories: "420" })], "Dinner");
  assert.deepEqual(portionOf(salad, "hippos"), { percent: "50%", calories: 210, count: "" });
  assert.equal(countShare({ amount: 6, unit: "" }, 1 / 3), "2 of 6");
  assert.equal(countShare({ amount: 400, unit: "g" }, 0.333), "133.2 of 400 g");
});

test("a share box reads to a tenth while nobody types in it", () => {
  assert.equal(tidyShare("33.3333"), "33.3");
  assert.equal(tidyShare("66.6667"), "66.7");
  assert.equal(tidyShare("37.5"), "37.5");
  assert.equal(tidyShare("100"), "100");
  assert.equal(tidyShare(" 40 % "), "40");
  assert.equal(tidyShare(""), "");
  assert.equal(tidyShare("4o"), "4o");
  assert.equal(tidyShare("120"), "120");
});

test("the assumptions say how many of a counted dish each of you had", () => {
  const pie = dish("p", {
    name: "Margherita pizza, 12 inch",
    calories: "880", protein: "36", carbs: "100", fat: "30", fiber: "6",
    quantity: "8 slices", share: { hippos: "37.5", gators: "62.5" },
    assumptions: "Joe's Pizza published nutrition, 8 slices.",
  });
  const dishes = read([pie, salad]);
  assert.equal(
    shareAssumptions(dishes, "hippos"),
    "37.5% of Margherita pizza, 12 inch (3 of 8 slices) [330 kcal, 14P, 38C, 11F, 2 fiber]\n" +
      "The whole dish [880 kcal, 36P, 100C, 30F, 6 fiber]\n" +
      "Joe's Pizza published nutrition, 8 slices.\n\n" +
      "50% of Caesar salad [210 kcal, 6P, 8C, 17F, 2 fiber]\n" +
      "The whole dish [420 kcal, 12P, 16C, 34F, 4 fiber]",
  );
  // A quantity that is not a count is left out, not guessed at.
  const loose = read([{ ...pie, quantity: "most of it" }]);
  assert.match(shareAssumptions(loose, "hippos"), /^37\.5% of Margherita pizza, 12 inch \[/);
});

test("a dish's quantity and edited assumptions come back from a draft", () => {
  const [back] = dishesOf([{ ...pizza, quantity: "8 slices", assumptions: "Edited by hand." }]);
  assert.equal(back.quantity, "8 slices");
  assert.equal(back.assumptions, "Edited by hand.");
  // A draft from before quantities has none.
  const { quantity: _quantity, ...older } = pizza;
  void _quantity;
  assert.equal(dishesOf([older])[0].quantity, "");
});

const answer = (name: string, calories: number, confidence: "low" | "medium" | "high" = "medium") => ({
  name, calories, protein: calories / 20, carbs: calories / 10, fat: calories / 40, fiber: 0, alcohol: 0,
  assumptions: `${name}, worked out.`, confidence,
});
const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

test("an estimate dish by dish becomes the dishes, each with its own working, half each", () => {
  const meal = { ...answer("Dinner", 1300), dishes: [answer("pizza", 880, "high"), answer("salad", 420)] };
  const made = dishesFromEstimate(meal, "average", counter());
  assert.deepEqual(made.map((each) => [each.id, each.name, each.calories, each.confidence, each.estimator, each.source]), [
    ["n1", "pizza", "880", "high", "average", "grok"],
    ["n2", "salad", "420", "medium", "average", "grok"],
  ]);
  assert.equal(made[0].assumptions, "pizza, worked out.");
  assert.deepEqual(made[1].share, { hippos: "50", gators: "50" });
});

test("an estimator from before dishes gives the whole meal as one dish, named as described", () => {
  const made = dishesFromEstimate(answer("Dinner", 1300), "codex", counter(), undefined, "pizza, salad");
  assert.deepEqual(made.map((each) => [each.name, each.calories, each.estimator]), [["pizza, salad", "1300", "codex"]]);
});

test("a dish estimated again keeps its share, and its count while it stays one dish", () => {
  const typed = dish("t", { name: "burger fries", quantity: "2 plates", share: { hippos: "30", gators: "70" } });
  const one = dishesFromEstimate({ ...answer("Burger and fries", 900), dishes: [answer("burger and fries", 900)] }, "claude", counter(), typed);
  assert.deepEqual(one.map((each) => [each.id, each.name, each.quantity, each.share.hippos, each.calories]), [
    ["t", "burger fries", "2 plates", "30", "900"],
  ]);
  const two = dishesFromEstimate(
    { ...answer("Burger and fries", 900), dishes: [answer("burger", 600), answer("fries", 300)] },
    "claude",
    counter(),
    typed,
  );
  assert.deepEqual(two.map((each) => [each.name, each.quantity, each.share.hippos, each.calories]), [
    ["burger", "", "30", "600"],
    ["fries", "", "30", "300"],
  ]);
});

test("the cut sent with an estimate is the phone's, within what the server takes", () => {
  assert.deepEqual(dishHint("pizza, salad and wine"), ["pizza", "salad", "wine"]);
  assert.deepEqual(dishHint("burger fries shake"), ["burger fries shake"]);
  const long = "x".repeat(3990) + ",y,z";
  const hint = dishHint(long);
  assert.ok(hint.join("").length <= 4000);
});
