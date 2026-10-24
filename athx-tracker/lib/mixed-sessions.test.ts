import { test } from "node:test";
import assert from "node:assert/strict";
import {
  METCON,
  MET_BY_CATEGORY,
  categoryName,
  completionLine,
  displayLoad,
  estimateBurn,
  formatWeight,
  metconCompletion,
  metconLoadText,
  parseLoad,
  reunitLoad,
  segmentBlock,
  sessionMet,
  sessionParts,
  standardLoad,
  type Segment,
  type Workout,
} from "./domain.ts";
import { settingsSchema, workoutSchema } from "./validation.ts";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1234", kind: "workout", athlete: "gators",
  day: "2026-10-22", title: "t", category: "MetCon", customCategory: "",
  seconds: 1800, notes: "", segments: [], fatigue: 10, transition: 0,
  goal: null, context: "solo", lifts: [], ...over,
});
const station = (over: Partial<Segment> = {}): Segment => ({
  name: "DB ground to overhead", unit: "reps", completed: 30, target: 30, seconds: 120, ...over,
});

// Old entries ---------------------------------------------------------------

test("a session saved before parts existed reads exactly as it did", () => {
  // Payloads are stored as JSON and read back without parsing, so the new
  // fields are simply absent on everything logged before this change.
  const legacyRun = workout({ category: "Endurance", segments: [station({ name: "Run", unit: "m", completed: 5000, target: 5000 })] });
  const legacyMetcon = workout({ segments: [station()] });
  assert.equal(segmentBlock(legacyRun, legacyRun.segments[0]), "endurance");
  assert.equal(segmentBlock(legacyMetcon, legacyMetcon.segments[0]), "metcon");
  assert.equal(categoryName(legacyMetcon), "MetCon");
  assert.equal(metconCompletion(legacyMetcon)?.capHit, false, "no flag reads as no cap");
  assert.ok(workoutSchema.safeParse(legacyMetcon).success, "and still saves on edit");
});

test("burns of every existing category are unchanged", () => {
  for (const category of ["Strength", "Endurance", "MetCon", "Solidcore", "Tennis", "Other"] as const) {
    const w = workout({ category, seconds: 3600 });
    assert.equal(sessionMet(w), MET_BY_CATEGORY[category], category);
    assert.equal(estimateBurn(w, 80), Math.round((MET_BY_CATEGORY[category] * 3.5 * 80 / 200) * 60 / 10) * 10);
  }
});

test("stored kilograms are untouched by the unit, so old lifts keep their value", () => {
  assert.equal(formatWeight(100, "kg"), "100 kg");
  assert.equal(formatWeight(100, "lb"), "220.5 lb");
  const settings = settingsSchema.parse({
    eventDate: "2027-08-28", eventName: "ATHX", weeklyTarget: 4,
    targets: { hippos: { calories: 0, protein: 0, carbs: 0, fat: 0 }, gators: { calories: 0, protein: 0, carbs: 0, fat: 0 } },
  });
  assert.equal(settings.weightUnit, "lb", "settings saved before the toggle default to lb");
});

// Mixed sessions -------------------------------------------------------------

test("a mixed session can hold lifts, MetCon and endurance at once", () => {
  const mixed = workout({
    category: "Mixed",
    lifts: [{ name: "Deadlift", kg: 140, sets: 5, reps: 3 }],
    segments: [
      station({ block: "metcon", kg: 15 }),
      station({ name: "Run", unit: "m", completed: 2000, target: 2000, seconds: 540, block: "endurance" }),
    ],
  });
  assert.ok(workoutSchema.safeParse(mixed).success);
  assert.deepEqual(sessionParts(mixed), ["lifts", "metcon", "endurance"]);
  assert.equal(categoryName(mixed), "Strength + MetCon + Endurance");
  assert.equal(categoryName(workout({ category: "Mixed", lifts: mixed.lifts })), "Mixed", "one part is just Mixed");
});

test("a mixed session's burn is weighted by where the time went", () => {
  const mixed = workout({
    category: "Mixed", seconds: 3600,
    lifts: [{ name: "Deadlift", kg: 140, sets: 5, reps: 3 }],
    segments: [station({ seconds: 600, block: "metcon" }), station({ name: "Run", unit: "m", completed: 3000, target: 3000, seconds: 900, block: "endurance" })],
  });
  // 600 s at 8, 900 s at 9, and the other 2100 s lifting at 6.
  const expected = (600 * 8 + 900 * 9 + 2100 * 6) / 3600;
  assert.ok(Math.abs(sessionMet(mixed) - expected) < 1e-9);
  // Without lifts the untimed rest is the MetCon.
  const noLifts = { ...mixed, lifts: [] };
  assert.ok(Math.abs(sessionMet(noLifts) - (600 * 8 + 900 * 9 + 2100 * 8) / 3600) < 1e-9);
  // 600 s at 8 and 900 s at 9, with the session clock left empty: 301, to the nearest ten.
  assert.equal(estimateBurn({ ...noLifts, seconds: 0 }, 80), 300);
});

test("the schema refuses a part that is not one", () => {
  assert.ok(!workoutSchema.safeParse(workout({ category: "Mixed", segments: [{ ...station(), block: "yoga" as never }] })).success);
});

// Loads ----------------------------------------------------------------------

test("MetCon stations take an optional load, in kilograms", () => {
  assert.ok(workoutSchema.safeParse(workout({ segments: [station({ kg: 15 })] })).success);
  assert.ok(workoutSchema.safeParse(workout({ segments: [station()] })).success, "optional");
  assert.ok(!workoutSchema.safeParse(workout({ segments: [station({ kg: 0 })] })).success, "zero is not a load");
  assert.ok(!workoutSchema.safeParse(workout({ segments: [station({ kg: 2000 })] })).success);
});

