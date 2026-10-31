import { test } from "node:test";
import assert from "node:assert/strict";
import { METCON, type Lift, type Segment, type Workout } from "./domain.ts";
import {
  ENDURANCE,
  athleteStrength,
  changeoverSeconds,
  endurancePlan,
  metconPlan,
  pairStation,
  pieces,
  raceEstimate,
  raceStart,
  raceLoad,
  repMax,
  runSeconds,
  farthestPiece,
  skiMetres,
  stationPace,
  strengthLift,
  strengthGoal,
  strengthPlan,
  zoneProgress,
} from "./race.ts";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w",
  kind: "workout",
  athlete: "gators",
  day: "2026-10-01",
  title: "Session",
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

const lift = (name: string, kg: number, sets: number, reps: number, detail?: Lift["detail"]): Lift =>
  detail ? { name, kg, sets, reps, detail } : { name, kg, sets, reps };

const piece = (name: string, completed: number, unit: Segment["unit"], seconds: number): Segment => ({
  name, unit, completed, target: completed, seconds, block: "endurance",
});

/** The ATHX circuit, all done, at the given splits in METCON's order. */
const circuit = (splits: number[]): Segment[] =>
  METCON.map((station, index) => ({
    name: station.name,
    unit: station.unit,
    completed: station.target,
    target: station.target,
    seconds: splits[index],
    block: "metcon" as const,
  }));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

test("a set is never carried up, only down on Brzycki's line", () => {
  assert.equal(repMax(100, 1, 1), 100);
  assert.equal(repMax(100, 3, 3), 100, "a set at the reps asked for is its own rep max");
  // Five at 155 lb is a 155 lb 2RM, not the 169.5 lb Brzycki would put on it.
  assert.equal(repMax(155, 5, 2), 155);
  assert.equal(repMax(100, 12, 1), 100);
  assert.ok(Math.abs(repMax(100, 1, 2) - 97.2222) < 1e-3);
  assert.equal(repMax(100, 2, 3), (100 * 34) / 35);
});

test("any press or jerk from the shoulders counts as shoulder to overhead, and other lifts do not", () => {
  for (const name of ["Split jerk", "Push press", "Overhead press", "OHP", "strict press", "Clean and jerk", "Push jerk", "push jerks", "S2OH"])
    assert.equal(strengthLift(name), "overhead", name);
  assert.equal(strengthLift("Back squat"), "squat");
  assert.equal(strengthLift("back squats"), "squat");
  assert.equal(strengthLift("Deadlift"), "deadlift");
  for (const name of ["Front squat", "Romanian deadlift", "RDL", "Thruster", "Bench press", "constructor"])
    assert.equal(strengthLift(name), null, name);
});

test("each lift is the most any set shows for the window, never carried up", () => {
  const strength = athleteStrength([
    workout({ day: "2026-10-01", lifts: [lift("Split jerk", 80, 1, 1)] }),
    workout({
      day: "2026-10-05",
      lifts: [
        // Three at 70 is a 70 kg single at most, below the jerk.
        lift("Push press", 70, 3, 3),
        // The single at 120 carries down to 116.7 kg for two, past the triple at 110.
        lift("Back squat", 120, 1, 1, [{ kg: 100, reps: 5 }, { kg: 110, reps: 3 }, { kg: 120, reps: 1 }]),
        // Fives and twelves show their own load for three, nothing more.
        lift("Deadlift", 140, 3, 5),
        lift("Deadlift", 130, 1, 12),
      ],
    }),
  ], "gators");
  assert.equal(strength.lifts.overhead?.kg, 80);
  assert.equal(strength.lifts.overhead?.name, "Split jerk");
  assert.equal(strength.lifts.squat?.shown, 117);
  assert.deepEqual(
    { day: strength.lifts.squat?.day, setKg: strength.lifts.squat?.setKg, reps: strength.lifts.squat?.reps },
    { day: "2026-10-05", setKg: 120, reps: 1 },
  );
  assert.equal(strength.lifts.deadlift?.kg, 140);
  assert.equal(strength.lifts.deadlift?.reps, 5);
  assert.equal(strength.total, 80 + 117 + 140);
});

