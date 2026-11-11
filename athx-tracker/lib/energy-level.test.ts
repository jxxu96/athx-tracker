import { test } from "node:test";
import assert from "node:assert/strict";
import type { EnergyCheckIn, RecordItem } from "./domain.ts";
import {
  averageEnergy,
  checkInsAt,
  energyAt,
  energyDays,
  energyOnDay,
  formatEnergy,
  timingAt,
  timingOf,
  windowsOn,
} from "./energy-level.ts";

let next = 0;
const checkIn = (day: string, level: number, over: Partial<EnergyCheckIn> = {}): EnergyCheckIn => ({
  id: `${day}-${level}-${next++}`, kind: "energy", athlete: "hippos", day, timing: "Breakfast", level, ...over,
});

test("a window keeps every check-in logged in it, oldest first, for that athlete and day only", () => {
  const records: RecordItem[] = [
    checkIn("2026-11-05", 6, { id: "late", timing: "Lunch", time: "13:40" }),
    checkIn("2026-11-05", 8, { id: "early", timing: "Lunch", time: "12:05" }),
    checkIn("2026-11-05", 7, { id: "untimed", timing: "Lunch" }),
    checkIn("2026-11-05", 4, { athlete: "gators", timing: "Lunch" }),
    checkIn("2026-11-04", 2, { timing: "Lunch" }),
    { id: "w", kind: "bodyweight", athlete: "hippos", day: "2026-11-05", kg: 60 },
  ];
  assert.deepEqual(checkInsAt(records, "hippos", "2026-11-05", "Lunch").map(({ id }) => id), ["untimed", "early", "late"]);
  assert.equal(energyAt(records, "hippos", "2026-11-05", "Lunch"), 7);
  assert.equal(energyAt(records, "hippos", "2026-11-05", "Dinner"), null);
});

test("a day lists its windows breakfast first, each with its own mean", () => {
  const records = [
    checkIn("2026-11-05", 5, { timing: "Dinner" }),
    checkIn("2026-11-05", 6, { timing: "Lunch" }),
    checkIn("2026-11-05", 9, { timing: "Lunch" }),
    checkIn("2026-11-05", 8),
  ];
  assert.deepEqual(
    windowsOn(records, "hippos", "2026-11-05").map(({ timing, checkIns, level }) => [timing, checkIns.length, level]),
    [["Breakfast", 1, 8], ["Lunch", 2, 7.5], ["Dinner", 1, 5]],
  );
});

test("a check-in from before timings is read by its time of day, and untimed ones are a window of their own", () => {
  assert.equal(timingAt("07:45"), "Breakfast");
  assert.equal(timingAt("15:30"), "Lunch");
  assert.equal(timingAt("23:10"), "Dinner");
  assert.equal(timingAt("noon"), null);
  const old = checkIn("2026-11-05", 6, { timing: undefined, time: "12:30" });
  const untimed = checkIn("2026-11-05", 3, { timing: undefined });
  assert.equal(timingOf(old), "Lunch");
  assert.equal(timingOf(untimed), null);
  // What it was saved with wins over its clock: lunch logged late is still lunch.
  assert.equal(timingOf(checkIn("2026-11-05", 6, { timing: "Lunch", time: "20:00" })), "Lunch");
  const records = [old, untimed, checkIn("2026-11-05", 8)];
  assert.equal(energyAt(records, "hippos", "2026-11-05", "Lunch"), 6);
  assert.deepEqual(windowsOn(records, "hippos", "2026-11-05").map(({ timing }) => timing), ["Breakfast", "Lunch", null]);
});

test("a day's level weighs each window the same, however many check-ins it has", () => {
  // Seven at lunch, one at breakfast and one at dinner.
  const records = [
    checkIn("2026-11-05", 3),
    ...[7, 8, 9, 7, 8, 9, 8].map((level) => checkIn("2026-11-05", level, { timing: "Lunch" })),
    checkIn("2026-11-05", 4, { timing: "Dinner" }),
  ];
  assert.equal(energyOnDay(records, "hippos", "2026-11-05"), (3 + 8 + 4) / 3);
  // Only the windows that have one count.
  assert.equal(energyOnDay([checkIn("2026-11-05", 6), checkIn("2026-11-05", 9, { timing: "Dinner" })], "hippos", "2026-11-05"), 7.5);
  assert.equal(energyOnDay(records, "hippos", "2026-11-04"), null);
});

test("a range lists every day, oldest first, with a gap where nothing was logged", () => {
  const records = [
    checkIn("2026-11-05", 7),
    checkIn("2026-11-05", 6, { timing: "Dinner" }),
    checkIn("2026-11-03", 5),
    checkIn("2026-10-30", 9),
  ];
  assert.deepEqual(energyDays(records, "hippos", "2026-11-03", "2026-11-05"), [
    { day: "2026-11-03", level: 5 },
    { day: "2026-11-04", level: null },
    { day: "2026-11-05", level: 6.5 },
  ]);
  // Across a month end.
  assert.equal(energyDays(records, "hippos", "2026-10-30", "2026-11-05").length, 7);
});

test("the average is over days, leaving out days without a check-in rather than reading them as zero", () => {
  const records = [checkIn("2026-11-05", 7), checkIn("2026-11-03", 6), checkIn("2026-10-01", 1)];
  assert.deepEqual(averageEnergy(records, "hippos", "2026-10-30", "2026-11-05"), { average: 6.5, days: 2 });
  assert.deepEqual(averageEnergy(records, "gators", "2026-10-30", "2026-11-05"), { average: null, days: 0 });
  // A day logged often counts once, at its own level: (6 + 9) / 2.
  const many = [
    checkIn("2026-11-05", 4),
    checkIn("2026-11-05", 4),
    checkIn("2026-11-05", 5, { timing: "Lunch" }),
    checkIn("2026-11-05", 9, { timing: "Dinner" }),
    checkIn("2026-11-04", 9),
  ];
  assert.deepEqual(averageEnergy(many, "hippos", "2026-11-04", "2026-11-05"), { average: 7.5, days: 2 });
});

test("energy shows to one decimal, without a trailing zero", () => {
  assert.equal(formatEnergy(6.5), "6.5");
  assert.equal(formatEnergy(7), "7");
  assert.equal(formatEnergy(20 / 3), "6.7");
});
