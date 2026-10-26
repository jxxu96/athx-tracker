import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  PROGRESS_LIFTS,
  displayLoad,
  formatWeight,
  type LiftTargets,
  type Workout,
} from "./domain.ts";
import {
  liftProgress,
  liftTotal,
  progressLift,
  leaderLanes,
  progressMarks,
  progressScale,
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

test("a varied lift counts as its heaviest sets, warm-ups included", () => {
  const row = jerkOf([
    workout({
      lifts: [{
        name: "Split jerk",
        kg: 40,
        sets: 2,
        reps: 3,
        detail: [
          { kg: 40, reps: 3 },
          { kg: 40, reps: 3 },
          { kg: 70, reps: 2 },
          { kg: 70, reps: 2 },
          { kg: 70, reps: 1 },
        ],
      }],
    }),
  ]);
  assert.deepEqual(row.best, { day: "2026-09-01", kg: 70, sets: 2, reps: 2 });
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

test("the bar fits its scale to the figures, in round steps", () => {
  const at = (kg: number) => ({ day: "2026-09-01", kg, sets: 1, reps: 1 });
  const bar = progressMarks({ start: at(50), latest: at(80), best: at(120), target: 100 }, "kg")!;
  // 50 to 120 kg in steps of 20, not 0 to 120.
  assert.deepEqual(bar.ticks.map((tick) => tick.value), [40, 60, 80, 100, 120]);
  assert.deepEqual(
    bar.marks.map(({ key, at: place }) => [key, place]),
    [
      ["start", 12.5],
      ["latest", 50],
      ["best", 100],
      ["target", 75],
    ],
  );
  assert.deepEqual(bar.ticks.map((tick) => tick.at), [0, 25, 50, 75, 100]);

  // The scale counts in the unit on screen.
  // Stored to two places, 135 lb comes back as 134.99, which must not tip
  // the step from 10 to 20.
  const lb = (pounds: number) => at(Math.round((pounds / 2.20462262) * 100) / 100);
  const pounds = progressMarks(
    { start: lb(135), latest: lb(150), best: lb(160), target: 175 / 2.20462262 },
    "lb",
  )!;
  assert.deepEqual(pounds.ticks.map((tick) => tick.value), [130, 140, 150, 160, 170, 180]);
  assert.equal(pounds.marks[0].at, 10);

  const alone = progressMarks({ start: at(50), latest: at(50), best: at(50), target: 0 }, "kg")!;
  assert.equal(
    alone.marks.every((mark) => mark.at === 50),
    true,
    "one weight and no target sit mid-line",
  );
  assert.deepEqual(alone.ticks.map((tick) => tick.value), [48, 50, 52]);
  assert.deepEqual(
    progressMarks({ start: null, latest: null, best: null, target: 100 }, "kg")?.marks.map(
      (mark) => mark.key,
    ),
    ["target"],
  );
  assert.equal(progressMarks({ start: null, latest: null, best: null, target: 0 }, "kg"), null);
});

test("progressScale never runs below zero", () => {
  assert.equal(progressScale([1, 30]).from, 0);
});

test("leaders turn in the lanes that cross least", () => {
  // In order, each a short step right: any lanes work, and none cross.
  assert.deepEqual(leaderLanes([{ from: 10, to: 2 }, { from: 40, to: 27 }]), [0, 1]);
  // Both run right; the one starting further left must turn lower, or its
  // run cuts the other's first drop.
  assert.deepEqual(
    leaderLanes([
      { from: 0, to: 50 },
      { from: 30, to: 77 },
    ]),
    [1, 0],
  );
});

test("the total adds press, squat and deadlift, and waits for all three", () => {
  const logged = liftProgress(
    [
      workout({
        lifts: [
          lift("Overhead press", 40),
          lift("Back squat", 100),
          lift("Deadlift", 120),
          lift("Split jerk", 70),
        ],
      }),
    ],
    "gators",
    { splitJerk: 80, overheadPress: 50, backSquat: 140, deadlift: 180 },
  );
  const total = liftTotal(logged);
  assert.equal(total.start, 260);
  assert.equal(total.latest, 260);
  assert.equal(total.best, 260);
  assert.equal(total.target, 370);
  const missing = liftProgress(
    [workout({ lifts: [lift("Overhead press", 40), lift("Back squat", 100)] })],
    "gators",
    { splitJerk: 0, overheadPress: 50, backSquat: 140, deadlift: 0 },
  );
  assert.equal(liftTotal(missing).start, null);
  assert.equal(liftTotal(missing).target, null, "one target left blank keeps the total empty");
  const gators = liftTotal(liftProgress([], "gators", DEFAULT_SETTINGS.liftTargets.gators));
  assert.equal(formatWeight(gators.target!, "lb"), "725 lb");
  assert.equal(formatWeight(gators.target!, "kg"), "328.9 kg");
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

test("the estimated max is the best any set of ten or fewer predicts, on the race's line", () => {
  const records = [
    workout({ id: "a", day: "2026-09-01", lifts: [lift("Deadlift", 101, 1, 1)] }),
    workout({
      id: "b",
      day: "2026-09-03",
      lifts: [{ name: "Deadlift", kg: 100, sets: 1, reps: 5, detail: [{ kg: 60, reps: 12 }, { kg: 100, reps: 5 }] }],
    }),
    // Twelve reps say little about a max, however heavy.
    workout({ id: "c", day: "2026-09-05", lifts: [lift("Deadlift", 100, 1, 12)] }),
  ];
  const row = liftProgress(records, "gators", none).find((item) => item.key === "deadlift")!;
  // The heaviest set is still the single; five at 100 predicts 100 x 36 / 32.
  assert.equal(row.best?.kg, 101);
  assert.deepEqual(row.estimated, { kg: 112.5, day: "2026-09-03", setKg: 100, reps: 5 });
  assert.equal(liftProgress([], "gators", none)[0].estimated, null);
});

test("an estimate reached again later stays with the day it was first reached", () => {
  const records = [
    workout({ id: "late", day: "2026-09-10", lifts: [lift("Back squat", 100, 3, 5)] }),
    workout({ id: "early", day: "2026-09-01", lifts: [lift("Back squat", 100, 1, 5)] }),
  ];
  const row = liftProgress(records, "gators", none).find((item) => item.key === "backSquat")!;
  assert.equal(row.estimated?.day, "2026-09-01");
});

test("weekly volume is load times reps for every set, by Monday week, the current week last", () => {
  const records = [
    // Thursday 3 September 2026 is in the week of Monday 31 August.
    workout({ id: "now", day: "2026-09-03", lifts: [lift("Deadlift", 100, 3, 5), lift("Back squat", 80, 1, 5)] }),
    workout({
      id: "varied",
      day: "2026-08-31",
      lifts: [{ name: "Deadlift", kg: 120, sets: 1, reps: 2, detail: [{ kg: 60, reps: 5 }, { kg: 120, reps: 2 }] }],
    }),
    workout({ id: "last", day: "2026-08-27", lifts: [lift("Deadlift", 90, 2, 5)] }),
    // Eight weeks back is out of the window; a day after today is not counted yet.
    workout({ id: "old", day: "2026-07-05", lifts: [lift("Deadlift", 90, 2, 5)] }),
    workout({ id: "ahead", day: "2026-09-04", lifts: [lift("Deadlift", 90, 2, 5)] }),
  ];
  const rows = liftProgress(records, "gators", none, "2026-09-03");
  const deadlift = rows.find((item) => item.key === "deadlift")!;
  assert.equal(deadlift.weeks.length, 8);
  assert.equal(deadlift.weeks[7], 1500 + 300 + 240);
  assert.equal(deadlift.weeks[6], 900);
  assert.deepEqual(deadlift.weeks.slice(0, 6), [0, 0, 0, 0, 0, 0]);
  assert.equal(rows.find((item) => item.key === "backSquat")!.weeks[7], 400);
  // Without a day to count from there are no weeks to show.
  assert.deepEqual(liftProgress(records, "gators", none)[0].weeks, []);
});
