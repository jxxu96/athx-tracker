import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MET_BY_CATEGORY,
  categoryShape,
  presetElapsed,
  presetTitle,
  PRESETS,
  estimateBurn,
  formatTime,
  formatTimeOrDash,
  fromKilograms,
  parseTime,
  projectWorkout,
  sumMacros,
  toKilograms,
  type Segment,
  type Workout,
} from "./domain.ts";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "x", kind: "workout", athlete: "gators", day: "2026-10-22",
  title: "t", category: "MetCon", seconds: 1800, notes: "",
  segments: [], fatigue: 10, transition: 0, goal: null,
  context: "solo", lifts: [], ...over,
});

const segment = (over: Partial<Segment> = {}): Segment => ({
  name: "s", unit: "reps", completed: 30, target: 30, seconds: 120, ...over,
});

test("times survive a round trip", () => {
  for (const seconds of [0, 1, 59, 60, 61, 599, 3600, 86399]) {
    assert.equal(parseTime(formatTime(seconds)), seconds);
  }
});

test("only mm:ss is accepted", () => {
  assert.equal(parseTime("24:30"), 1470);
  for (const bad of ["", "24", "24:60", "24:5", "1:2:3", "abc", "-1:00"]) {
    assert.ok(Number.isNaN(parseTime(bad)), `${bad} should be rejected`);
  }
});

test("zero seconds reads as not recorded, not as no time", () => {
  assert.equal(formatTimeOrDash(0), "—");
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTimeOrDash(90), "1:30");
});

test("burn needs both a bodyweight and a duration", () => {
  assert.equal(estimateBurn(workout({ seconds: 0 }), 80), null);
  assert.equal(estimateBurn(workout(), 0), null);
  assert.equal(estimateBurn(workout({ seconds: 0 }), 0), null);
});

test("burn follows MET x 3.5 x kg / 200 per minute", () => {
  // MetCon is 8 MET: 8 * 3.5 * 80 / 200 * 30 = 336, rounded to the nearest ten.
  assert.equal(estimateBurn(workout({ seconds: 1800 }), 80), 340);
  // Solidcore is deliberately lower than Strength, not higher.
  const solid = estimateBurn(workout({ category: "Solidcore" }), 80)!;
  const strength = estimateBurn(workout({ category: "Strength" }), 80)!;
  const metcon = estimateBurn(workout({ category: "MetCon" }), 80)!;
  assert.ok(solid < strength && strength < metcon);
});

test("every session type has a MET, and they rank sensibly", () => {
  // A category added without a MET would silently fall back to Other's, so the
  // burn would look plausible and be wrong.
  const at = (category: Workout["category"]) =>
    estimateBurn(workout({ category, seconds: 3600 }), 80)!;
  for (const category of ["Strength", "Endurance", "MetCon", "Solidcore", "Tennis", "Other"] as const) {
    assert.ok(at(category) > 0, category);
  }
  assert.ok(at("Solidcore") < at("Strength"), "slow resistance is not a lift session");
  assert.ok(at("Strength") < at("Tennis"), "rallying moves you more than lifting");
  assert.ok(at("Tennis") < at("MetCon"));
  assert.ok(at("MetCon") < at("Endurance"));
});

test("burn scales with weight and duration", () => {
  const base = estimateBurn(workout({ seconds: 1800 }), 80)!;
  assert.ok(estimateBurn(workout({ seconds: 3600 }), 80)! > base);
  assert.ok(estimateBurn(workout({ seconds: 1800 }), 100)! > base);
});

test("every preset names a real category and a usable time", () => {
  assert.ok(PRESETS.length > 0);
  for (const preset of PRESETS) {
    // A preset pointing at a category that no longer exists would fall back to
    // Other's MET and report a plausible, wrong burn.
    assert.ok(
      MET_BY_CATEGORY[preset.category] > 0,
      `${preset.label} names a category with no MET`,
    );
    assert.ok(preset.minutes > 0 && preset.minutes < 1440, preset.label);
    // The minutes become text in the elapsed box, which has to parse back.
    const text = formatTime(preset.minutes * 60);
    assert.equal(parseTime(text), preset.minutes * 60, `${preset.label} -> ${text}`);
  }
  const labels = PRESETS.map((p) => p.label);
  assert.equal(new Set(labels).size, labels.length, "labels are used as keys");
});

// Every category there is, taken from the table that must list them all.
const CATEGORIES = Object.keys(MET_BY_CATEGORY) as Workout["category"][];

