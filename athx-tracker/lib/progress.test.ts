import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  PROGRESS_LIFTS,
  displayLoad,
  type LiftTargets,
  type Workout,
} from "./domain.ts";
import {
  liftProgress,
  progressLift,
  progressMarks,
  shownGap,
  toGo,
  togetherLiftSessions,
} from "./progress.ts";
import { settingsSchema } from "./validation.ts";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w",
  kind: "workout",
  athlete: "gators",
  day: "2026-09-01",
  title: "Lifts",
  category: "Strength",
  customCategory: "",
  seconds: 0,
  notes: "",
  segments: [],
  fatigue: 10,
  transition: 0,
  goal: null,
  context: "solo",
  lifts: [],
  ...over,
});

const lift = (name: string, kg: number, sets = 1, reps = 1) => ({ name, kg, sets, reps });
const none: LiftTargets = { splitJerk: 0, overheadPress: 0, backSquat: 0, deadlift: 0 };
const jerkOf = (records: Workout[], targets = none) =>
  liftProgress(records, "gators", targets).find((row) => row.key === "splitJerk")!;

test("the four lifts follow in a fixed order, each with its target", () => {
  const rows = liftProgress([], "gators", DEFAULT_SETTINGS.liftTargets.gators);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Split jerk", "Overhead press", "Back squat", "Deadlift"],
  );
  for (const row of rows) {
    assert.equal(row.start, null);
    assert.equal(row.sessions, 0);
    assert.ok(row.target > 0);
  }
});

test("start is the first day, latest the last, best the heaviest", () => {
  const row = jerkOf([
    // Newest first, as the journal holds them.
    workout({ day: "2026-10-20", lifts: [lift("Split jerk", 70, 1, 3)] }),
    workout({ day: "2026-10-12", lifts: [lift("Split jerk", 72.5, 1, 1)] }),
    workout({ day: "2026-09-02", lifts: [lift("Split jerk", 60, 5, 3)] }),
  ]);
  assert.deepEqual(row.start, { day: "2026-09-02", kg: 60, sets: 5, reps: 3 });
  assert.deepEqual(row.latest, { day: "2026-10-20", kg: 70, sets: 1, reps: 3 });
  assert.deepEqual(row.best, { day: "2026-10-12", kg: 72.5, sets: 1, reps: 1 });
  assert.equal(row.sessions, 3);
});

test("a day counts as its heaviest set, and a warm-up never stands in for it", () => {
  const row = jerkOf([
    workout({
      day: "2026-09-02",
      lifts: [lift("Split jerk", 40, 2, 3), lift("Split jerk", 60, 3, 2), lift("Split jerk", 50, 1, 2)],
    }),
    // Two sessions on one day are one day, at the heavier of the two.
    workout({ id: "pm", day: "2026-09-02", lifts: [lift("Split jerk", 62.5, 1, 1)] }),
  ]);
  assert.deepEqual(row.start, { day: "2026-09-02", kg: 62.5, sets: 1, reps: 1 });
  assert.deepEqual(row.latest, row.start);
  assert.equal(row.sessions, 2, "both sessions logged it");
});

test("equal weight goes to more reps, and a best belongs to the day it was first reached", () => {
  const sameDay = jerkOf([
    workout({ lifts: [lift("Split jerk", 60, 1, 1), lift("Split jerk", 60, 1, 3)] }),
  ]);
  assert.equal(sameDay.start!.reps, 3);
  const repeated = jerkOf([
    workout({ day: "2026-10-01", lifts: [lift("Split jerk", 70, 1, 2)] }),
    workout({ day: "2026-09-01", lifts: [lift("Split jerk", 70, 1, 2)] }),
  ]);
  assert.equal(repeated.best!.day, "2026-09-01");
  const better = jerkOf([
    workout({ day: "2026-10-01", lifts: [lift("Split jerk", 70, 1, 3)] }),
    workout({ day: "2026-09-01", lifts: [lift("Split jerk", 70, 1, 2)] }),
  ]);
  assert.equal(better.best!.day, "2026-10-01", "more reps at the same weight is the better day");
});

test("names match the way a described workout's do, and variations stay out", () => {
  assert.equal(progressLift("Split jerk"), "splitJerk");
  assert.equal(progressLift("OHP"), "overheadPress");
  assert.equal(progressLift("strict press"), "overheadPress");
  assert.equal(progressLift("barbell back squats"), "backSquat");
  assert.equal(progressLift("deadlifts"), "deadlift");
  for (const other of ["Push press", "Front squat", "Romanian deadlift", "Sumo deadlift", "Push jerk", "Squat"])
    assert.equal(progressLift(other), null, other);
});

