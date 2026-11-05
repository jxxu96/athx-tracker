import { test } from "node:test";
import assert from "node:assert/strict";
import type { EnergyCheckIn, RecordItem } from "./domain.ts";
import { averageEnergy, energyDays, energyOn, formatEnergy, sameCheckInDay } from "./energy-level.ts";

const checkIn = (day: string, level: number, over: Partial<EnergyCheckIn> = {}): EnergyCheckIn => ({
  id: `${day}-${level}`, kind: "energy", athlete: "hippos", day, level, ...over,
});

test("a day's energy is its check-in for that athlete", () => {
  const records: RecordItem[] = [
    checkIn("2026-11-05", 7, { time: "07:45" }),
    checkIn("2026-11-05", 4, { athlete: "gators" }),
    { id: "w", kind: "bodyweight", athlete: "hippos", day: "2026-11-05", kg: 60 },
  ];
  assert.equal(energyOn(records, "hippos", "2026-11-05")?.level, 7);
  assert.equal(energyOn(records, "gators", "2026-11-05")?.level, 4);
  assert.equal(energyOn(records, "hippos", "2026-11-04"), null);
});

test("two on one day: the later clock stands, and an untimed one counts as earlier", () => {
  const records = [
    checkIn("2026-11-05", 3, { id: "a", time: "06:00" }),
    checkIn("2026-11-05", 8, { id: "b", time: "18:30" }),
    checkIn("2026-11-05", 5, { id: "c" }),
  ];
  assert.equal(energyOn(records, "hippos", "2026-11-05")?.id, "b");
  // At the same time, the first in the list: the server sends the newest first.
  assert.equal(energyOn([checkIn("2026-11-05", 2, { id: "new" }), checkIn("2026-11-05", 9, { id: "old" })], "hippos", "2026-11-05")?.id, "new");
});

test("a range lists every day, oldest first, with a gap where nothing was logged", () => {
  const records = [checkIn("2026-11-05", 7), checkIn("2026-11-03", 5), checkIn("2026-10-30", 9)];
  assert.deepEqual(energyDays(records, "hippos", "2026-11-03", "2026-11-05"), [
    { day: "2026-11-03", level: 5 },
    { day: "2026-11-04", level: null },
    { day: "2026-11-05", level: 7 },
  ]);
  // Across a month end.
  assert.equal(energyDays(records, "hippos", "2026-10-30", "2026-11-05").length, 7);
});

test("the average leaves out days without a check-in, rather than reading them as zero", () => {
  const records = [checkIn("2026-11-05", 7), checkIn("2026-11-03", 6), checkIn("2026-10-01", 1)];
  assert.deepEqual(averageEnergy(records, "hippos", "2026-10-30", "2026-11-05"), { average: 6.5, days: 2 });
  assert.deepEqual(averageEnergy(records, "gators", "2026-10-30", "2026-11-05"), { average: null, days: 0 });
});

test("a check-in replaces only another for the same athlete and day", () => {
  const today = checkIn("2026-11-05", 7, { id: "a" });
  assert.equal(sameCheckInDay(today, checkIn("2026-11-05", 4, { id: "b" })), true);
  assert.equal(sameCheckInDay(today, checkIn("2026-11-05", 4, { id: "b", athlete: "gators" })), false);
  assert.equal(sameCheckInDay(today, checkIn("2026-11-04", 4, { id: "b" })), false);
  assert.equal(sameCheckInDay(today, { id: "w", kind: "bodyweight", athlete: "hippos", day: "2026-11-05", kg: 60 }), false);
});

test("energy shows to one decimal, without a trailing zero", () => {
  assert.equal(formatEnergy(6.5), "6.5");
  assert.equal(formatEnergy(7), "7");
  assert.equal(formatEnergy(20 / 3), "6.7");
});
