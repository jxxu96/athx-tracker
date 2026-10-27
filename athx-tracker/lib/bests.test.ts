import { test } from "node:test";
import assert from "node:assert/strict";
import { bestLine, newBests } from "./bests.ts";
import type { Workout } from "./domain.ts";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "w", kind: "workout", athlete: "gators", day: "2026-09-01", title: "Lifts",
  category: "Strength", customCategory: "", seconds: 0, notes: "", segments: [],
  fatigue: 10, transition: 0, goal: null, context: "solo", lifts: [], ...over,
});
const lift = (name: string, kg: number, sets = 1, reps = 1) => ({ name, kg, sets, reps });

test("a heavier set than any other session's is a new best, whatever the spelling", () => {
  const before = [workout({ id: "a", lifts: [lift("Overhead press", 50, 3, 5)] })];
  const saved = workout({ id: "b", day: "2026-09-08", lifts: [lift("OHP", 52.5, 3, 3)] });
  assert.deepEqual(newBests(saved, before), [{
    athlete: "gators", name: "Overhead press", kind: "heaviest", kg: 52.5, reps: 3, previous: { kg: 50, reps: 5 },
  }]);
  assert.equal(bestLine(newBests(saved, before)[0], "kg"), "Overhead press 52.5 kg × 3, up from 50 kg × 5");
});

test("the same weight for more reps beats it, and its estimated max says so when the weight is lower", () => {
  const before = [workout({ id: "a", lifts: [lift("Back squat", 100, 1, 3)] })];
  const more = workout({ id: "b", lifts: [lift("Back squat", 100, 1, 5)] });
  assert.equal(newBests(more, before)[0].kind, "heaviest");
  // 95 x 8 predicts 95 x 36 / 29 = 117.9, past 100 x 3's 105.9.
  const lighter = workout({ id: "c", lifts: [lift("Back squat", 95, 1, 8)] });
  const [best] = newBests(lighter, before);
  assert.equal(best.kind, "estimated");
  assert.equal(best.kg, 95);
  assert.equal(best.reps, 8);
  assert.ok(Math.abs((best.estimate ?? 0) - 117.93) < 0.01);
  assert.equal(bestLine(best, "kg"), "Back squat 95 kg × 8: estimated max 118 kg, up from 106 kg");
});

test("a first log, a tie, another athlete's lift and the session itself beat nothing", () => {
  assert.deepEqual(newBests(workout({ lifts: [lift("Deadlift", 140, 1, 3)] }), []), []);
  const before = [workout({ id: "a", lifts: [lift("Deadlift", 140, 1, 3)] })];
  assert.deepEqual(newBests(workout({ id: "b", lifts: [lift("Deadlift", 140, 2, 3)] }), before), []);
  const hers = [workout({ id: "h", athlete: "hippos", lifts: [lift("Deadlift", 60, 1, 3)] })];
  assert.deepEqual(newBests(workout({ id: "g", lifts: [lift("Deadlift", 140, 1, 3)] }), hers), []);
  // Re-saving the session that holds the best is not a new one.
  const held = workout({ id: "x", lifts: [lift("Deadlift", 150, 1, 3)] });
  assert.deepEqual(newBests(held, [...before, held]), []);
  assert.deepEqual(newBests(workout({ athlete: "team", lifts: [lift("Deadlift", 200, 1, 3)] }), before), []);
});
