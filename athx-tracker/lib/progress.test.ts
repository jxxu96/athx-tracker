import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  FOLLOWED_LIFTS,
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
  strengthProgress,
  leaderLanes,
  progressMarks,
  progressScale,
  shownGap,
  toGo,
  togetherLiftSessions,
} from "./progress.ts";
import { athleteStrength } from "./race.ts";
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
const none: LiftTargets = { splitJerk: 0, overheadPress: 0, pushPress: 0, backSquat: 0, deadlift: 0 };
const jerkOf = (records: Workout[], targets = none) =>
  liftProgress(records, "gators", targets).find((row) => row.key === "splitJerk")!;

test("the four lifts follow in a fixed order, each with its target", () => {
  const rows = liftProgress([], "gators", DEFAULT_SETTINGS.liftTargets.gators);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Split jerk", "Overhead press", "Back squat", "Deadlift"],
  );
  assert.deepEqual(rows.map((row) => row.reps), [1, 1, 2, 3], "each at the rep max its race window asks for");
  for (const row of rows) {
    assert.equal(row.start, null);
    assert.equal(row.sessions, 0);
    assert.ok(row.target > 0);
  }
});

test("Hippos follows the push press where Gators follows the overhead press", () => {
  const records = [
    workout({ athlete: "hippos", lifts: [lift("Push press", 45), lift("Overhead press", 35)] }),
    workout({ athlete: "gators", lifts: [lift("Push press", 80), lift("Overhead press", 60)] }),
  ];
  const targets = { ...none, overheadPress: 40, pushPress: 50 };
  const hippos = liftProgress(records, "hippos", targets);
  const gators = liftProgress(records, "gators", targets);
  assert.deepEqual(
    hippos.map((row) => row.name),
    ["Split jerk", "Push press", "Back squat", "Deadlift"],
  );
  assert.deepEqual(
    gators.map((row) => row.name),
    ["Split jerk", "Overhead press", "Back squat", "Deadlift"],
  );
  const press = hippos.find((row) => row.key === "pushPress")!;
  assert.equal(press.best!.kg, 45, "a strict press is not counted as the push press");
  assert.equal(press.target, 50);
  assert.equal(gators.find((row) => row.key === "overheadPress")!.best!.kg, 60);
});

test("start is the first day, latest the last, best the most a day shows", () => {
  const row = jerkOf([
    // Newest first, as the journal holds them.
    workout({ day: "2026-10-20", lifts: [lift("Split jerk", 70, 1, 3)] }),
    workout({ day: "2026-10-12", lifts: [lift("Split jerk", 72.5, 1, 1)] }),
    workout({ day: "2026-09-02", lifts: [lift("Split jerk", 60, 5, 3)] }),
  ]);
  assert.deepEqual(row.start, { day: "2026-09-02", kg: 60, setKg: 60, reps: 3 });
  assert.deepEqual(row.latest, { day: "2026-10-20", kg: 70, setKg: 70, reps: 3 });
  // Three at 70 is not carried up past the 72.5 single.
  assert.deepEqual(row.best, { day: "2026-10-12", kg: 72.5, setKg: 72.5, reps: 1 });
  assert.equal(row.sessions, 3);
});

test("the squat is a 2RM and the deadlift a 3RM, carried down from fewer reps and never up", () => {
  const rows = liftProgress(
    [workout({ lifts: [lift("Back squat", 100, 3, 5), lift("Deadlift", 120, 1, 1), lift("Split jerk", 80, 1, 1)] })],
    "gators",
    none,
  );
  const of = (key: string) => rows.find((row) => row.key === key)!.best!;
  // Five at 100 kg is a 100 kg 2RM; a single at 120 carries down to 120 x 34 / 36 for three.
  assert.deepEqual(of("backSquat"), { day: "2026-09-01", kg: 100, setKg: 100, reps: 5 });
  assert.equal(of("deadlift").kg, (120 * 34) / 36);
  assert.equal(of("splitJerk").kg, 80, "a single is its own 1RM");
  const pounds = liftProgress([workout({ lifts: [lift("Back squat", 155, 1, 5)] })], "gators", none);
  assert.equal(pounds.find((row) => row.key === "backSquat")!.best!.kg, 155, "a 5RM of 155 is a 2RM of 155, not 170");
  const exact = liftProgress([workout({ lifts: [lift("Back squat", 110, 2, 2)] })], "gators", none);
  assert.equal(exact.find((row) => row.key === "backSquat")!.best!.kg, 110, "two reps is its own 2RM");
});