test("no category shows a station panel it gives you no way to fill", () => {
  // Tennis shipped doing exactly this: an empty panel saying to add a station,
  // and no button. Only the two that arrive with a circuit may be in this set,
  // so a category added later that forgets lands here by name.
  const stuck = CATEGORIES.filter((category) => {
    const shape = categoryShape(category);
    return shape.usesStations && !shape.usesCustomStations;
  });
  assert.deepEqual(stuck.sort(), ["Endurance", "MetCon"]);
});

test("every category offers some way to record what you did", () => {
  for (const category of CATEGORIES) {
    const shape = categoryShape(category);
    const circuit = category === "MetCon" || category === "Endurance";
    assert.ok(
      shape.usesLifts || shape.usesCustomStations || circuit,
      `${category} offers nothing to fill in`,
    );
  }
});

test("only the run category is treated as a run", () => {
  for (const category of CATEGORIES) {
    assert.equal(categoryShape(category).isRun, category === "Endurance", category);
  }
});

test("a preset names the session, without overwriting your name for it", () => {
  const [solidcore, tennis] = PRESETS;
  assert.equal(presetTitle("", tennis), "Tennis", "blank gets named");
  assert.equal(presetTitle("   ", tennis), "Tennis", "blank means blank");
  // The bug: tapping the wrong preset then the right one saved a tennis
  // session called Solidcore.
  assert.equal(presetTitle("Solidcore", tennis), "Tennis", "a preset replaces a preset");
  assert.equal(
    presetTitle("Doubles with Sam", solidcore), "Doubles with Sam",
    "what you typed is yours",
  );
});

test("a preset fills the time, without eating one you measured", () => {
  const [solidcore, tennis] = PRESETS;
  assert.equal(presetElapsed("", tennis), "60:00", "blank gets the usual time");
  assert.equal(presetElapsed("50:00", tennis), "60:00", "a preset replaces a preset");
  // The bug: tapping a preset after timing the session threw the time away.
  assert.equal(presetElapsed("38:00", solidcore), "38:00", "what you measured is yours");
  assert.equal(presetElapsed("  38:00  ", solidcore), "  38:00  ", "kept verbatim");
});

test("applying a preset twice settles rather than drifting", () => {
  for (const preset of PRESETS) {
    const once = presetElapsed(presetElapsed("", preset), preset);
    assert.equal(once, presetElapsed("", preset));
    const title = presetTitle(presetTitle("", preset), preset);
    assert.equal(title, preset.label);
  }
});

test("a projection is withheld rather than guessed", () => {
  assert.equal(projectWorkout([], 1800), null, "no segments");
  assert.equal(projectWorkout([segment()], 0), null, "no observed time");
  assert.equal(
    projectWorkout([segment({ completed: 10, seconds: 0 })], 1800), null,
    "work recorded without a time cannot give a pace",
  );
  assert.equal(
    projectWorkout([segment({ completed: 40, target: 30 })], 1800), null,
    "more completed than targeted is not a projection",
  );
  assert.equal(
    projectWorkout([segment({ seconds: 2000 })], 100), null,
    "station times exceeding the workout is not a projection",
  );
});

test("a finished workout projects to itself", () => {
  const done = projectWorkout([segment({ completed: 30, target: 30 })], 1800)!;
  assert.equal(done.partial, false);
  assert.equal(done.estimate, 1800);
  assert.equal(done.coverage, 100);
});

test("a partial workout projects past what was observed", () => {
  const half = projectWorkout([segment({ completed: 15, target: 30, seconds: 120 })], 300)!;
  assert.equal(half.partial, true);
  assert.ok(half.estimate > 300, "must exceed the observed time");
  assert.ok(half.linear <= half.estimate && half.estimate <= half.upper);
  assert.equal(half.coverage, 50);
});

test("weights survive a round trip through either unit", () => {
  for (const kg of [1, 20, 60.5, 142.3]) {
    assert.ok(Math.abs(toKilograms(fromKilograms(kg, "lb"), "lb") - kg) < 1e-9);
    assert.equal(toKilograms(kg, "kg"), kg);
  }
});

test("macros add up and start from zero", () => {
  assert.deepEqual(sumMacros([]), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const meals = [
    { macros: { calories: 100, protein: 10, carbs: 20, fat: 5 } },
    { macros: { calories: 250, protein: 30, carbs: 10, fat: 12 } },
  ] as Parameters<typeof sumMacros>[0];
  assert.deepEqual(sumMacros(meals), { calories: 350, protein: 40, carbs: 30, fat: 17 });
  // A fresh accumulator each call, not one shared between them.
  assert.deepEqual(sumMacros([]), { calories: 0, protein: 0, carbs: 0, fat: 0 });
});
