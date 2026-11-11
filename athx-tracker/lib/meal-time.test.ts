import { test } from "node:test";
import assert from "node:assert/strict";
import { energyTimingForTime, mealForTime } from "./meal-time.ts";

function at(hour: number, minute = 0) {
  return new Date(2026, 9, 23, hour, minute);
}

test("the sitting follows the local hour, including both edges", () => {
  assert.equal(mealForTime(at(4, 59)), "Snack");
  assert.equal(mealForTime(at(5, 0)), "Breakfast");
  assert.equal(mealForTime(at(10, 59)), "Breakfast");
  assert.equal(mealForTime(at(11, 0)), "Lunch");
  assert.equal(mealForTime(at(14, 59)), "Lunch");
  assert.equal(mealForTime(at(15, 0)), "Snack");
  assert.equal(mealForTime(at(16, 59)), "Snack");
  assert.equal(mealForTime(at(17, 0)), "Dinner");
  assert.equal(mealForTime(at(21, 59)), "Dinner");
  assert.equal(mealForTime(at(22, 0)), "Snack");
  assert.equal(mealForTime(at(0, 0)), "Snack");
});

test("an energy timing is the meal's sitting, with a snack's hours given to a sitting of that day", () => {
  // The meal's own windows.
  for (const [hour, minute] of [[5, 0], [10, 59], [11, 0], [14, 59], [17, 0], [21, 59]])
    assert.equal(energyTimingForTime(at(hour, minute)), mealForTime(at(hour, minute)));
  // Before dawn is the day's first, the afternoon follows lunch, the late evening follows dinner.
  assert.equal(energyTimingForTime(at(0, 0)), "Breakfast");
  assert.equal(energyTimingForTime(at(4, 59)), "Breakfast");
  assert.equal(energyTimingForTime(at(15, 0)), "Lunch");
  assert.equal(energyTimingForTime(at(16, 59)), "Lunch");
  assert.equal(energyTimingForTime(at(22, 0)), "Dinner");
  assert.equal(energyTimingForTime(at(23, 59)), "Dinner");
});