test("the combined weight waits for all six lifts, and adds the whole kilograms shown", () => {
  const records = [
    workout({ lifts: [lift("Split jerk", 80, 1, 1), lift("Back squat", 120, 1, 1), lift("Deadlift", 140, 3, 5)] }),
    workout({ athlete: "hippos", lifts: [lift("Overhead press", 40, 3, 5), lift("Back squat", 70, 2, 2)] }),
    // Together has no single athlete, so its deadlift is nobody's.
    workout({ athlete: "team", lifts: [lift("Deadlift", 90, 1, 3)] }),
  ];
  const before = strengthPlan(records);
  assert.equal(before.athletes.hippos.lifts.overhead?.shown, 40);
  assert.equal(before.athletes.hippos.lifts.deadlift, null);
  assert.equal(before.athletes.hippos.total, null);
  assert.equal(before.combined, null);

  const after = strengthPlan([
    ...records,
    workout({ athlete: "hippos", lifts: [lift("Deadlift", 90, 1, 3)] }),
  ]);
  assert.equal(after.athletes.hippos.total, 40 + 70 + 90);
  assert.equal(after.athletes.gators.total, 80 + 117 + 140);
  assert.equal(after.combined, 200 + 337);
});

test("a run predicts its 2.4 km on Riegel's curve, in whatever unit it was logged", () => {
  assert.equal(runSeconds([{ metres: 2400, seconds: 720, day: "" }]), 720);
  const fiveK = runSeconds([{ metres: 5000, seconds: 1500, day: "" }])!;
  assert.ok(Math.abs(fiveK - 688.98) < 0.01);
  const runs = pieces([
    workout({
      category: "Endurance",
      segments: [
        piece("Run", 3, "mi", 1440),
        // Too short to say anything about 2.4 km.
        piece("Run", 400, "m", 60),
        // Not a run.
        piece("Ski erg", 2000, "m", 480),
      ],
    }),
  ], "gators", "Run");
  assert.equal(runs.length, 1);
  assert.ok(Math.abs(runs[0].metres - 4828.032) < 1e-6);
  assert.ok(Math.abs(runSeconds(runs)! - 686.42) < 0.01);
  assert.equal(runSeconds([]), null);
});

test("a SkiErg piece carries to the time on the erg, and none at all is unknown", () => {
  assert.ok(Math.abs(skiMetres([{ metres: 1000, seconds: 240, day: "" }], 480)! - 1923.05) < 0.01);
  assert.equal(skiMetres([], 300), null);
  assert.equal(skiMetres([], 0), 0);
});

test("the farthest-reaching SkiErg piece is the same at any time on the erg", () => {
  const sprint = { metres: 1000, seconds: 240, day: "a" };
  const long = { metres: 5000, seconds: 1400, day: "b" };
  assert.equal(farthestPiece([sprint, long]), sprint);
  for (const seconds of [60, 300, 900, 1440]) {
    assert.equal(skiMetres([sprint, long], seconds), skiMetres([sprint], seconds));
  }
  assert.equal(farthestPiece([]), null);
});

test("the first back skis alone, then you take turns until 24:00", () => {
  const plan = endurancePlan([
    workout({ athlete: "hippos", category: "Endurance", segments: [piece("Run", 2.4, "km", 840)] }),
    workout({ athlete: "gators", category: "Endurance", segments: [piece("Run", 2400, "m", 720)] }),
    // Mixed is where any other endurance machine is logged, under the list's name or near it.
    workout({ athlete: "hippos", category: "Mixed", segments: [piece("Ski erg", 1000, "m", 300)] }),
    workout({ athlete: "gators", category: "Mixed", segments: [piece("SkiErg", 2000, "m", 420)] }),
  ]);
  assert.deepEqual(plan.run, { hippos: 840, gators: 720 });
  assert.equal(plan.skiFrom, 720);
  // Gators alone from 12:00 to 14:00, then ten minutes shared: five each.
  assert.deepEqual(plan.ski, {
    hippos: { seconds: 300, metres: 1000 },
    gators: { seconds: 420, metres: 2000 },
  });
  assert.equal(plan.metres, 3000);
  assert.deepEqual(plan.missing, []);
});

