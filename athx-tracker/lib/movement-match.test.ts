import assert from "node:assert/strict";
import { test } from "node:test";
import { METCON, PRESETS } from "./domain.ts";
import { EXERCISES } from "./exercises.ts";
import { alignWorkoutDraft, matchMovement } from "./movement-match.ts";
import { workoutDraftSchema, type WorkoutDraft } from "./workout-draft.ts";

const { WORKOUT_INSTRUCTIONS, cleanWorkout } = await import(
  new URL("../../estimator/workout.mjs", import.meta.url).href
);

const emptyLift = { kg: null, sets: null, reps: null };
const emptyStation = { completed: null, seconds: null, kg: null };
const lift = (name: string, hippos = { kg: 100, sets: 3, reps: 5 }) => ({
  name, hippos, gators: emptyLift,
});
const station = (name: string, over: Record<string, unknown> = {}) => ({
  name, unit: "reps" as const, target: 20, block: "metcon" as const,
  hippos: { completed: 20, seconds: null, kg: null }, gators: emptyStation, ...over,
});

const base = (): WorkoutDraft => ({
  title: "Session", category: "Strength", customCategory: "", notes: "", assumptions: "",
  elapsed: { hippos: null, gators: null },
  lifts: [lift("Deadlift")],
  stations: [],
});

function settled(draft: WorkoutDraft) {
  const next = alignWorkoutDraft(draft);
  assert.equal(workoutDraftSchema.safeParse(next).success, true, JSON.stringify(workoutDraftSchema.safeParse(next)));
  assert.ok(cleanWorkout(next), JSON.stringify(next));
  return next;
}

test("typos, plurals and abbreviations use the list spelling", () => {
  const names = [
    ["deadlifts", "Deadlift"],
    ["deadlif", "Deadlift"],
    ["dl", "Deadlift"],
    ["bak squat", "Back squat"],
    ["bakc squat", "Back squat"],
    ["backsqaut", "Back squat"],
    ["OHP", "Overhead press"],
    ["military press", "Overhead press"],
    ["rdl", "Romanian deadlift"],
    ["db bench", "DB bench press"],
    ["dumbbell bench press", "DB bench press"],
    ["barbell bench press", "Bench press"],
    ["incline bench", "Incline bench press"],
    ["g2oh", "DB ground to overhead"],
    ["wall balls", "Wall ball"],
    ["farmer's walk", "Farmer carry"],
    ["burpee over the bench", "Burpees over bench"],
    ["kipping pull-ups", "Pull-up"],
    ["hip thrusts", "Hip thrust"],
    ["double unders", "Double under"],
    ["step-ups", "Step-up"],
    ["lat pull down", "Lat pulldown"],
    ["5k run", "Run"],
    ["opening row", "Opening row"],
    ["c&j", "Clean and jerk"],
    ["pc", "Power clean"],
    ["split squats", "Bulgarian split squat"],
    ["assault bike", "Bike erg"],
    ["Lu Raises", "Lu Raises"],
  ] as const;
  for (const [heard, listed] of names) {
    const match = matchMovement(heard);
    assert.equal(match.name, listed, heard);
    assert.equal(match.note, null, heard);
  }
});

test("a different movement stays typed and the note says it is not in the list", () => {
  for (const heard of ["sumo deadlift", "dumbbell deadlift", "cable reverse fly"]) {
    const match = matchMovement(heard);
    assert.equal(match.name, heard, heard);
    assert.equal(match.listed, false, heard);
    assert.match(match.note ?? "", new RegExp(`Left as typed: "${heard}" is not in the list`));
  }
});

test("a bare word that is several list items stays typed and names them", () => {
  const squat = matchMovement("squat");
  assert.equal(squat.name, "squat");
  assert.match(squat.note ?? "", /could be Back squat, Sandbag squats, Front squat or Goblet squat/);
  const press = matchMovement("press");
  assert.equal(press.name, "press");
  assert.match(press.note ?? "", /could be Overhead press, Push press or Bench press/);
  const clean = matchMovement("clean");
  assert.equal(clean.name, "clean");
  assert.match(clean.note ?? "", /could be Power clean or Sandbag clean/);
});

test("a draft keeps list names and records only the names that were too far off", () => {
  const next = settled({
    ...base(),
    lifts: [lift("deadlifts"), lift("bak squat"), lift("cable reverse fly")],
  });
  assert.deepEqual(next.lifts.map((row) => row.name), ["Deadlift", "Back squat", "cable reverse fly"]);
  assert.equal(next.notes, 'Left as typed: "cable reverse fly" is not in the list.');
  assert.equal(next.category, "Strength");
  assert.deepEqual(settled(next), next, "aligning again does not add another note");
});

test("a note the model already wrote is not repeated", () => {
  const notes = 'Left as typed: "cable reverse fly" is not in the list.';
  const next = settled({ ...base(), notes, lifts: [lift("cable reverse fly")] });
  assert.equal(next.notes, notes);
});

test("metcon, athx and the circuit become the existing stations", () => {
  const next = settled({
    ...base(),
    category: "Strength",
    lifts: [lift("deadlifts")],
    stations: [station("the metcon", { unit: "rounds", target: 1 })],
  });
  assert.equal(next.category, "Mixed");
  assert.equal(next.lifts[0].name, "Deadlift");
  assert.deepEqual(next.stations.map((row) => row.name), METCON.map((row) => row.name));
  assert.deepEqual(next.stations.map((row) => row.target), METCON.map((row) => row.target));
  assert.equal(next.notes, "");
});

test("a MetCon with no named stations is the circuit, and a named station is left alone", () => {
  const whole = settled({ ...base(), category: "MetCon", lifts: [], stations: [] });
  assert.equal(whole.category, "MetCon");
  assert.deepEqual(whole.stations.map((row) => row.name), METCON.map((row) => row.name));

  const partial = settled({
    ...base(),
    category: "MetCon",
    lifts: [],
    stations: [station("opening row", { unit: "cal", target: 40, hippos: { completed: 40, seconds: null, kg: null } })],
  });
  assert.deepEqual(partial.stations.map((row) => row.name), ["Opening row"]);
});

test("named workouts match Solidcore and Tennis, and an unknown one is called out", () => {
  const solid = settled({ ...base(), category: "Other", customCategory: "solid core class", lifts: [], stations: [] });
  assert.equal(solid.category, "Solidcore");
  assert.equal(solid.customCategory, "");
  assert.equal(solid.notes, "");

  const tennis = settled({ ...base(), category: "Other", customCategory: "tenis", lifts: [], stations: [] });
  assert.equal(tennis.category, "Tennis");

  const ytw = settled({ ...base(), category: "Other", customCategory: "Y-T-W", lifts: [], stations: [] });
  assert.equal(ytw.category, "YTW");
  assert.equal(ytw.customCategory, "");

  const yoga = settled({ ...base(), category: "Other", customCategory: "Yoga", lifts: [], stations: [] });
  assert.equal(yoga.category, "Other");
  assert.equal(yoga.customCategory, "Yoga");
  assert.match(yoga.notes, /"Yoga" is not a workout in the list/);
});

test("the workout prompt names every listed movement and workout", () => {
  for (const name of EXERCISES.flatMap((group) => group.items))
    assert.equal(WORKOUT_INSTRUCTIONS.includes(name), true, name);
  for (const station of METCON)
    assert.equal(WORKOUT_INSTRUCTIONS.includes(station.name), true, station.name);
  for (const preset of PRESETS)
    assert.equal(WORKOUT_INSTRUCTIONS.includes(preset.label), true, preset.label);
});
