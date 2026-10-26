import { test } from "node:test";
import assert from "node:assert/strict";
import { TARGET_HISTORY_LIMIT, averageTargets, recordTargetChange, targetsOn } from "./targets.ts";

const a = { calories: 1800, protein: 120, carbs: 180, fat: 60 };
const b = { calories: 2000, protein: 140, carbs: 200, fat: 70 };
const c = { calories: 2200, protein: 160, carbs: 220, fat: 80 };

test("changed targets keep the old ones as the target up to yesterday", () => {
  assert.deepEqual(recordTargetChange([], a, b, "2026-03-01"), [{ until: "2026-02-28", macros: a }]);
  // Unchanged is no change.
  assert.deepEqual(recordTargetChange([], a, { ...a }, "2026-03-01"), []);
});

test("a second change on the same day keeps only the targets from before today", () => {
  const once = recordTargetChange([], a, b, "2026-03-01");
  const twice = recordTargetChange(once, b, c, "2026-03-01");
  assert.deepEqual(twice, [{ until: "2026-02-28", macros: a }]);
  const settings = { targets: { hippos: c, gators: c }, targetHistory: { hippos: twice, gators: [] } };
  assert.equal(targetsOn(settings, "hippos", "2026-02-28").calories, 1800);
  assert.equal(targetsOn(settings, "hippos", "2026-03-01").calories, 2200);
});

test("each day takes the targets in force on it, and older settings have one set for every day", () => {
  const history = [
    { until: "2026-01-31", macros: a },
    { until: "2026-02-28", macros: b },
  ];
  const settings = { targets: { hippos: c, gators: c }, targetHistory: { hippos: history, gators: [] } };
  assert.equal(targetsOn(settings, "hippos", "2025-12-25").calories, 1800);
  assert.equal(targetsOn(settings, "hippos", "2026-01-31").calories, 1800);
  assert.equal(targetsOn(settings, "hippos", "2026-02-01").calories, 2000);
  assert.equal(targetsOn(settings, "hippos", "2026-03-01").calories, 2200);
  assert.equal(targetsOn(settings, "gators", "2025-12-25").calories, 2200);
  assert.equal(targetsOn({ targets: { hippos: c, gators: c } }, "hippos", "2020-01-01").calories, 2200);
  assert.equal(averageTargets(settings, "hippos", ["2026-01-31", "2026-03-01"]).calories, 2000);
  assert.deepEqual(averageTargets(settings, "hippos", []), c);
});

test("the history stays within its cap, dropping the oldest", () => {
  let history: ReturnType<typeof recordTargetChange> = [];
  let day = "2026-01-01";
  for (let i = 0; i < TARGET_HISTORY_LIMIT + 5; i++) {
    const next = new Date(`${day}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 2);
    day = next.toISOString().slice(0, 10);
    history = recordTargetChange(history, { ...a, calories: i }, { ...a, calories: i + 1 }, day);
  }
  assert.equal(history.length, TARGET_HISTORY_LIMIT);
  assert.equal(history[0].macros.calories, 5);
});
