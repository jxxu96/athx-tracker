import { test } from "node:test";
import assert from "node:assert/strict";
import { METCON, type Lift, type RecordItem, type Segment, type Workout } from "./domain.ts";
import { journalSummary } from "./summary.ts";
import {
  MOVEMENTS,
  RUNNING_ORDER,
  TWICE_WEEKLY,
  lastDone,
  movementOf,
  movementsIn,
  recency,
  seenLabel,
  seenSpoken,
  seenTable,
  staleCount,
  weekDays,
  weekLabel,
  weekSpoken,
  weekTable,
  type LastDone,
  type WeekDays,
} from "./running-order.ts";

const TODAY = "2026-11-11";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w",
  kind: "workout",
  athlete: "gators",
  day: TODAY,
  title: "Session",
  category: "Mixed",
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

const lift = (name: string, kg = 60, sets = 3, reps = 5): Lift => ({ name, kg, sets, reps });

const station = (name: string, completed: number, unit: Segment["unit"] = "reps", seconds = 0): Segment => ({
  name, unit, completed, target: completed, seconds,
});

test("the running order is race day's: Strength, Endurance, then MetCon X, every workout in it", () => {
  assert.deepEqual(RUNNING_ORDER.map((zone) => zone.key), ["strength", "endurance", "metcon"]);
  assert.deepEqual(
    RUNNING_ORDER[0].steps.map((step) => `${step.name} ${step.asks[0]}`),
    ["Shoulder to overhead 1RM", "Back squat 2RM", "Deadlift 3RM"],
  );
  assert.deepEqual(RUNNING_ORDER[1].steps.map((step) => step.name), ["Run", "SkiErg"]);
  assert.equal(RUNNING_ORDER[1].steps[0].asks[0], "2.4 km each");
  assert.deepEqual(RUNNING_ORDER[2].steps.map((step) => step.name), METCON.map((s) => s.name));
  assert.deepEqual(RUNNING_ORDER.map((zone) => zone.time), ["20 min", "24 min cap", "25 min cap"]);
  assert.deepEqual(RUNNING_ORDER.map((zone) => zone.then), ["10 min refuel", "30 min recovery", undefined]);
  // Every station has a workout to be last done, so none can show a blank.
  for (const step of RUNNING_ORDER.flatMap((zone) => zone.steps))
    assert.ok(MOVEMENTS.includes(step.movement), step.name);
});

test("each station asks what the circuit does, and loaded ones carry each of your loads", () => {
  const metcon = RUNNING_ORDER[2].steps;
  assert.deepEqual(metcon[0].asks, ["40 cal", "shared calories"]);
  assert.deepEqual(metcon[2].kg, { hippos: 7.5, gators: 15 });
  assert.equal(metcon[2].per, " / DB");
  assert.deepEqual(metcon[4].asks, ["60 m", "30 m each"]);
  assert.equal(metcon[5].kg, undefined);
});

test("a lift counts where the race takes it, and every other name is only itself", () => {
  for (const name of ["Split jerk", "Push press", "Overhead press", "OHP", "Clean and jerk", "push jerk"])
    assert.equal(movementOf(name), "overhead", name);
  assert.equal(movementOf("Back squat"), "squat");
  assert.equal(movementOf("Deadlift"), "deadlift");
  assert.equal(movementOf("Running"), "run");
  assert.equal(movementOf("SkiErg"), "ski");
  for (const name of ["Opening row", "Closing row", "Row", "rower"]) assert.equal(movementOf(name), "row", name);
  assert.equal(movementOf("DB ground to overhead"), "groundToOverhead");
  assert.equal(movementOf("Sandbag carry"), "carry");
  assert.equal(movementOf("Burpees over bench"), "burpees");
  for (const name of ["Front squat", "Romanian deadlift", "Burpee", "Bench press", "Barbell row", "constructor", ""])
    assert.equal(movementOf(name), null, name);
});

test("a workout counts with work logged against it, at any load", () => {
  const done = movementsIn(workout({
    lifts: [lift("Deadlift", 0, 3, 5)],
    segments: [
      station("Opening row", 40, "cal"),
      // Not reached, or the other one's in pairs.
      station("DB bench press", 0),
      // A time alone is still time at it, as older stations were saved.
      station("Ski erg", 0, "m", 300),
    ],
  }));
  assert.deepEqual([...done].sort(), ["deadlift", "row", "ski"]);
  assert.equal(movementsIn(workout({ lifts: [lift("Back squat", 100, 0, 0)] })).size, 0);
});

