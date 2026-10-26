import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyweightHistory } from "./bodyweight.ts";
import type { Bodyweight, Macros, Meal, RecordItem, Workout } from "./domain.ts";
import {
  athleteFuel,
  energyBalance,
  calorieTracking,
  formatAmount,
  fuelWindow,
  gapLabel,
  targetGap,
  targetPercent,
  teamSessions,
} from "./fuel.ts";

const today = "2026-03-01";

const meal = (over: Partial<Meal> = {}): Meal => ({
  id: "m",
  kind: "meal",
  athlete: "hippos",
  day: today,
  name: "lunch",
  meal: "Lunch",
  macros: { calories: 500, protein: 30, carbs: 40, fat: 15 },
  source: "manual",
  assumptions: "",
  ...over,
});

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w",
  kind: "workout",
  athlete: "hippos",
  day: today,
  title: "t",
  category: "MetCon",
  customCategory: "",
  seconds: 1800,
  notes: "",
  segments: [],
  fatigue: 10,
  transition: 0,
  goal: null,
  context: "solo",
  lifts: [],
  ...over,
});

const target = { calories: 2000, protein: 140, carbs: 200, fat: 70 };

/** Targets and a weight in Setup, the same for both athletes, with no weigh-ins. */
const setup = (targets: Macros = target, kg = 70, records: RecordItem[] = []) =>
  [{ targets: { hippos: targets, gators: targets } }, bodyweightHistory(records, { hippos: kg, gators: kg })] as const;

const weighIn = (over: Partial<Bodyweight> = {}): Bodyweight => ({
  id: "b", kind: "bodyweight", athlete: "hippos", day: today, kg: 70, ...over,
});

test("the fuel window is today, yesterday, or the seven days ending today", () => {
  assert.deepEqual(fuelWindow("today", today), { start: today, end: today });
  assert.deepEqual(fuelWindow("yesterday", today), {
    start: "2026-02-28",
    end: "2026-02-28",
  });
  assert.deepEqual(fuelWindow("week", today), {
    start: "2026-02-23",
    end: today,
  });
  assert.equal(fuelWindow("overall", today), null);
  assert.deepEqual(fuelWindow("yesterday", "2028-03-01"), {
    start: "2028-02-29",
    end: "2028-02-29",
  });
});

test("amounts group by thousands without depending on the machine locale", () => {
  assert.equal(formatAmount(0), "0");
  assert.equal(formatAmount(1840.4), "1,840");
  assert.equal(formatAmount(86800), "86,800");
  assert.equal(formatAmount(-1200), "-1,200");
});

test("a gap inside five percent is on target, and the band scales with the target", () => {
  assert.equal(targetGap(2000, 2000)?.state, "on");
  assert.equal(targetGap(2100, 2000)?.state, "on");
  assert.deepEqual(targetGap(2101, 2000), {
    state: "over",
    delta: 101,
    amount: 101,
  });
  assert.equal(targetGap(1900, 2000)?.state, "on");
  assert.equal(targetGap(1899, 2000)?.state, "under");
  // 50 g short of a 140 g protein target is not "on target".
  assert.equal(targetGap(90, 140)?.state, "under");
  assert.equal(targetGap(500, 0), null);
  assert.equal(gapLabel(targetGap(2101, 2000), "kcal"), "101 kcal over");
  assert.equal(gapLabel(targetGap(2000, 2000), "kcal"), "on target");
  assert.equal(gapLabel(null, "kcal"), "");
});

test("a macro's share of its target is a whole percent", () => {
  assert.equal(targetPercent(500, 2000), 25);
  assert.equal(targetPercent(2000, 2000), 100);
  assert.equal(targetPercent(2500, 2000), 125);
  assert.equal(targetPercent(1, 2000), 0);
  assert.equal(targetPercent(500, 0), null);
});

test("a day shows that day's meals and not the days around it", () => {
  const records: RecordItem[] = [
    meal({ id: "a", macros: { calories: 800, protein: 40, carbs: 80, fat: 20 } }),
    meal({
      id: "b",
      day: "2026-02-28",
      macros: { calories: 9000, protein: 0, carbs: 0, fat: 0 },
    }),
  ];
  const fuel = athleteFuel(records, "hippos", "today", today, ...setup(target, 70));
  assert.equal(fuel.shown.calories, 800);
  assert.equal(fuel.daysWithMeals, 1);
  assert.equal(fuel.eaten.calories, 800);

  const yesterday = athleteFuel(records, "hippos", "yesterday", today, ...setup(target, 70));
  assert.equal(yesterday.shown.calories, 9000);
  assert.equal(yesterday.daysWithMeals, 1);
});

