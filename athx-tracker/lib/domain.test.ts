import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MET_BY_CATEGORY,
  categoryName,
  categoryShape,
  defaultContext,
  sessionSeconds,
  presetElapsed,
  presetTitle,
  PRESETS,
  estimateBurn,
  formatTime,
  formatTimeOrDash,
  displayDistance,
  distanceLine,
  fromKilograms,
  fromMetres,
  toMetres,
  parseTime,
  projectWorkout,
  scenarioLine,
  sumMacros,
  toKilograms,
  type Segment,
  type Workout,
} from "./domain.ts";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "x", kind: "workout", athlete: "gators", day: "2026-10-22",
  title: "t", category: "MetCon", customCategory: "", seconds: 1800, notes: "",
  segments: [], fatigue: 10, transition: 0, goal: null,
  context: "solo", lifts: [], ...over,
});

const segment = (over: Partial<Segment> = {}): Segment => ({
  name: "s", unit: "reps", completed: 30, target: 30, seconds: 120, ...over,
});

test("a run converts between metres, kilometres and miles", () => {
  assert.equal(displayDistance(5000, "m"), "5000");
  assert.equal(displayDistance(fromMetres(toMetres(5000, "m"), "km"), "km"), "5");
  assert.equal(displayDistance(fromMetres(toMetres(5, "km"), "mi"), "mi"), "3.11");
  assert.equal(displayDistance(fromMetres(toMetres(1, "mi"), "m"), "m"), "1609");
  assert.equal(displayDistance(fromMetres(toMetres(1609, "m"), "mi"), "mi"), "1");
  assert.equal(displayDistance(3.1, "mi"), "3.1");
  const run = workout({
    category: "Endurance",
    segments: [segment({ name: "Run", unit: "km", completed: 5, target: 5, block: "endurance" })],
  });
  assert.equal(distanceLine(run), "Run 5 km");
  assert.equal(distanceLine(workout()), null);
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

test("burn needs a bodyweight, and either a clock or lifts", () => {
  assert.equal(estimateBurn(workout({ seconds: 0 }), 80), null);
  assert.equal(estimateBurn(workout(), 0), null);
  assert.equal(estimateBurn(workout({ seconds: 0 }), 0), null);
});

test("lifts without a clock still burn, and a clock is not counted twice", () => {
  const squats = workout({
    category: "Strength",
    seconds: 0,
    lifts: [{ name: "Back squat", kg: 61.23, sets: 3, reps: 5 }],
  });
  // 15 reps at 4 s, plus two rests of 150 s: 6 minutes at 6 MET.
  // 6 * 3.5 * 74.38914874238205 / 200 * 6 = 46.86, to the nearest ten.
  assert.equal(estimateBurn(squats, 74.38914874238205), 50);
  const longer = workout({
    category: "Strength",
    seconds: 0,
    lifts: [{ name: "Back squat", kg: 61.23, sets: 5, reps: 5 }],
  });
  assert.ok(estimateBurn(longer, 74.38914874238205)! > 50);
  const timed = workout({
    category: "Strength",
    seconds: 1800,
    lifts: [{ name: "Back squat", kg: 61.23, sets: 3, reps: 5 }],
  });
  assert.equal(
    estimateBurn(timed, 80),
    estimateBurn(workout({ category: "Strength", seconds: 1800 }), 80),
  );
});

test("a clock filled by stations still leaves the lifts their own burn", () => {
  // Friday: 5:05 of MetCon stations, and 3x4 squats with no time of their own.
  const stations = [
    segment({ name: "Opening row", unit: "cal" as const, completed: 0, target: 40, seconds: 0 }),
    segment({ name: "DB ground to overhead", completed: 30, target: 30, seconds: 90 }),
    segment({ name: "DB bench press", completed: 30, target: 30, seconds: 65 }),
    segment({ name: "Sandbag squats", completed: 30, target: 30, seconds: 90 }),
    segment({ name: "Sandbag carry", unit: "m" as const, completed: 60, target: 60, seconds: 60 }),
    segment({ name: "Burpees over bench", completed: 0, target: 30, seconds: 0 }),
    segment({ name: "Closing row", unit: "cal" as const, completed: 0, target: 40, seconds: 0 }),
  ];
  const kg = 74.38914874238205;
  const metcon = workout({ category: "MetCon", seconds: 305, segments: stations });
  const both = workout({
    category: "Mixed",
    seconds: 305,
    segments: stations,
    lifts: [{ name: "Back squat", kg: 61.23, sets: 3, reps: 4 }],
  });
  // 305 s at 8 MET is 52.9. The squats are 12 reps and two rests, 45.3 at 6 MET.
  assert.equal(estimateBurn(metcon, kg), 50);
  assert.equal(estimateBurn(both, kg), 100);
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
  for (const category of ["Strength", "Endurance", "MetCon", "Solidcore", "Tennis", "YTW", "Other"] as const) {
    assert.ok(at(category) > 0, category);
  }
  assert.ok(at("YTW") < at("Solidcore"), "light raises are not a megaformer session");
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

test("the format follows who you are logging for", () => {
  assert.equal(defaultContext(2), "pairs", "both of you is a pairs session");
  assert.equal(defaultContext(1), "solo", "one of you is not");
});

test("a named Other session is called what you named it", () => {
  const as = (category: Workout["category"], customCategory: string) =>
    categoryName({ category, customCategory });
  assert.equal(as("Other", "Hiking"), "Hiking");
  assert.equal(as("Other", "  Climbing  "), "Climbing");
  assert.equal(as("Other", ""), "Other", "unnamed stays Other");
  assert.equal(as("Other", "   "), "Other", "a space is not a name");
  // A name left behind by switching away from Other must not rename a real one.
  assert.equal(as("Tennis", "Hiking"), "Tennis");
  assert.equal(as("MetCon", ""), "MetCon");
});

test("a session with nothing timed lasts zero, and saves", () => {
  // The case that could not be saved at all: a strength session, no stations
  // to derive a time from, and no time typed.
  assert.equal(sessionSeconds("", []), 0);
});

test("station splits stand in for a time nobody wrote down", () => {
  // A part-finished MetCon: two stations done, never looked at the clock.
  const segments = [{ seconds: 130 }, { seconds: 95 }, { seconds: 0 }];
  assert.equal(sessionSeconds("", segments), 225);
});

test("a time you typed beats the splits, because you know about the rest", () => {
  const segments = [{ seconds: 130 }, { seconds: 95 }];
  assert.equal(sessionSeconds("5:00", segments), 300, "not the 225 of the splits");
  assert.equal(sessionSeconds("  5:00  ", segments), 300, "spaces do not change it");
});

test("a mistyped time is not quietly read as no time", () => {
  // Returning zero here would file a typo as a session nobody timed, instead
  // of the form telling you the time will not parse.
  for (const bad of ["abc", "5", "5:99", "::"]) {
    assert.ok(Number.isNaN(sessionSeconds(bad, [])), bad);
  }
});

test("what the form computes is what the schema accepts", () => {
  // The form and the schema have to agree, or a session either fails to save
  // for no visible reason or is refused something it offered.
  const cases: [string, { seconds: number }[]][] = [
    ["", []],
    ["", [{ seconds: 130 }]],
    ["45:00", []],
    ["45:00", [{ seconds: 130 }]],
  ];
  for (const [text, segments] of cases) {
    const total = sessionSeconds(text, segments);
    assert.ok(Number.isFinite(total) && total >= 0 && total <= 86400, `${text}`);
  }
});

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
    projectWorkout([segment({ completed: 30, target: 30, seconds: 0 })], 1800),
    null,
    "a station finished but never timed still has no pace to project from",
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

test("a saved session shows the full-workout scenario as one line, or nothing", () => {
  const half = workout({
    seconds: 300,
    segments: [segment({ completed: 15, target: 30, seconds: 120 })],
  });
  const projected = projectWorkout(
    half.segments,
    half.seconds,
    half.fatigue,
    half.transition,
  );
  assert.ok(projected?.partial);
  assert.equal(
    scenarioLine(half),
    `At this pace, the whole session is about ${formatTime(projected!.estimate)}.`,
  );

  assert.equal(
    scenarioLine(workout({
      seconds: 1800,
      segments: [segment({ completed: 30, target: 30 })],
    })),
    null,
    "a finished station only repeats the time already logged",
  );
  assert.equal(
    scenarioLine(workout({ seconds: 0, segments: [segment()] })),
    null,
    "an untimed session",
  );
  assert.equal(
    scenarioLine(workout({ seconds: 1800, segments: [] })),
    null,
    "no stations",
  );
  assert.equal(
    scenarioLine(workout({
      seconds: 1800,
      segments: [segment({ completed: 10, seconds: 0 })],
    })),
    null,
    "unfinished work with no pace",
  );
  assert.equal(
    scenarioLine(workout({
      seconds: 100,
      segments: [segment({ seconds: 2000 })],
    })),
    null,
    "station times that cannot fit the elapsed time",
  );
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
