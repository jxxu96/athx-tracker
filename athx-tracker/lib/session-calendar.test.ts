import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bodyweight, Meal, Workout } from "./domain.ts";
import {
  dayAthletes,
  heldFrom,
  monthRange,
  monthWeeks,
  needsFetch,
  rangeCounts,
  sessionsByDay,
  shiftMonth,
  stripDays,
} from "./session-calendar.ts";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w", kind: "workout", athlete: "hippos", day: "2026-10-28", title: "Training", category: "Strength", customCategory: "",
  seconds: 0, notes: "", segments: [], fatigue: 10, transition: 0, goal: null, context: "solo", lifts: [], ...over,
});
const meal = (over: Partial<Meal> = {}): Meal => ({
  id: "m", kind: "meal", athlete: "hippos", day: "2026-10-28", name: "Lunch", meal: "Lunch",
  macros: { calories: 600, protein: 40, carbs: 60, fat: 20 }, source: "manual", assumptions: "", ...over,
});
const weighIn = (day: string): Bodyweight => ({ id: "b", kind: "bodyweight", athlete: "gators", day, kg: 80 });

test("the strip is the seven days up to its last, across a month's end", () => {
  assert.deepEqual(stripDays("2026-11-02"), [
    "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02",
  ]);
});

test("a month runs from its first to its last day, February and leap years included", () => {
  assert.deepEqual(monthRange("2026-10"), { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(monthRange("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
  assert.deepEqual(monthRange("2028-02"), { start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(monthRange("2026-12"), { start: "2026-12-01", end: "2026-12-31" });
});

test("months shift across years both ways", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2027-01", -1), "2026-12");
  assert.equal(shiftMonth("2026-10", -13), "2025-09");
});

test("a month's grid starts on a Monday and leaves other months' days empty", () => {
  // 1 October 2026 is a Thursday; the 31st a Saturday.
  const weeks = monthWeeks("2026-10");
  assert.equal(weeks.length, 5);
  assert.deepEqual(weeks[0], [null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(weeks[4], ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", null]);
  // February 2027 starts on a Monday and has four whole weeks.
  assert.equal(monthWeeks("2027-02").length, 4);
  assert.ok(monthWeeks("2027-02").every((week) => week.every(Boolean)));
});

test("sessions group by day inside the range, keeping the order they came in, and nothing else counts", () => {
  const days = sessionsByDay([
    workout({ id: "late", day: "2026-10-28", time: "18:00" }),
    workout({ id: "early", day: "2026-10-28", time: "07:00" }),
    meal({ day: "2026-10-27" }),
    weighIn("2026-10-27"),
    workout({ id: "start", day: "2026-10-22" }),
    workout({ id: "before", day: "2026-10-21" }),
    workout({ id: "after", day: "2026-10-29" }),
  ], "2026-10-22", "2026-10-28");
  assert.deepEqual([...days.keys()], ["2026-10-28", "2026-10-22"]);
  assert.deepEqual(days.get("2026-10-28")?.map((session) => session.id), ["late", "early"]);
});

test("a day's dots read Hippos, Gators, Together whatever order they were logged in", () => {
  assert.deepEqual(
    dayAthletes([workout({ athlete: "team" }), workout({ athlete: "gators" }), workout({ athlete: "hippos" }), workout({ athlete: "gators" })]),
    ["hippos", "gators", "gators", "team"],
  );
});

test("a range counts its sessions and the days that had any", () => {
  const days = sessionsByDay([
    workout({ athlete: "hippos" }), workout({ athlete: "team" }),
    workout({ athlete: "gators", day: "2026-10-27" }), workout({ athlete: "gators", day: "2026-10-27" }),
  ], "2026-10-22", "2026-10-28");
  assert.deepEqual(rangeCounts(days), { total: 4, days: 2 });
});

test("the slice is held whole after its oldest entry's day, which weigh-ins do not move", () => {
  const slice = [workout({ day: "2026-10-28" }), meal({ day: "2026-09-20" }), weighIn("2025-01-01")];
  assert.equal(heldFrom(slice, false), "2026-09-20");
  assert.equal(heldFrom(slice, true), null);
  // The cut can fall partway through its oldest day, so that day is asked for too.
  assert.equal(needsFetch("2026-09-20", "2026-09-20"), true);
  assert.equal(needsFetch("2026-09-20", "2026-09-14"), true);
  assert.equal(needsFetch("2026-09-20", "2026-09-21"), false);
  assert.equal(needsFetch(null, "2020-01-01"), false);
});