test("the circuit's prescribed loads follow the unit you read weights in", () => {
  const bench = METCON.find((s) => s.name === "DB bench press")!;
  assert.equal(metconLoadText(bench, "kg"), "Hippos 7.5 kg · Gators 15 kg / DB");
  assert.equal(metconLoadText(bench, "lb"), "Hippos 16.5 lb · Gators 33.1 lb / DB");
  const carry = METCON.find((s) => s.name === "Sandbag carry")!;
  assert.equal(metconLoadText(carry, "kg"), "30 m each · Hippos 20 kg · Gators 30 kg");
  const row = METCON.find((s) => s.name === "Opening row")!;
  assert.equal(metconLoadText(row, "lb"), "Shared calories");
});

// kg / lb --------------------------------------------------------------------

test("a load typed in either unit is stored in kilograms", () => {
  assert.equal(parseLoad("100", "kg"), 100);
  assert.equal(parseLoad("225", "lb"), 102.06);
  assert.equal(parseLoad("", "lb"), null, "blank is not recorded");
  for (const bad of ["0", "-5", "abc"]) assert.equal(parseLoad(bad, "kg"), null, bad);
});

test("re-saving an untouched entry never nudges its load", () => {
  // 100 kg reads 220.5 lb, which converted back is 100.02 kg.
  assert.equal(displayLoad(100, "lb"), "220.5");
  assert.equal(parseLoad("220.5", "lb", 100), 100);
  assert.equal(parseLoad("225", "lb", 100), 102.06, "a changed box is read as typed");
});

test("switching units converts what is in the box", () => {
  assert.equal(reunitLoad("100", "kg", "lb"), "220.5");
  assert.equal(reunitLoad("225", "lb", "kg"), "102.1");
  assert.equal(reunitLoad("", "kg", "lb"), "");
  assert.equal(reunitLoad("abc", "kg", "lb"), "abc", "left for the form to flag");
  // A saved load is shown fresh, not converted from its rounded display.
  const saved = 61.23;
  const lb = reunitLoad(displayLoad(saved, "kg"), "kg", "lb", saved);
  assert.equal(lb, displayLoad(saved, "lb"));
  assert.equal(parseLoad(reunitLoad(lb, "lb", "kg", saved), "kg", saved), saved, "round trip keeps it exact");
});

// Partial completion -----------------------------------------------------------

test("a part-finished MetCon says how much was done, and whether the cap stopped it", () => {
  const partial = workout({
    capHit: true,
    segments: [
      station(),
      station({ name: "Sandbag squats", completed: 15, target: 30, seconds: 90 }),
      station({ name: "Burpees over bench", completed: 0, target: 30, seconds: 0 }),
    ],
  });
  assert.ok(workoutSchema.safeParse(partial).success);
  assert.deepEqual(metconCompletion(partial), { finished: 1, movements: 3, percent: 50, complete: false, capHit: true });
  assert.equal(completionLine(partial), "1/3 movements · 50% of the work · time cap hit");
  assert.equal(completionLine(workout({ segments: [station()] })), null, "a finished one needs no line");
  assert.equal(completionLine(workout({ capHit: true, segments: [station()] })), "1/1 movements · 100% of the work · time cap hit");
});

test("only MetCon work counts toward completion", () => {
  const mixed = workout({
    category: "Mixed",
    segments: [
      station({ block: "metcon", completed: 10, target: 20 }),
      station({ name: "Run", unit: "m", completed: 1000, target: 1000, block: "endurance" }),
    ],
  });
  assert.equal(metconCompletion(mixed)?.movements, 1);
  assert.equal(metconCompletion(mixed)?.percent, 50);
  assert.equal(metconCompletion(workout({ category: "Solidcore", segments: [station({ completed: 1 })] })), null);
  assert.equal(metconCompletion(workout({ category: "Mixed", lifts: [{ name: "Deadlift", kg: 100, sets: 1, reps: 1 }] })), null);
});

// Standard weights, prefilled ------------------------------------------------

test("a standard weight is offered on the rack: 5 lb steps, 2.5 kg steps", () => {
  const offered = (kg: number) => [standardLoad(kg, "lb"), standardLoad(kg, "kg")];
  assert.deepEqual(offered(7.5), ["15", "7.5"], "16.5 lb rounds down to 15");
  assert.deepEqual(offered(15), ["35", "15"], "33.1 lb rounds up to 35");
  assert.deepEqual(offered(20), ["45", "20"]);
  assert.deepEqual(offered(30), ["65", "30"]);
  assert.equal(standardLoad(0.5, "lb"), "5", "never offered as nothing");
});

test("a prefilled weight saved untouched reads back as the same number", () => {
  // Every circuit load, in both units, and a spread of others: what is saved
  // from the prefilled text shows again as exactly that text, now and on every
  // later reopen-and-save.
  const loads = METCON.flatMap((s) => (s.kg ? [s.kg.hippos, s.kg.gators] : []));
  for (let kg = 1; kg <= 200; kg += 0.7) loads.push(Math.round(kg * 10) / 10);
  for (const kg of loads) {
    for (const unit of ["lb", "kg"] as const) {
      const text = standardLoad(kg, unit);
      let stored = parseLoad(text, unit);
      assert.ok(stored !== null);
      for (let i = 0; i < 3; i++) {
        assert.equal(displayLoad(stored!, unit), text, `${kg} kg as ${text} ${unit}`);
        stored = parseLoad(displayLoad(stored!, unit), unit, stored!);
      }
    }
  }
});
