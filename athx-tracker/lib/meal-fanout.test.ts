import { test } from "node:test";
import assert from "node:assert/strict";
import { fanOutMeal, type MealDraft, type MealDraftIds } from "./meal-fanout.ts";

function sample(): { draft: MealDraft; ids: MealDraftIds } {
  return {
    draft: {
      kind: "meal",
      day: "2026-10-23",
      name: "Oats, eggs and coffee",
      meal: "Dinner",
      macros: { calories: 455, protein: 30, carbs: 50, fat: 15 },
      source: "manual",
      assumptions: "A bowl",
    },
    ids: {
      hippos: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      gators: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    },
  };
}

test("logging for both writes two meals that share the fields and not the object", () => {
  const { draft, ids } = sample();
  const saved = fanOutMeal({ loggingFor: "both", editing: null, draft, ids });
  assert.deepEqual(saved.map((meal) => meal.athlete), ["hippos", "gators"]);
  assert.equal(new Set(saved.map((meal) => meal.id)).size, 2);
  assert.deepEqual(saved.map((meal) => meal.id), [ids.hippos, ids.gators]);
  for (const meal of saved) {
    assert.equal(meal.day, draft.day);
    assert.equal(meal.meal, draft.meal);
    assert.equal(meal.name, draft.name);
    assert.equal(meal.source, draft.source);
    assert.equal(meal.assumptions, draft.assumptions);
    assert.deepEqual(meal.macros, draft.macros);
    assert.notEqual(meal.macros, draft.macros);
  }
  assert.notEqual(saved[0].macros, saved[1].macros);
  saved[0].macros.protein = 1;
  assert.equal(saved[1].macros.protein, 30);
  assert.equal(draft.macros.protein, 30);

  const retry = fanOutMeal({ loggingFor: "both", editing: null, draft, ids });
  assert.deepEqual(retry.map((meal) => meal.id), [ids.hippos, ids.gators]);
  assert.deepEqual(retry.map((meal) => meal.athlete), ["hippos", "gators"]);
  assert.equal(retry[0].macros.protein, 30);
});

test("fiber is copied onto each athlete and the two copies stay separate", () => {
  const { draft, ids } = sample();
  draft.macros = { ...draft.macros, fiber: 8, alcohol: 0 };
  const saved = fanOutMeal({ loggingFor: "both", editing: null, draft, ids });
  assert.equal(saved[0].macros.fiber, 8);
  assert.equal(saved[1].macros.fiber, 8);
  assert.notEqual(saved[0].macros, saved[1].macros);
  saved[0].macros.fiber = 1;
  assert.equal(saved[1].macros.fiber, 8);
  assert.equal(draft.macros.fiber, 8);
});

test("logging for one athlete writes only that athlete", () => {
  const { draft, ids } = sample();
  const saved = fanOutMeal({ loggingFor: "gators", editing: null, draft, ids });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].athlete, "gators");
  assert.equal(saved[0].id, ids.gators);
  assert.notEqual(saved[0].id, ids.hippos);
  assert.deepEqual(saved[0].macros, draft.macros);
  assert.equal(saved[0].day, draft.day);
  assert.equal(saved[0].meal, draft.meal);
  assert.equal(saved[0].name, draft.name);
  assert.equal(saved[0].source, draft.source);
});

test("an edit stays on the original record even when logging for both", () => {
  const { draft, ids } = sample();
  const original = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const saved = fanOutMeal({
    loggingFor: "both",
    editing: { id: original, athlete: "gators" },
    draft,
    ids,
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, original);
  assert.equal(saved[0].athlete, "gators");
  assert.notEqual(saved[0].id, ids.gators);
  assert.notEqual(saved[0].id, ids.hippos);
  assert.deepEqual(saved[0].macros, draft.macros);
  assert.notEqual(saved[0].macros, draft.macros);
});
