import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, dayToDate, weekStart } from "./client.ts";
import { DEFAULT_SETTINGS, type Meal, type Settings } from "./domain.ts";
import {
  isBagelWeekday,
  missedProteinLastWeek,
  previousWeek,
  wearsProteinBagel,
} from "./protein-week.ts";

const meal = (over: Partial<Meal> = {}): Meal => ({
  id: "m",
  kind: "meal",
  athlete: "hippos",
  day: "2026-10-19",
  name: "Lunch",
  meal: "Lunch",
  source: "manual",
  assumptions: "",
  macros: { calories: 500, protein: 40, carbs: 40, fat: 10 },
  ...over,
});

function withProtein(hippos: number, gators = hippos): Settings {
  return {
    ...DEFAULT_SETTINGS,
    targets: {
      hippos: { calories: 2000, protein: hippos, carbs: 200, fat: 70 },
      gators: { calories: 2200, protein: gators, carbs: 220, fat: 80 },
    },
  };
}

/** One meal on each day of the previous week, at one protein amount. */
function weekOf(today: string, protein: number, athlete: Meal["athlete"] = "hippos") {
  const week = previousWeek(today);
  return Array.from({ length: 7 }, (_, index) =>
    meal({
      id: `${athlete}-${index}`,
      athlete,
      day: addDays(week.start, index),
      macros: { calories: 500, protein, carbs: 40, fat: 10 },
    }),
  );
}

test("the previous week is the Monday to Sunday before this one", () => {
  const today = "2026-10-28";
  const week = previousWeek(today);
  assert.equal(week.start, addDays(weekStart(today), -7));
  assert.equal(week.end, addDays(week.start, 6));
  assert.equal(dayToDate(week.start).getUTCDay(), 1);
  assert.equal(dayToDate(week.end).getUTCDay(), 0);
  assert.equal(week.start < weekStart(today), true);
  assert.equal(week.end < weekStart(today), true);
});

test("the bagel is a Monday to Wednesday thing", () => {
  const monday = weekStart("2026-10-28");
  for (let i = 0; i < 3; i += 1) assert.equal(isBagelWeekday(addDays(monday, i)), true);
  for (let i = 3; i < 7; i += 1) assert.equal(isBagelWeekday(addDays(monday, i)), false);
});

test("a short protein week is a miss, and the bagel only stays on through Wednesday", () => {
  const today = "2026-10-28";
  const short = weekOf(today, 50);
  const settings = withProtein(100);
  assert.equal(missedProteinLastWeek(short, settings, "hippos", today), true);
  const monday = weekStart(today);
  assert.equal(wearsProteinBagel(short, settings, "hippos", monday), true);
  assert.equal(wearsProteinBagel(short, settings, "hippos", addDays(monday, 2)), true);
  assert.equal(wearsProteinBagel(short, settings, "hippos", addDays(monday, 3)), false);
  assert.equal(wearsProteinBagel(short, settings, "hippos", addDays(monday, 6)), false);
});

test("meeting the target, or having none, wears no bagel", () => {
  const today = "2026-10-28";
  const settings = withProtein(100);
  const hit = weekOf(today, 100);
  assert.equal(missedProteinLastWeek(hit, settings, "hippos", today), false);
  assert.equal(wearsProteinBagel(hit, settings, "hippos", today), false);
  // 90% of 700 g is 630 g. 90 g a day meets it and 89 g a day does not.
  assert.equal(missedProteinLastWeek(weekOf(today, 90), settings, "hippos", today), false);
  assert.equal(missedProteinLastWeek(weekOf(today, 89), settings, "hippos", today), true);
  assert.equal(missedProteinLastWeek(weekOf(today, 20), withProtein(0), "hippos", today), false);
  assert.equal(wearsProteinBagel(weekOf(today, 20), withProtein(0), "hippos", today), false);
});

test("queued meals and meals outside last week do not count", () => {
  const today = "2026-10-28";
  const settings = withProtein(100, 160);
  const week = previousWeek(today);
  const hippos = [
    ...weekOf(today, 100),
    meal({
      day: week.start,
      source: "queued",
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    }),
    meal({ day: addDays(week.start, -1), macros: { calories: 0, protein: 0, carbs: 0, fat: 0 } }),
    meal({ day: addDays(week.end, 1), macros: { calories: 0, protein: 0, carbs: 0, fat: 0 } }),
  ];
  assert.equal(missedProteinLastWeek(hippos, settings, "hippos", today), false);

  const gators = weekOf(today, 100, "gators").map((entry, index) =>
    index === 0 ? { ...entry, athlete: "hippos" as const } : entry,
  );
  // Monday has no Gators meal, so that day is out. Six days at 100 g against 160 g is under 90%.
  assert.equal(missedProteinLastWeek(gators, settings, "gators", today), true);
  // Hippos logged only Monday, at 100 g against a 100 g target, so that day is met.
  assert.equal(missedProteinLastWeek(gators, settings, "hippos", today), false);
});

test("a blank day is left out, and 90% of the logged days is enough", () => {
  const today = "2026-10-28";
  const settings = withProtein(100);
  const week = previousWeek(today);
  const logged = weekOf(today, 90).filter((entry) => entry.day !== week.start);
  // Six days at 90 g is exactly 90% of those days. Monday was blank.
  assert.equal(missedProteinLastWeek(logged, settings, "hippos", today), false);
  const short = logged.map((entry) =>
    entry.day === addDays(week.start, 1)
      ? { ...entry, macros: { ...entry.macros, protein: 84 } }
      : entry,
  );
  // 84 g plus five days at 90 g is 534 g against 600 g.
  assert.equal(missedProteinLastWeek(short, settings, "hippos", today), true);
  assert.equal(missedProteinLastWeek([], settings, "hippos", today), false);
  assert.equal(missedProteinLastWeek([
    meal({
      day: week.start,
      source: "queued",
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    }),
  ], settings, "hippos", today), false);
});

test("each day of last week keeps the protein target that was in force then", () => {
  const today = "2026-10-28";
  const week = previousWeek(today);
  const settings: Settings = {
    ...withProtein(100),
    targetHistory: {
      hippos: [
        {
          until: addDays(week.start, 2),
          macros: { calories: 2000, protein: 200, carbs: 200, fat: 70 },
        },
      ],
      gators: [],
    },
  };
  // Three days at 200 g and four at 100 g is 1000 g. Eating 100 g a day misses it.
  assert.equal(missedProteinLastWeek(weekOf(today, 100), settings, "hippos", today), true);
  // 90% of 1000 g is 900 g. 129 g a day clears it and 128 g a day does not.
  assert.equal(missedProteinLastWeek(weekOf(today, 129), settings, "hippos", today), false);
  assert.equal(missedProteinLastWeek(weekOf(today, 128), settings, "hippos", today), true);
});