test("the last time is each athlete's newest day at it, up to today, and Together is nobody's", () => {
  const records: RecordItem[] = [
    workout({ id: "a", day: "2026-11-01", lifts: [lift("Back squat")] }),
    workout({ id: "b", day: "2026-11-09", lifts: [lift("Back squat")] }),
    workout({ id: "c", day: "2026-11-05", lifts: [lift("Back squat")] }),
    workout({ id: "d", athlete: "hippos", day: "2026-11-10", segments: [station("Run", 5, "km", 1800)] }),
    // Logged ahead: not done yet.
    workout({ id: "e", athlete: "hippos", day: "2026-11-12", lifts: [lift("Deadlift")] }),
    workout({ id: "f", athlete: "team", day: TODAY, lifts: [lift("Deadlift")] }),
  ];
  const last = lastDone(records, TODAY);
  assert.deepEqual(last.gators, { squat: "2026-11-09" });
  assert.deepEqual(last.hippos, { run: "2026-11-10" });
});

const done = (over: Partial<Record<"hippos" | "gators", LastDone["hippos"]>>): LastDone => ({
  hippos: {}, gators: {}, ...over,
});

test("the phone answers for the days it holds whole, and the whole journal for older ones", () => {
  const phone = done({ gators: { squat: "2026-11-09", run: "2026-10-01" } });
  const journal = done({
    gators: { squat: "2026-11-09", run: "2026-10-01", ski: "2026-09-02", deadlift: "2026-11-03" },
    hippos: { row: "2026-08-30" },
  });
  const seen = seenTable(phone, journal, "2026-10-01");
  assert.deepEqual(seen.gators.squat, { day: "2026-11-09" });
  assert.deepEqual(seen.gators.run, { day: "2026-10-01" });
  assert.deepEqual(seen.gators.ski, { day: "2026-09-02" });
  assert.deepEqual(seen.hippos.row, { day: "2026-08-30" });
  // The server still has a deadlift the phone deleted and has not sent yet.
  assert.equal(seen.gators.deadlift, null);
  assert.equal(seen.hippos.burpees, null);
});

test("with the whole journal on the phone it answers alone, and without the server's answer it says how old at least", () => {
  const phone = done({ hippos: { carry: "2026-11-02" } });
  const whole = seenTable(phone, undefined, null);
  assert.deepEqual(whole.hippos.carry, { day: "2026-11-02" });
  assert.equal(whole.hippos.ski, null);
  const slice = seenTable(phone, undefined, "2026-10-01");
  assert.deepEqual(slice.hippos.carry, { day: "2026-11-02" });
  assert.deepEqual(slice.hippos.ski, { day: "2026-10-01", onOrBefore: true });
  assert.equal(seenLabel(slice.hippos.ski, TODAY), "41d+");
  assert.equal(seenSpoken(slice.hippos.ski, TODAY), "41 days or more ago");
});