test("without a SkiErg piece, or a run, the endurance score is withheld and says whose", () => {
  const noSki = endurancePlan([
    workout({ athlete: "hippos", segments: [piece("Run", 2400, "m", 840)] }),
    workout({ athlete: "gators", segments: [piece("Run", 2400, "m", 720), piece("Ski erg", 2000, "m", 420)] }),
  ]);
  assert.equal(noSki.ski?.hippos.metres, null);
  assert.equal(noSki.metres, null);
  assert.deepEqual(noSki.missing, [{ athlete: "hippos", piece: "ski" }]);

  const noRun = endurancePlan([
    workout({ athlete: "gators", segments: [piece("Run", 2400, "m", 720)] }),
  ]);
  assert.equal(noRun.ski, null);
  assert.equal(noRun.metres, null);
  assert.deepEqual(noRun.skiPiece, { hippos: null, gators: null });
  assert.deepEqual(noRun.missing, [
    { athlete: "hippos", piece: "run" },
    { athlete: "hippos", piece: "ski" },
    { athlete: "gators", piece: "ski" },
  ]);
});

test("a SkiErg piece shows before the runs that set its time on the erg", () => {
  const plan = endurancePlan([
    workout({ athlete: "hippos", segments: [piece("Ski erg", 1000, "m", 240), piece("Ski erg", 500, "m", 100)] }),
    workout({ athlete: "hippos", day: "2026-09-02", segments: [piece("SkiErg", 2000, "m", 540)] }),
  ]);
  assert.equal(plan.ski, null);
  assert.equal(plan.metres, null);
  // The 500 m is a sprint and left out; the 1,000 m carries farther than the 2,000 m.
  assert.deepEqual(plan.skiPiece, { hippos: { metres: 1000, seconds: 240, day: "2026-10-01" }, gators: null });
});

test("runs that take the whole cap leave nobody any time to ski", () => {
  const slow = endurancePlan([
    workout({ athlete: "hippos", segments: [piece("Run", 2400, "m", ENDURANCE.capSeconds + 60)] }),
    workout({ athlete: "gators", segments: [piece("Run", 2400, "m", ENDURANCE.capSeconds + 30)] }),
  ]);
  assert.equal(slow.skiFrom, null);
  assert.equal(slow.metres, 0);
});

test("the quicker of you takes a station, and the carry is half each", () => {
  const bench = { name: "DB bench press", target: 30 };
  assert.deepEqual(pairStation(bench, 4, 2), { seconds: 60, by: "gators" });
  assert.deepEqual(pairStation(bench, 1.5, 2), { seconds: 45, by: "hippos" });
  assert.deepEqual(pairStation(bench, 3, 3), { seconds: 90, by: "either" });
  // One pace is enough: that athlete takes it.
  assert.deepEqual(pairStation(bench, null, 2), { seconds: 60, by: "gators" });
  assert.deepEqual(pairStation(bench, null, null), { seconds: null, by: null });
  const carry = { name: "Sandbag carry", target: 60 };
  assert.deepEqual(pairStation(carry, 2, 1), { seconds: 90, by: "both" });
  // Each of you carries 30 m, so one pace is not enough.
  assert.deepEqual(pairStation(carry, null, 1), { seconds: null, by: null });
});

test("a station's pace is the quickest timed attempt, and a row can stand in for a row", () => {
  const burpees = METCON.find((station) => station.name === "Burpees over bench")!;
  const closing = METCON.find((station) => station.name === "Closing row")!;
  const records = [
    workout({ category: "MetCon", segments: [{ ...circuit([120, 90, 60, 90, 60, 150, 0])[5] }] }),
    workout({ category: "Mixed", segments: [{ ...circuit([0, 0, 0, 0, 0, 120, 0])[5] }] }),
    // Untimed work has no pace to offer.
    workout({ category: "MetCon", segments: [{ ...circuit([0, 0, 0, 0, 0, 0, 0])[5] }] }),
    workout({ category: "MetCon", segments: [{ ...circuit([120, 0, 0, 0, 0, 0, 0])[0] }] }),
  ];
  assert.equal(stationPace(records, "gators", burpees), 4);
  assert.equal(stationPace(records, "gators", closing), 3);
  assert.equal(stationPace(records, "hippos", burpees), null);
  // A row counted in metres is not calories.
  assert.equal(
    stationPace([workout({ segments: [{ ...piece("Closing row", 500, "m", 100), block: "metcon" }] })], "gators", closing),
    null,
  );
});