test("a week averages days with a meal and ignores the empty ones", () => {
  const records: RecordItem[] = [
    meal({ id: "a", day: "2026-02-23", macros: { calories: 1000, protein: 50, carbs: 100, fat: 30 } }),
    meal({ id: "b", day: "2026-02-23", macros: { calories: 1000, protein: 50, carbs: 100, fat: 30 } }),
    meal({ id: "c", day: "2026-03-01", macros: { calories: 3000, protein: 150, carbs: 300, fat: 90 } }),
    // Eighth day back, and the other athlete: neither belongs in this average.
    meal({ id: "d", day: "2026-02-22", macros: { calories: 9000, protein: 0, carbs: 0, fat: 0 } }),
    meal({
      id: "e",
      athlete: "gators",
      day: "2026-03-01",
      macros: { calories: 9000, protein: 0, carbs: 0, fat: 0 },
    }),
  ];
  const fuel = athleteFuel(records, "hippos", "week", today, ...setup(target, 70));
  assert.equal(fuel.daysWithMeals, 2);
  assert.equal(fuel.meals, 3);
  assert.equal(fuel.eaten.calories, 5000);
  assert.equal(fuel.shown.calories, 2500);
  assert.equal(fuel.shown.protein, 125);
  assert.equal(fuel.spanDays, 7);
});

test("overall keeps the whole journal, including days outside the last week", () => {
  const records: RecordItem[] = [
    meal({ id: "old", day: "2025-01-01", macros: { calories: 1800, protein: 100, carbs: 150, fat: 60 } }),
    meal({ id: "now", macros: { calories: 2200, protein: 140, carbs: 200, fat: 70 } }),
  ];
  const fuel = athleteFuel(records, "hippos", "overall", today, ...setup(target, 70));
  assert.equal(fuel.daysWithMeals, 2);
  assert.equal(fuel.eaten.calories, 4000);
  assert.equal(fuel.shown.calories, 2000);
  assert.equal(fuel.spanDays, null);
});

test("no meals is an empty day, not a day of zeros against the target", () => {
  const fuel = athleteFuel([], "gators", "today", today, ...setup(target, 80));
  assert.equal(fuel.daysWithMeals, 0);
  assert.equal(fuel.shown.calories, 0);
  assert.equal(calorieTracking("Gators", fuel, false), "Gators has no meals logged");
});

test("tracking names the calorie gap, and a longer span says it is an average", () => {
  const under = athleteFuel(
    [meal({ macros: { calories: 1500, protein: 100, carbs: 150, fat: 40 } })],
    "hippos",
    "today",
    today,
    ...setup(target, 70),
  );
  assert.equal(
    calorieTracking("Hippos", under, false),
    "Hippos is 500 kcal under target",
  );
  const on = athleteFuel(
    [meal({ macros: { calories: 2000, protein: 140, carbs: 200, fat: 70 } })],
    "hippos",
    "week",
    today,
    ...setup(target, 70),
  );
  assert.equal(calorieTracking("Hippos", on, true), "Hippos is averaging on target");
  const bare = athleteFuel(
    [meal()],
    "hippos",
    "overall",
    today,
    ...setup({ calories: 0, protein: 0, carbs: 0, fat: 0 }, 70),
  );
  assert.equal(calorieTracking("Hippos", bare, true), "Hippos has no calorie target");
});

test("expenditure sums timed sessions and withholds a burn without a bodyweight", () => {
  const records: RecordItem[] = [
    workout({ id: "a", seconds: 1800 }),
    workout({ id: "b", seconds: 0 }),
    workout({ id: "c", athlete: "gators", seconds: 1800 }),
    workout({ id: "d", athlete: "team", seconds: 1800 }),
    workout({ id: "e", day: "2026-02-01", seconds: 3600 }),
  ];
  const fuel = athleteFuel(records, "hippos", "today", today, ...setup(target, 80));
  // MetCon, 80 kg, 30 min: 336 rounded to 340. The untimed session is counted apart.
  assert.equal(fuel.burned, 340);
  assert.equal(fuel.sessions, 2);
  assert.equal(fuel.untimed, 1);
  assert.equal(fuel.burnKnown, true);
  assert.equal(teamSessions(records, "today", today), 1);

  const unknown = athleteFuel(records, "hippos", "today", today, ...setup(target, 0));
  assert.equal(unknown.burnKnown, false);
  assert.equal(unknown.burned, 0);
  assert.equal(unknown.untimed, 0);
  assert.equal(unknown.sessions, 2);

  const all = athleteFuel(records, "hippos", "overall", today, ...setup(target, 80));
  assert.ok(all.burned > fuel.burned);
});

