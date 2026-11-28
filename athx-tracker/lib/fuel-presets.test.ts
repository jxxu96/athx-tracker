import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, FUEL_PRESETS, fuelPresetWindow } from "./fuel-presets.ts";

test("addMonths keeps the date, or falls back to the month's last day", () => {
  assert.equal(addMonths("2026-11-19", -1), "2026-10-19");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2028-03-31", -1), "2028-02-29");
  assert.equal(addMonths("2026-05-31", -3), "2026-02-28");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
  assert.equal(addMonths("2028-02-29", -12), "2027-02-28");
});

test("presets cover complete days, ending yesterday", () => {
  const today = "2026-11-19";
  const windows = Object.fromEntries(
    FUEL_PRESETS.map(({ id }) => [id, fuelPresetWindow(id, today)]),
  );
  assert.deepEqual(windows, {
    mtd: { start: "2026-11-01", end: "2026-11-18" },
    "1m": { start: "2026-10-19", end: "2026-11-18" },
    "1q": { start: "2026-08-19", end: "2026-11-18" },
    "6m": { start: "2026-05-19", end: "2026-11-18" },
    ytd: { start: "2026-01-01", end: "2026-11-18" },
    "1y": { start: "2025-11-19", end: "2026-11-18" },
  });
});

test("month and year to date have no window on their first day", () => {
  assert.equal(fuelPresetWindow("mtd", "2026-11-01"), null);
  assert.deepEqual(fuelPresetWindow("mtd", "2026-11-02"), { start: "2026-11-01", end: "2026-11-01" });
  assert.equal(fuelPresetWindow("ytd", "2027-01-01"), null);
  assert.deepEqual(fuelPresetWindow("1m", "2027-01-01"), { start: "2026-12-01", end: "2026-12-31" });
});
