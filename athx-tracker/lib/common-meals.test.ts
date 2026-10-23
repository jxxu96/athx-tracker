import { test } from "node:test";
import assert from "node:assert/strict";
import { commonMeals, mealKey } from "./common-meals.ts";
import type { Meal } from "./domain.ts";

const today = "2026-10-23";

function meal(overrides: Partial<Meal> & Pick<Meal, "day" | "name">): Meal {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    kind: "meal",
    athlete: "hippos",
    meal: "Breakfast",
    macros: { calories: 455, protein: 30, carbs: 50, fat: 15 },
    source: "manual",
    assumptions: "",
    ...overrides,
  };
}

test("punctuation and filler words do not split one dish into two", () => {
  assert.equal(mealKey("Oats & eggs"), mealKey("oats and eggs"));
  assert.equal(mealKey("Oats, eggs!"), mealKey("oats eggs"));
  assert.notEqual(mealKey("Protein shake"), mealKey("Protein shake 30g"));
});

test("a meal logged once is not common, and two days of it are", () => {
  const once = commonMeals([
    meal({ day: "2026-10-23", name: "Soup" }),
    meal({ day: "2026-10-23", name: "Soup" }),
  ], today);
  assert.deepEqual(once, []);

  const latestMacros = { calories: 455, protein: 30, carbs: 50, fat: 15 };
  const twice = commonMeals([
    meal({ day: "2026-10-23", name: "Oats & eggs", macros: latestMacros, assumptions: "today" }),
    meal({
      day: "2026-10-21",
      name: "oats and eggs",
      macros: { calories: 400, protein: 20, carbs: 40, fat: 16 },
      assumptions: "older",
    }),
  ], today);
  assert.equal(twice.length, 1);
  assert.equal(twice[0].name, "Oats & eggs");
  assert.equal(twice[0].days, 2);
  assert.deepEqual(twice[0].macros, latestMacros);
  assert.notEqual(twice[0].macros, latestMacros);
  twice[0].macros.protein = 1;
  assert.equal(latestMacros.protein, 30);
  assert.equal(twice[0].assumptions, "today");
});

test("the usual sitting wins, and a queued placeholder never does", () => {
  const saved = commonMeals([
    meal({ day: "2026-10-23", name: "Yogurt", meal: "Snack", source: "queued",
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0 } }),
    meal({ day: "2026-10-23", name: "Yogurt", meal: "Snack" }),
    meal({ day: "2026-10-22", name: "Yogurt", meal: "Breakfast" }),
    meal({ day: "2026-10-20", name: "Yogurt", meal: "Breakfast" }),
  ], today);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].meal, "Breakfast");
  assert.equal(saved[0].days, 3);
});

test("recent habits outrank an old one, and only three are returned", () => {
  const meals: Meal[] = [];
  for (let ago = 0; ago < 2; ago += 1) {
    const day = ago === 0 ? "2026-10-23" : "2026-10-22";
    meals.push(meal({ day, name: "Recent bowl" }));
  }
  for (let ago = 180; ago < 190; ago += 1) {
    const date = new Date("2026-10-23T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - ago);
    meals.push(meal({ day: date.toISOString().slice(0, 10), name: "Old stew" }));
  }
  meals.push(
    meal({ day: "2026-10-23", name: "Second" }),
    meal({ day: "2026-10-21", name: "Second" }),
    meal({ day: "2026-10-23", name: "Third" }),
    meal({ day: "2026-10-19", name: "Third" }),
    meal({ day: "2026-10-18", name: "Fourth" }),
    meal({ day: "2026-10-17", name: "Fourth" }),
  );
  const saved = commonMeals(meals, today);
  assert.equal(saved.length, 3);
  assert.equal(saved[0].name, "Recent bowl");
  assert.ok(!saved.some((item) => item.name === "Old stew"));
  assert.ok(!saved.some((item) => item.name === "Fourth"));
});

test("each person is a separate call, so the same kitchen does not share buttons", () => {
  const hippos = [
    meal({ day: "2026-10-23", name: "Oats", athlete: "hippos" }),
    meal({ day: "2026-10-22", name: "Oats", athlete: "hippos" }),
    meal({ day: "2026-10-23", name: "Shake", athlete: "gators" }),
    meal({ day: "2026-10-22", name: "Shake", athlete: "gators" }),
  ];
  assert.deepEqual(
    commonMeals(hippos.filter((item) => item.athlete === "hippos"), today).map((item) => item.name),
    ["Oats"],
  );
  assert.deepEqual(
    commonMeals(hippos.filter((item) => item.athlete === "gators"), today).map((item) => item.name),
    ["Shake"],
  );
});