test("a day counts as the set that shows most, and a warm-up never stands in for it", () => {
  const row = jerkOf([
    workout({
      day: "2026-09-02",
      lifts: [lift("Split jerk", 40, 2, 3), lift("Split jerk", 60, 3, 2), lift("Split jerk", 50, 1, 2)],
    }),
    // Two sessions on one day are one day, at the heavier of the two.
    workout({ id: "pm", day: "2026-09-02", lifts: [lift("Split jerk", 62.5, 1, 1)] }),
  ]);
  assert.deepEqual(row.start, { day: "2026-09-02", kg: 62.5, setKg: 62.5, reps: 1 });
  assert.deepEqual(row.latest, row.start);
  assert.equal(row.sessions, 2, "both sessions logged it");
});

test("a varied lift counts as the set that shows most, warm-ups included", () => {
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
  // The double and the single at 70 are both a 70 kg 1RM; the double did more with it.
  assert.deepEqual(row.best, { day: "2026-09-01", kg: 70, setKg: 70, reps: 2 });
});

test("within a day equal weight goes to more reps, and a best belongs to the day it was first reached", () => {
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
  // Three at 70 is still a 70 kg single, not carried up, so the first day keeps it.
  assert.equal(better.best!.day, "2026-09-01");
});

test("names match the way a described workout's do, and variations stay out", () => {
  assert.equal(progressLift("Split jerk"), "splitJerk");
  assert.equal(progressLift("OHP"), "overheadPress");
  assert.equal(progressLift("strict press"), "overheadPress");
  assert.equal(progressLift("Push press"), "pushPress");
  assert.equal(progressLift("barbell back squats"), "backSquat");
  assert.equal(progressLift("deadlifts"), "deadlift");
  for (const other of ["Front squat", "Romanian deadlift", "Sumo deadlift", "Push jerk", "Squat"])
    assert.equal(progressLift(other), null, other);
});

