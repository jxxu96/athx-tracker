import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, restingEnergy } from "./energy.ts";

test("resting energy is Mifflin-St Jeor, with nothing guessed", () => {
  // 10 x 70 + 6.25 x 170 - 5 x 30, then +5 or -161.
  assert.equal(restingEnergy({ kg: 70, cm: 170, age: 30, sex: "male" }), 700 + 1062.5 - 150 + 5);
  assert.equal(restingEnergy({ kg: 70, cm: 170, age: 30, sex: "female" }), 700 + 1062.5 - 150 - 161);
  assert.equal(restingEnergy({ kg: 0, cm: 170, age: 30, sex: "male" }), null);
  assert.equal(restingEnergy({ kg: 70, cm: 0, age: 30, sex: "male" }), null);
  assert.equal(restingEnergy({ kg: 70, cm: 170, age: 0, sex: "male" }), null);
});

test("age comes from the birth year and the day it is asked about", () => {
  assert.equal(ageOn(1996, "2026-01-01"), 30);
  assert.equal(ageOn(1996, "2027-08-28"), 31);
  assert.equal(ageOn(0, "2026-01-01"), 0);
});