test("green is 5 days or less, yellow 14 or less, and red longer or never", () => {
  const ago = (days: number) => {
    const date = new Date(`${TODAY}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return { day: date.toISOString().slice(0, 10) };
  };
  assert.equal(recency(ago(0), TODAY), "fresh");
  assert.equal(recency(ago(5), TODAY), "fresh");
  assert.equal(recency(ago(6), TODAY), "due");
  assert.equal(recency(ago(14), TODAY), "due");
  assert.equal(recency(ago(15), TODAY), "stale");
  assert.equal(recency(null, TODAY), "stale");
  assert.equal(seenLabel(ago(0), TODAY), "Today");
  assert.equal(seenLabel(ago(1), TODAY), "1d ago");
  assert.equal(seenLabel(ago(14), TODAY), "14d ago");
  assert.equal(seenLabel(null, TODAY), "Never");
  assert.equal(seenSpoken(ago(1), TODAY), "1 day ago");
  assert.equal(seenSpoken(ago(0), TODAY), "today");
});

test("the folded line counts the red rows on screen, both rows included", () => {
  const seen = seenTable(done({ gators: { squat: TODAY } }), done({}), null);
  assert.equal(staleCount(seen, "gators", TODAY), 11);
  assert.equal(staleCount(seen, "hippos", TODAY), 12);
});

test("the whole-journal summary carries the last times, for a phone holding only the recent slice", () => {
  const records = [workout({ day: "2026-06-01", segments: [station("Sandbag carry", 60, "m", 45)] })];
  assert.deepEqual(journalSummary(records, undefined, TODAY).lastDone, done({ gators: { carry: "2026-06-01" } }));
});

test("twice a week is marked for the three lifts, the run and the rows, and no other station", () => {
  assert.deepEqual([...TWICE_WEEKLY].sort(), ["deadlift", "overhead", "row", "run", "squat"]);
  const marked = RUNNING_ORDER.flatMap((zone) => zone.steps)
    .filter((step) => TWICE_WEEKLY.includes(step.movement))
    .map((step) => step.name);
  assert.deepEqual(marked, ["Shoulder to overhead", "Back squat", "Deadlift", "Run", "Opening row", "Closing row"]);
});

test("the week is the days in the last 7 each of you did it, today included, each day once", () => {
  const records: RecordItem[] = [
    // Two sessions on one day are one day at it.
    workout({ id: "a", day: "2026-11-10", lifts: [lift("Back squat")] }),
    workout({ id: "b", day: "2026-11-10", lifts: [lift("Back squat")] }),
    workout({ id: "c", day: "2026-11-05", lifts: [lift("Back squat")] }),
    // Eight days back is outside the week.
    workout({ id: "d", day: "2026-11-04", lifts: [lift("Back squat")] }),
    workout({ id: "e", day: TODAY, segments: [station("Closing row", 40, "cal", 180)] }),
    workout({ id: "f", day: "2026-11-08", segments: [station("Opening row", 40, "cal", 180)] }),
    // Logged ahead has not happened, and Together is nobody's.
    workout({ id: "g", athlete: "hippos", day: "2026-11-12", segments: [station("Run", 5, "km", 1800)] }),
    workout({ id: "h", athlete: "team", day: TODAY, lifts: [lift("Deadlift")] }),
  ];
  const week = weekDays(records, TODAY);
  assert.deepEqual(week.gators, { squat: ["2026-11-05", "2026-11-10"], row: ["2026-11-08", TODAY] });
  assert.deepEqual(week.hippos, {});
});

const days = (over: Partial<WeekDays>): WeekDays => ({ hippos: {}, gators: {}, ...over });

test("the phone counts the week alone when it holds all of it, and with the server's days when it does not", () => {
  const phone = days({ gators: { squat: ["2026-11-07", "2026-11-10"], run: ["2026-11-09"] } });
  const whole = weekTable(phone, undefined, null, TODAY);
  assert.deepEqual(whole.gators.squat, { days: 2 });
  assert.deepEqual(whole.hippos.squat, { days: 0 });
  // A slice reaching back past the week holds it whole too.
  assert.deepEqual(weekTable(phone, undefined, "2026-11-01", TODAY).gators.run, { days: 1 });

  const journal = days({
    gators: { squat: ["2026-11-06", "2026-11-07"], run: ["2026-11-08", "2026-11-09"], deadlift: ["2026-11-10"] },
  });
  const slice = weekTable(phone, journal, "2026-11-08", TODAY);
  assert.deepEqual(slice.gators.squat, { days: 3 });
  assert.deepEqual(slice.gators.run, { days: 2 });
  // The server still has a deadlift the phone deleted and has not sent yet.
  assert.deepEqual(slice.gators.deadlift, { days: 0 });

  const unknown = weekTable(phone, undefined, "2026-11-08", TODAY);
  assert.deepEqual(unknown.gators.squat, { days: 2, atLeast: true });
  assert.equal(weekLabel(unknown.gators.squat), "2×+");
  assert.equal(weekSpoken(unknown.gators.squat), "Done on at least 2 of the last 7 days");
  assert.equal(weekLabel(whole.gators.run), "1×");
  assert.equal(weekSpoken(whole.gators.run), "Done on 1 of the last 7 days");
  assert.equal(weekSpoken(whole.hippos.run), "Not done in the last 7 days");
});

test("the whole-journal summary carries the week, for a phone holding only the recent slice", () => {
  const records = [workout({ day: "2026-11-06", lifts: [lift("Deadlift")] })];
  assert.deepEqual(journalSummary(records, undefined, TODAY).weekDays, days({ gators: { deadlift: ["2026-11-06"] } }));
});