test("a session burns at the weight of its own day, so a new weigh-in moves no earlier burn", () => {
  const sessions: RecordItem[] = [
    workout({ id: "old", day: "2026-02-01", seconds: 1800 }),
    workout({ id: "new", day: today, seconds: 1800 }),
  ];
  // 80 kg in Setup from before weigh-ins were dated, then 60 kg from the 15th.
  const records = [...sessions, weighIn({ id: "w", day: "2026-02-15", kg: 60 })];
  const [settings, history] = setup(target, 80, records);
  const old = athleteFuel(records, "hippos", "overall", today, settings, history);
  const before = athleteFuel(sessions, "hippos", "overall", today, ...setup(target, 80));
  // MetCon, 30 min: 336 kcal at 80 kg rounds to 340, 252 at 60 kg to 250.
  assert.equal(before.burned, 680);
  assert.equal(old.burned, 340 + 250);
  const day = athleteFuel(records, "hippos", "today", today, settings, history);
  assert.equal(day.burned, 250);
});

test("with no weight in Setup, a day before the first weigh-in takes that weigh-in", () => {
  const records: RecordItem[] = [
    workout({ id: "early", day: "2026-02-01", seconds: 1800 }),
    weighIn({ day: "2026-02-15", kg: 80 }),
  ];
  const fuel = athleteFuel(records, "hippos", "overall", today, ...setup(target, 0, records));
  assert.equal(fuel.burnKnown, true);
  assert.equal(fuel.burned, 340);
});

test("a past day is judged against the targets it had", () => {
  const records: RecordItem[] = [
    meal({ id: "y", day: "2026-02-28" }),
    meal({ id: "t" }),
  ];
  const earlier = { calories: 1800, protein: 120, carbs: 180, fat: 60 };
  const settings = {
    targets: { hippos: target, gators: target },
    targetHistory: { hippos: [{ until: "2026-02-28", macros: earlier }], gators: [] },
  };
  const history = bodyweightHistory([], { hippos: 70, gators: 70 });
  assert.equal(athleteFuel(records, "hippos", "yesterday", today, settings, history).dailyTarget.calories, 1800);
  assert.equal(athleteFuel(records, "hippos", "today", today, settings, history).dailyTarget.calories, 2000);
  // A week shown as a daily average is set against the average of its days' targets.
  assert.equal(athleteFuel(records, "hippos", "week", today, settings, history).dailyTarget.calories, 1900);
});

test("expenditure is resting energy and training, and waits for a height and birth year", () => {
  const records: RecordItem[] = [
    meal({ macros: { calories: 2000, protein: 140, carbs: 200, fat: 70 } }),
    workout({ id: "w", athlete: "gators", seconds: 1800 }),
    meal({ id: "g", athlete: "gators", macros: { calories: 2600, protein: 180, carbs: 300, fat: 80 } }),
  ];
  const [base, history] = setup(target, 80);
  const missing = athleteFuel(records, "gators", "today", today, base, history);
  assert.equal(missing.resting, null);
  assert.equal(missing.expenditure, null);
  assert.equal(energyBalance(missing), null);

  const settings = {
    ...base,
    height: { hippos: 165, gators: 180 },
    birthYear: { hippos: 1996, gators: 1996 },
  };
  // Mifflin-St Jeor, 80 kg, 180 cm, 30 in 2026, male: 800 + 1125 - 150 + 5.
  const gators = athleteFuel(records, "gators", "today", today, settings, history);
  assert.equal(gators.resting, 1780);
  assert.equal(gators.burned, 340);
  assert.equal(gators.expenditure, 2120);
  assert.equal(energyBalance(gators), 480);
  // The same for a woman at 80 kg and 165 cm, less the 166 between the sexes.
  const hippos = athleteFuel(records, "hippos", "today", today, settings, history);
  assert.equal(hippos.resting, 800 + 1031.25 - 150 - 161);
});

test("a longer span spreads resting and training over all its days", () => {
  const records: RecordItem[] = [
    workout({ id: "a", athlete: "gators", seconds: 1800 }),
    workout({ id: "b", athlete: "gators", day: "2026-02-24", seconds: 1800 }),
    meal({ id: "m", athlete: "gators", macros: { calories: 2800, protein: 180, carbs: 300, fat: 80 } }),
  ];
  const [base, history] = setup(target, 80);
  const settings = { ...base, height: { hippos: 0, gators: 180 }, birthYear: { hippos: 0, gators: 1996 } };
  const week = athleteFuel(records, "gators", "week", today, settings, history);
  assert.equal(week.expenditureDays, 7);
  assert.equal(week.burned, 680);
  assert.equal(week.expenditure, 1780 + 680 / 7);
  // One logged day of 2,800 against the average day's spend.
  assert.equal(energyBalance(week), 2800 - (1780 + 680 / 7));
  // The whole journal starts at the athlete's first entry, a week ago here.
  const overall = athleteFuel(records, "gators", "overall", today, settings, history);
  assert.equal(overall.expenditureDays, 6);
});