test("an attempt lighter than race weight is not race pace, and the rack's nearest load is", () => {
  const bench = METCON.find((station) => station.name === "DB bench press")!;
  const set = (kg: number | undefined, seconds: number): Segment => ({
    name: "DB bench press", unit: "reps", completed: 30, target: 30, seconds, block: "metcon",
    ...(kg === undefined ? {} : { kg }),
  });
  // Gators races on 15 kg dumbbells: 1 kg is practice, not pace.
  assert.equal(stationPace([workout({ segments: [set(1, 30), set(15, 60)] })], "gators", bench), 2);
  assert.equal(stationPace([workout({ segments: [set(1, 30)] })], "gators", bench), null);
  // Heavier counts, and so does an attempt with no load recorded.
  assert.equal(stationPace([workout({ segments: [set(17.5, 45), set(15, 60)] })], "gators", bench), 1.5);
  assert.equal(stationPace([workout({ segments: [set(undefined, 50)] })], "gators", bench), 50 / 30);
  // Hippos' 7.5 kg is offered as 15 lb, which saves as 6.8 kg and is her race weight.
  assert.ok(Math.abs(raceLoad(7.5) - 6.8039) < 1e-4);
  assert.equal(stationPace([workout({ athlete: "hippos", segments: [set(6.8, 75)] })], "hippos", bench), 2.5);
  assert.equal(stationPace([workout({ athlete: "hippos", segments: [set(5, 40)] })], "hippos", bench), null);
});

test("time between stations comes from circuits whose clock is longer than their splits", () => {
  const splits = [120, 90, 60, 90, 60, 120, 160];
  assert.equal(
    changeoverSeconds([
      workout({ category: "MetCon", seconds: sum(splits) + 60, segments: circuit(splits) }),
      workout({ category: "MetCon", seconds: sum(splits) + 120, segments: circuit(splits) }),
      workout({ category: "MetCon", seconds: sum(splits) + 600, segments: circuit(splits) }),
      // A clock that is only the splits shows nothing between them.
      workout({ category: "MetCon", seconds: sum(splits), segments: circuit(splits) }),
      // A mixed session's clock holds its lifts as well.
      workout({ category: "Mixed", seconds: sum(splits) + 900, segments: circuit(splits) }),
    ], "gators"),
    20,
  );
  assert.equal(changeoverSeconds([], "gators"), null);
});

test("the MetCon is every station for the pair plus the time between them", () => {
  const gators = [120, 90, 60, 90, 60, 120, 160];
  const hippos = [240, 90, 45, 180, 120, 120, 240];
  const records = [
    workout({ category: "MetCon", seconds: sum(gators) + 60, segments: circuit(gators) }),
    workout({ athlete: "hippos", category: "MetCon", seconds: sum(hippos), segments: circuit(hippos) }),
  ];
  const plan = metconPlan(records);
  assert.deepEqual(
    plan.stations.map((station) => [station.seconds, station.by]),
    [
      [120, "gators"],
      [90, "either"],
      [45, "hippos"],
      [90, "gators"],
      // Hippos' 30 m at 2 s a metre and Gators' at 1.
      [90, "both"],
      [120, "either"],
      [160, "gators"],
    ],
  );
  // Only Gators' clock shows the changes: ten seconds each, six of them.
  assert.equal(plan.changeovers, 60);
  assert.equal(plan.changeoversKnown, true);
  assert.equal(plan.seconds, 715 + 60);
  assert.deepEqual(plan.missing, []);
});

test("the MetCon waits for every station to have a pace, and the carry for both of you", () => {
  const gators = [120, 90, 60, 90, 60, 120, 160];
  const alone = metconPlan([
    workout({ category: "MetCon", seconds: sum(gators), segments: circuit(gators) }),
  ]);
  // Gators can take every station, but not Hippos' half of the carry.
  assert.deepEqual(alone.missing, [{ station: "Sandbag carry", athlete: "hippos" }]);
  assert.equal(alone.seconds, null);
  assert.equal(alone.stations[0].by, "gators");

  const noBurpees = metconPlan([
    workout({ category: "MetCon", segments: circuit([120, 90, 60, 90, 60, 0, 160]) }),
    workout({ athlete: "hippos", category: "MetCon", segments: circuit([240, 90, 45, 180, 120, 0, 240]) }),
  ]);
  assert.deepEqual(noBurpees.missing, [{ station: "Burpees over bench", athlete: null }]);
  assert.equal(noBurpees.seconds, null);
});