test("only that athlete's sessions count, and together sessions count for nobody", () => {
  const records = [
    workout({ athlete: "hippos", lifts: [lift("Deadlift", 80, 1, 3)] }),
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
  assert.equal(toGo({ best: { kg: best }, target }, "lb"), 15);
  assert.equal(toGo({ best: { kg: 80 }, target }, "lb")! <= 0, true, "past the target is reached");
  assert.equal(toGo({ best: null, target }, "lb"), null, "nothing logged has no gap yet");
  assert.equal(toGo({ best: { kg: best }, target: 0 }, "lb"), null);
  assert.equal(shownGap(60, 62.5, "kg"), 2.5);
});

test("the bar fits its scale to the figures, in round steps", () => {
  const at = (kg: number) => ({ kg });
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

test("the total adds the race's three lifts, and waits for all three", () => {
  const records = [
    workout({
      lifts: [
        lift("Overhead press", 40),
        lift("Back squat", 100, 1, 2),
        lift("Deadlift", 120, 1, 3),
        lift("Split jerk", 70),
      ],
    }),
  ];
  const targets = { ...none, splitJerk: 80, overheadPress: 50, backSquat: 140, deadlift: 180 };
  const total = liftTotal(strengthProgress(records, "gators"), targets, "gators");
  // Shoulder to overhead is the jerk, the more of the two, as the higher target is.
  assert.equal(total.start, 290);
  assert.equal(total.latest, 290);
  assert.equal(total.best, 290);
  assert.equal(total.target, 400);
  const missing = strengthProgress(
    [workout({ lifts: [lift("Overhead press", 40), lift("Back squat", 100, 1, 2)] })],
    "gators",
  );
  assert.equal(liftTotal(missing, { ...none, overheadPress: 50, backSquat: 140 }, "gators").start, null);
  assert.equal(
    liftTotal(missing, { ...none, overheadPress: 50, backSquat: 140 }, "gators").target,
    null,
    "one target left blank keeps the total empty",
  );
  const gators = liftTotal(strengthProgress([], "gators"), DEFAULT_SETTINGS.liftTargets.gators, "gators");
  // The 175 lb jerk target over the 135 lb press, then 255 and 335.
  assert.equal(formatWeight(gators.target!, "lb"), "765 lb");
  assert.equal(formatWeight(gators.target!, "kg"), "347 kg");
  const hippos = liftTotal(
    strengthProgress(
      [workout({ athlete: "hippos", lifts: [lift("Push press", 45), lift("Back squat", 80, 1, 2), lift("Deadlift", 100, 1, 3)] })],
      "hippos",
    ),
    { ...none, overheadPress: 40, pushPress: 50, backSquat: 90, deadlift: 110 },
    "hippos",
  );
  assert.equal(hippos.best, 225, "Hippos' total takes the push press");
  assert.equal(hippos.target, 250, "a target for the press Hippos does not follow is not counted");
});

test("the total's best is the race estimate's Strength for the athlete", () => {
  const records = [
    workout({ id: "a", day: "2026-09-01", lifts: [lift("Overhead press", 55, 3, 5), lift("Back squat", 120, 5, 5)] }),
    // Gators does not follow the push press, and neither is a clean and jerk a
    // row on Progress, but either puts a load overhead in the race.
    workout({ id: "b", day: "2026-09-08", lifts: [lift("Push press", 75, 3, 3), lift("Deadlift", 160, 3, 5)] }),
    workout({ id: "c", day: "2026-09-15", lifts: [lift("Clean and jerk", 80, 1, 1), lift("Back squat", 130, 1, 1)] }),
  ];
  const windows = strengthProgress(records, "gators");
  const race = athleteStrength(records, "gators").lifts;
  assert.equal(windows.overhead.best!.kg, race.overhead!.kg);
  assert.equal(windows.squat.best!.kg, race.squat!.kg);
  assert.equal(windows.deadlift.best!.kg, race.deadlift!.kg);
  assert.equal(windows.overhead.best!.day, "2026-09-15");
  // The first overhead day is the strict press, the latest the clean and jerk.
  assert.equal(windows.overhead.start!.setKg, 55);
  assert.equal(windows.overhead.latest!.setKg, 80);
  const total = liftTotal(windows, none, "gators");
  assert.equal(total.best, race.overhead!.kg + race.squat!.kg + race.deadlift!.kg);
});

test("Gators' targets read back as given, in pounds", () => {
  const targets = DEFAULT_SETTINGS.liftTargets.gators;
  assert.deepEqual(
    FOLLOWED_LIFTS.gators.map(({ key }) => displayLoad(targets[key], "lb")),
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
  const beforePushPress: Partial<LiftTargets> = { ...none };
  delete beforePushPress.pushPress;
  const older = settingsSchema.parse({ ...legacy, liftTargets: { hippos: beforePushPress, gators: beforePushPress } });
  assert.equal(older.liftTargets.hippos.pushPress, 0, "targets saved before the push press parse with none for it");
  // Race goals saved with their own Strength figure, before it followed the lift targets.
  const goals = settingsSchema.parse({ ...legacy, raceGoals: { strength: 400, endurance: 3000, metcon: 900 } });
  assert.deepEqual(goals.raceGoals, { endurance: 3000, metcon: 900 });
});

test("a figure is the most any set shows on the race's line, however many reps", () => {
  const records = [
    workout({ id: "a", day: "2026-09-01", lifts: [lift("Deadlift", 101, 1, 1)] }),
    workout({
      id: "b",
      day: "2026-09-03",
      lifts: [{ name: "Deadlift", kg: 100, sets: 1, reps: 5, detail: [{ kg: 60, reps: 12 }, { kg: 100, reps: 5 }] }],
    }),
    // Twelve at 100 is 100 for three too, and no more.
    workout({ id: "c", day: "2026-09-05", lifts: [lift("Deadlift", 100, 1, 12)] }),
  ];
  const row = liftProgress(records, "gators", none).find((item) => item.key === "deadlift")!;
  // The 101 single carries down to 101 x 34 / 36 for three, under five at 100.
  assert.equal(row.start?.kg, (101 * 34) / 36);
  assert.deepEqual(row.best, { kg: 100, day: "2026-09-03", setKg: 100, reps: 5 });
  assert.deepEqual(row.latest, { kg: 100, day: "2026-09-05", setKg: 100, reps: 12 });
  assert.equal(liftProgress([], "gators", none)[0].best, null);
});

test("an estimate reached again later stays with the day it was first reached", () => {
  const records = [
    workout({ id: "late", day: "2026-09-10", lifts: [lift("Back squat", 100, 3, 5)] }),
    workout({ id: "early", day: "2026-09-01", lifts: [lift("Back squat", 100, 1, 5)] }),
  ];
  const row = liftProgress(records, "gators", none).find((item) => item.key === "backSquat")!;
  assert.equal(row.best?.day, "2026-09-01");
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