test("only that athlete's sessions count, and together sessions count for nobody", () => {
  const records = [
    workout({ athlete: "hippos", lifts: [lift("Deadlift", 80)] }),
    workout({ athlete: "team", lifts: [lift("Deadlift", 150)] }),
    workout({ athlete: "team", lifts: [lift("Bench press", 60)] }),
  ];
  const gators = liftProgress(records, "gators", none).find((row) => row.key === "deadlift")!;
  const hippos = liftProgress(records, "hippos", none).find((row) => row.key === "deadlift")!;
  assert.equal(gators.best, null);
  assert.equal(hippos.best!.kg, 80);
  assert.equal(togetherLiftSessions(records), 1, "only the together session with a followed lift");
});

test("the gaps are the subtraction of the numbers on screen", () => {
  const target = 175 / 2.20462262;
  const best = 72.57; // 160 lb, as the form stores it
  assert.equal(shownGap(best, target, "lb"), 15);
  assert.equal(toGo({ best: { day: "2026-09-01", kg: best, sets: 1, reps: 1 }, target }, "lb"), 15);
  assert.equal(toGo({ best: { day: "2026-09-01", kg: 80, sets: 1, reps: 1 }, target }, "lb")! <= 0, true, "past the target is reached");
  assert.equal(toGo({ best: null, target }, "lb"), null, "nothing logged has no gap yet");
  assert.equal(toGo({ best: { day: "2026-09-01", kg: best, sets: 1, reps: 1 }, target: 0 }, "lb"), null);
  assert.equal(shownGap(60, 62.5, "kg"), 2.5);
});

test("the bar places each mark by its share of the heaviest", () => {
  const at = (kg: number) => ({ day: "2026-09-01", kg, sets: 1, reps: 1 });
  const row = {
    start: at(50),
    latest: at(80),
    best: at(120),
    target: 100,
  };
  assert.deepEqual(
    progressMarks(row)?.map(({ key, at: place }) => [key, place]),
    [
      ["start", (50 / 120) * 100],
      ["latest", (80 / 120) * 100],
      ["best", 100],
      ["target", (100 / 120) * 100],
    ],
  );
  assert.equal(
    progressMarks({ start: at(50), latest: at(50), best: at(50), target: 0 })?.every(
      (mark) => mark.at === 100,
    ),
    true,
    "one weight and no target share the end of the line",
  );
  assert.deepEqual(
    progressMarks({ start: null, latest: null, best: null, target: 100 })?.map((mark) => mark.key),
    ["target"],
  );
  assert.equal(
    progressMarks({ start: null, latest: null, best: null, target: 0 }),
    null,
  );
});

test("Gators' targets read back as given, in pounds", () => {
  const targets = DEFAULT_SETTINGS.liftTargets.gators;
  assert.deepEqual(
    PROGRESS_LIFTS.map(({ key }) => displayLoad(targets[key], "lb")),
    ["175", "135", "255", "335"],
  );
  assert.deepEqual(DEFAULT_SETTINGS.liftTargets.hippos, none, "Hippos has none until Setup gets one");
});

test("settings saved before lift targets existed parse with the same targets the app shows", () => {
  const legacy = {
    eventDate: "2027-08-28", eventName: "ATHX New York", weeklyTarget: 4, weightUnit: "lb",
    targets: {
      hippos: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      gators: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    },
    bodyweight: { hippos: 0, gators: 84 },
  };
  const parsed = settingsSchema.parse(legacy);
  assert.deepEqual(parsed.liftTargets, DEFAULT_SETTINGS.liftTargets);
  assert.deepEqual(
    Object.keys(parsed.liftTargets.gators),
    PROGRESS_LIFTS.map(({ key }) => key),
    "the schema stores a target for every followed lift",
  );
  const bad = (targets: Partial<LiftTargets>) =>
    !settingsSchema.safeParse({ ...legacy, liftTargets: { hippos: none, gators: { ...none, ...targets } } }).success;
  assert.ok(bad({ deadlift: -1 }));
  assert.ok(bad({ deadlift: 1001 }));
  assert.ok(!bad({ deadlift: 0 }), "zero is no target");
});