test("an empty journal estimates nothing and says what each part needs", () => {
  const empty = raceEstimate([]);
  assert.equal(empty.strength.combined, null);
  assert.equal(empty.endurance.metres, null);
  assert.equal(empty.endurance.missing.length, 4);
  assert.equal(empty.metcon.seconds, null);
  assert.equal(empty.metcon.missing.length, METCON.length + 1);
  assert.equal(empty.metcon.changeoversKnown, false);
});

test("each zone starts from the first day the log could estimate it", () => {
  const lifts = (kg: number): Lift[] => [
    { name: "Overhead press", kg, sets: 1, reps: 1 },
    { name: "Back squat", kg, sets: 1, reps: 2 },
    { name: "Deadlift", kg, sets: 1, reps: 3 },
  ];
  const records = [
    workout({ id: "a", athlete: "hippos", day: "2026-09-01", lifts: lifts(40) }),
    // Together counts for neither, so it cannot start anything.
    workout({ id: "t", athlete: "team", day: "2026-09-02", lifts: lifts(200) }),
    workout({ id: "b", athlete: "gators", day: "2026-09-05", lifts: lifts(60) }),
    workout({ id: "c", athlete: "gators", day: "2026-09-20", lifts: lifts(80) }),
  ];
  const start = raceStart(records);
  assert.deepEqual(start.strength, { score: 300, day: "2026-09-05" });
  assert.equal(start.endurance, null);
  assert.equal(start.metcon, null);
  assert.equal(strengthPlan(records).combined, 360, "now is still the best logged");
  assert.deepEqual(raceStart([]), { strength: null, endurance: null, metcon: null });
});

test("a start is the first score even when a later day has none", () => {
  const run = (athlete: "hippos" | "gators", day: string, seconds: number) =>
    workout({
      id: `${athlete}${day}`, athlete, day, category: "Endurance",
      segments: [piece("Run", 2.4, "km", seconds)],
    });
  // Both past the cap ski nothing, which scores 0 m; a quicker run then needs a SkiErg piece.
  const records = [
    run("hippos", "2026-09-01", 1500),
    run("gators", "2026-09-01", 1500),
    run("gators", "2026-09-02", 600),
  ];
  assert.equal(endurancePlan(records).metres, null);
  assert.deepEqual(raceStart(records).endurance, { score: 0, day: "2026-09-01" });
});

test("progress is the share of the way from start to goal, either direction", () => {
  assert.equal(zoneProgress(300, 360, 400, false), 60);
  assert.equal(zoneProgress(900, 840, 780, true), 50, "a time counts down");
  assert.equal(zoneProgress(300, 280, 400, false), 0, "below the start is nothing covered");
  assert.equal(zoneProgress(300, 450, 400, false), 100);
  assert.equal(zoneProgress(300, 360, 0, false), null, "no goal");
  assert.equal(zoneProgress(400, 420, 400, false), null, "started at the goal");
});

test("Strength's goal is the lift targets, each the rep max its window asks for", () => {
  const none = { splitJerk: 0, overheadPress: 0, pushPress: 0, backSquat: 0, deadlift: 0 };
  const hippos = { ...none, pushPress: 40, backSquat: 72, deadlift: 90.4 };
  const gators = { ...none, splitJerk: 80, overheadPress: 60, backSquat: 108, deadlift: 144 };
  // 40 + 72 + 90 in whole kilograms, and the split jerk over the press: 80 + 108 + 144.
  assert.equal(strengthGoal({ hippos, gators }), 534);
  assert.equal(strengthGoal({ hippos: { ...hippos, deadlift: 0 }, gators }), null, "needs all six");
  // Each athlete's press is the one they follow; the other is not in Setup to change.
  assert.equal(strengthGoal({ hippos: { ...hippos, pushPress: 0, overheadPress: 40 }, gators }), null);
  assert.equal(strengthGoal({ hippos, gators: { ...gators, splitJerk: 0, pushPress: 100 } }), 514);
  // Settings saved before the push press was followed have no target for it.
  const older: Partial<typeof gators> = { ...gators };
  delete older.pushPress;
  assert.equal(strengthGoal({ hippos, gators: older as typeof gators }), 534);
});
