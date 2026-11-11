import { test } from "node:test";
import assert from "node:assert/strict";
import type { EnergyCheckIn, RecordItem } from "./domain.ts";
import {
  averageEnergy,
  energyAt,
  energyDays,
  energyOn,
  energyOnDay,
  formatEnergy,
  sameCheckInSlot,
  timingAt,
  timingOf,
} from "./energy-level.ts";

const checkIn = (day: string, level: number, over: Partial<EnergyCheckIn> = {}): EnergyCheckIn => ({
  id: `${day}-${level}`, kind: "energy", athlete: "hippos", day, timing: "Breakfast", level, ...over,
});

test("a timing's energy is its check-in for that athlete, day and timing", () => {
  const records: RecordItem[] = [
    checkIn("2026-11-05", 7, { time: "07:45" }),
    checkIn("2026-11-05", 5, { timing: "Dinner", time: "19:10" }),
    checkIn("2026-11-05", 4, { athlete: "gators" }),
    { id: "w", kind: "bodyweight", athlete: "hippos", day: "2026-11-05", kg: 60 },
  ];
  assert.equal(energyAt(records, "hippos", "2026-11-05", "Breakfast")?.level, 7);
  assert.equal(energyAt(records, "hippos", "2026-11-05", "Dinner")?.level, 5);
  assert.equal(energyAt(records, "hippos", "2026-11-05", "Lunch"), null);
  assert.equal(energyAt(records, "gators", "2026-11-05", "Breakfast")?.level, 4);
  assert.equal(energyAt(records, "hippos", "2026-11-04", "Breakfast"), null);
});

test("a day lists one check-in a timing, breakfast first, whatever order they came in", () => {
  const records = [
    checkIn("2026-11-05", 5, { id: "d", timing: "Dinner" }),
    checkIn("2026-11-05", 6, { id: "l", timing: "Lunch" }),
    checkIn("2026-11-05", 8, { id: "b", timing: "Breakfast" }),
  ];
  assert.deepEqual(energyOn(records, "hippos", "2026-11-05").map(({ id }) => id), ["b", "l", "d"]);
});

test("a check-in from before timings is read by its time of day, and an untimed one stands as the day's", () => {
  assert.equal(timingAt("07:45"), "Breakfast");
  assert.equal(timingAt("15:30"), "Lunch");
  assert.equal(timingAt("23:10"), "Dinner");
  assert.equal(timingAt("noon"), null);
  const old = checkIn("2026-11-05", 6, { id: "old", timing: undefined, time: "12:30" });
  const untimed = checkIn("2026-11-05", 3, { id: "untimed", timing: undefined });
  assert.equal(timingOf(old), "Lunch");
  assert.equal(timingOf(untimed), null);
  // What it was saved with wins over its clock: lunch logged late is still lunch.
  assert.equal(timingOf(checkIn("2026-11-05", 6, { timing: "Lunch", time: "20:00" })), "Lunch");
  const records = [old, untimed, checkIn("2026-11-05", 8, { id: "b" })];
  assert.equal(energyAt(records, "hippos", "2026-11-05", "Lunch")?.id, "old");
  assert.deepEqual(energyOn(records, "hippos", "2026-11-05").map(({ id }) => id), ["b", "old", "untimed"]);
});

test("two for one timing: the later clock stands, and an untimed one counts as earlier", () => {
  const records = [
    checkIn("2026-11-05", 3, { id: "a", time: "06:00" }),
    checkIn("2026-11-05", 8, { id: "b", time: "09:30" }),
    checkIn("2026-11-05", 5, { id: "c" }),
  ];
  assert.equal(energyAt(records, "hippos", "2026-11-05", "Breakfast")?.id, "b");
  assert.equal(energyOn(records, "hippos", "2026-11-05").length, 1);
  // At the same time, the first in the list: the server sends the newest first.
  assert.equal(energyAt([checkIn("2026-11-05", 2, { id: "new" }), checkIn("2026-11-05", 9, { id: "old" })], "hippos", "2026-11-05", "Breakfast")?.id, "new");
});

test("a day's level is the mean of its timings", () => {
  const records = [
    checkIn("2026-11-05", 8),
    checkIn("2026-11-05", 5, { timing: "Lunch" }),
    // Two for lunch: the later clock stands, and the other does not count as well.
    checkIn("2026-11-05", 1, { id: "later", timing: "Lunch", time: "11:00" }),
    checkIn("2026-11-05", 6, { timing: "Dinner", time: "19:00" }),
  ];
  assert.equal(energyOnDay(records, "hippos", "2026-11-05"), (8 + 1 + 6) / 3);
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
  // A day logged three times counts once, at its own mean: (6 + 9) / 2, not (4 + 5 + 9 + 9) / 4.
  const many = [
    checkIn("2026-11-05", 4),
    checkIn("2026-11-05", 5, { timing: "Lunch" }),
    checkIn("2026-11-05", 9, { timing: "Dinner" }),
    checkIn("2026-11-04", 9),
  ];
  assert.deepEqual(averageEnergy(many, "hippos", "2026-11-04", "2026-11-05"), { average: 7.5, days: 2 });
});

test("a check-in replaces only another for the same athlete, day and timing", () => {
  const breakfast = checkIn("2026-11-05", 7, { id: "a" });
  assert.equal(sameCheckInSlot(breakfast, checkIn("2026-11-05", 4, { id: "b" })), true);
  assert.equal(sameCheckInSlot(breakfast, checkIn("2026-11-05", 4, { id: "b", timing: "Lunch" })), false);
  assert.equal(sameCheckInSlot(breakfast, checkIn("2026-11-05", 4, { id: "b", athlete: "gators" })), false);
  assert.equal(sameCheckInSlot(breakfast, checkIn("2026-11-04", 4, { id: "b" })), false);
  // One from before timings, by its time of day.
  assert.equal(sameCheckInSlot(breakfast, checkIn("2026-11-05", 4, { id: "b", timing: undefined, time: "08:00" })), true);
  assert.equal(sameCheckInSlot(breakfast, checkIn("2026-11-05", 4, { id: "b", timing: undefined })), false);
  assert.equal(sameCheckInSlot(breakfast, { id: "w", kind: "bodyweight", athlete: "hippos", day: "2026-11-05", kg: 60 }), false);
});

test("energy shows to one decimal, without a trailing zero", () => {
  assert.equal(formatEnergy(6.5), "6.5");
  assert.equal(formatEnergy(7), "7");
  assert.equal(formatEnergy(20 / 3), "6.7");
});
