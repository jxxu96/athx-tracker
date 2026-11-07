import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyAverage } from "./bodyweight.ts";
import { DEFAULT_SETTINGS, type Bodyweight, type Meal, type Settings, type Workout } from "./domain.ts";
import { liftProgress, weeklyBests } from "./progress.ts";
import { PROTEIN_WEEKS, proteinWeeks } from "./protein-week.ts";

const weighIn = (day: string, kg: number): Bodyweight => ({ id: day, kind: "bodyweight", athlete: "gators", day, kg });

test("a weigh-in's average is the weigh-ins of the seven days up to it, itself included", () => {
  const points = weeklyAverage([
    weighIn("2026-11-01", 84),
    weighIn("2026-11-03", 86),
    weighIn("2026-11-07", 85),
    // Eight days after the first: the first has dropped out of its week.
    weighIn("2026-11-08", 83),
  ]);
  assert.deepEqual(points.map((point) => point.average), [84, 85, 85, (86 + 85 + 83) / 3]);
  assert.deepEqual(points.map((point) => point.kg), [84, 86, 85, 83]);
  assert.deepEqual(weeklyAverage([]), []);
});

test("a lift's trend keeps each Monday week's best, on the first day it was reached", () => {
  const figure = (day: string, kg: number) => ({ day, kg, setKg: kg, reps: 1 });
  assert.deepEqual(
    weeklyBests([
      // Monday 2 November to Sunday 8 November, then the week after.
      figure("2026-11-03", 100),
      figure("2026-11-05", 105),
      figure("2026-11-07", 105),
      figure("2026-11-10", 102.5),
    ]),
    [{ day: "2026-11-05", kg: 105 }, { day: "2026-11-10", kg: 102.5 }],
  );
});

test("each followed lift carries its trend in the progress figures", () => {
  const session = (id: string, day: string, kg: number): Workout => ({
    id, kind: "workout", athlete: "gators", day, title: "Lifts", category: "Strength", customCategory: "",
    seconds: 0, notes: "", segments: [], fatigue: 10, transition: 0, goal: null, context: "solo",
    lifts: [{ name: "Back squat", kg, sets: 3, reps: 2 }],
  });
  const lifts = liftProgress(
    [session("a", "2026-10-27", 100), session("b", "2026-11-03", 110)],
    "gators",
    DEFAULT_SETTINGS.liftTargets.gators,
    "2026-11-06",
  );
  assert.deepEqual(lifts.find((lift) => lift.key === "backSquat")?.history, [
    { day: "2026-10-27", kg: 100 },
    { day: "2026-11-03", kg: 110 },
  ]);
  assert.deepEqual(lifts.find((lift) => lift.key === "deadlift")?.history, []);
});

const meal = (day: string, protein: number, over: Partial<Meal> = {}): Meal => ({
  id: `${day}-${protein}`, kind: "meal", athlete: "hippos", day, name: "Meal", meal: "Lunch",
  source: "manual", assumptions: "", macros: { calories: 500, protein, carbs: 40, fat: 10 }, ...over,
});

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  targets: {
    hippos: { calories: 2000, protein: 120, carbs: 200, fat: 70 },
    gators: { calories: 2800, protein: 180, carbs: 300, fat: 90 },
  },
};

test("protein is measured a Monday week at a time, over days with a known meal", () => {
  // Friday 6 November 2026: its week began on Monday 2 November.
  const weeks = proteinWeeks(
    [
      meal("2026-11-02", 100),
      meal("2026-11-02", 30),
      meal("2026-11-04", 90),
      // Today waits until it is over, a queued meal until it has macros, and
      // the other athlete's meals are theirs.
      meal("2026-11-06", 200),
      meal("2026-11-05", 500, { source: "queued" }),
      meal("2026-11-03", 999, { athlete: "gators" }),
      // The week before, and one too old to show.
      meal("2026-10-28", 120),
      meal("2026-09-01", 120),
    ],
    settings,
    "hippos",
    "2026-11-06",
  );
  assert.equal(weeks.length, PROTEIN_WEEKS);
  assert.equal(weeks[0].start, "2026-09-14");
  assert.deepEqual(weeks[PROTEIN_WEEKS - 1], { start: "2026-11-02", eaten: 220, target: 240, days: 2 });
  assert.deepEqual(weeks[PROTEIN_WEEKS - 2], { start: "2026-10-26", eaten: 120, target: 120, days: 1 });
  assert.equal(weeks[0].days, 0);
});

test("on a Monday the current week has no complete day yet", () => {
  const weeks = proteinWeeks([meal("2026-11-02", 150)], settings, "hippos", "2026-11-02");
  assert.equal(weeks[PROTEIN_WEEKS - 1].days, 0);
});
