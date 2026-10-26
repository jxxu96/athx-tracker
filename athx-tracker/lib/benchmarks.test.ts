import { test } from "node:test";
import assert from "node:assert/strict";
import { METCON, type Segment, type Workout } from "./domain.ts";
import { benchmarkImprovements, benchmarkSeries, bestAttempt } from "./benchmarks.ts";

const today = "2026-10-26";
const circuit = (over: Partial<Workout> = {}): Workout => ({
  id: "old", kind: "workout", athlete: "hippos", day: "2026-10-19", title: "ATHX",
  category: "MetCon", customCategory: "", seconds: 1000, notes: "", lifts: [],
  fatigue: 10, transition: 0, goal: null, context: "pairs",
  segments: METCON.map((station) => ({
    name: station.name, unit: station.unit, target: station.target, completed: station.target,
    seconds: 100, block: "metcon", ...(station.kg ? { kg: station.kg.hippos } : {}),
  })), ...over,
});
const circuits = (records: Workout[]) => benchmarkSeries(records, "hippos", today).filter((series) => series.kind === "circuit");

test("circuit best, latest and previous use actual elapsed time independent of input order", () => {
  const records = [circuit(), circuit({ id: "new", day: today, seconds: 900 }), circuit({ id: "middle", day: "2026-10-22", seconds: 850 })];
  const [series] = circuits(records);
  assert.equal(circuits(records).length, 1);
  assert.deepEqual(series.attempts.map((attempt) => attempt.seconds), [900, 850, 1000]);
  assert.equal(bestAttempt(series)?.id, "middle");
});

test("different work, loads, unknown loads and solo/pairs cannot set each other's best", () => {
  const loaded = circuit();
  const variants = [
    loaded,
    circuit({ context: "solo" }),
    circuit({ segments: loaded.segments.map((s, i) => i === 1 ? { ...s, kg: 10 } : s) }),
    circuit({ segments: loaded.segments.map((s) => ({ ...s, kg: undefined })) }),
    circuit({ segments: loaded.segments.map((s, i) => i === 0 ? { ...s, completed: 30, target: 30 } : s) }),
  ];
  assert.equal(circuits(variants).length, variants.length);
});

test("completed, capped and unfinished circuits stay separate; caps compare only equal durations", () => {
  const full = circuit();
  const partial = full.segments.map((s, i) => i === 6 ? { ...s, completed: 0, seconds: 0 } : s);
  const records = [full, circuit({ capHit: true, segments: partial, seconds: 1500 }), circuit({ segments: partial, seconds: 1500 }), circuit({ capHit: true, segments: partial, seconds: 1200 })];
  assert.equal(circuits(records).length, 4);
  assert.deepEqual(circuits(records).map((s) => s.status).sort(), ["capped", "capped", "complete", "partial"]);
  const capped = circuits([
    circuit({ capHit: true, segments: partial, seconds: 1500 }),
    circuit({ id: "further", day: today, capHit: true, seconds: 1500, segments: full.segments.map((s, i) => i === 6 ? { ...s, completed: 20 } : s) }),
  ])[0];
  assert.equal(bestAttempt(capped)?.id, "further");
  assert.ok(bestAttempt(capped)!.work < 1);
});

test("mixed clocks, extra lifts, incorrect order, untimed and impossible clocks do not become circuit times", () => {
  const base = circuit();
  const records = [
    circuit({ category: "Mixed" }), circuit({ seconds: 0 }), circuit({ seconds: 100 }),
    circuit({ segments: [...base.segments].reverse() }),
    circuit({ lifts: [{ name: "Deadlift", kg: 100, reps: 3, sets: 1 }] }),
  ];
  assert.equal(circuits(records).length, 0);
  assert.ok(benchmarkSeries(records, "hippos", today).some((s) => s.kind === "station"));
});

test("station comparisons match work and load, including convertible distance units and aliases", () => {
  const station: Segment = { name: "Sandbag carry", completed: 60, target: 60, unit: "m", kg: 20, seconds: 90, block: "metcon" };
  const records = [
    circuit({ category: "Mixed", segments: [station] }),
    circuit({ id: "new", day: today, category: "Mixed", segments: [{ ...station, name: "sandbag carry", unit: "km", completed: 0.06, target: 0.06, seconds: 72 }] }),
    circuit({ category: "Mixed", segments: [{ ...station, kg: undefined }] }),
    circuit({ category: "Mixed", segments: [{ ...station, target: 30, completed: 30 }] }),
  ];
  const groups = benchmarkSeries(records, "hippos", today);
  assert.equal(groups.length, 3);
  const group = groups.find((s) => s.attempts.length === 2)!;
  assert.equal(bestAttempt(group)?.seconds, 72);
  assert.equal(group.work[0].unit, "m");
});

test("future workouts and other athletes are excluded and a tied best keeps its first date", () => {
  const records = [circuit({ day: today }), circuit(), circuit({ athlete: "gators", seconds: 800 }), circuit({ day: "2026-10-27", seconds: 750 })];
  const [series] = circuits(records);
  assert.equal(series.attempts.length, 2);
  assert.equal(bestAttempt(series)?.day, "2026-10-19");
});

test("a partial station compares actual time at identical completed work, separately from full work", () => {
  const station = circuit().segments[1];
  const records = [
    circuit({ segments: [{ ...station, completed: 15, seconds: 90 }] }),
    circuit({ day: today, segments: [{ ...station, completed: 15, seconds: 80 }] }),
    circuit({ segments: [{ ...station, seconds: 80 }] }),
  ];
  const groups = benchmarkSeries(records, "hippos", today);
  assert.equal(groups.length, 2);
  const partial = groups.find((group) => group.status === "partial")!;
  assert.equal(partial.attempts.length, 2);
  assert.equal(bestAttempt(partial)?.seconds, 80);
});

test("weekly improvements require a matching earlier best and ignore other configurations", () => {
  const records = [circuit(), circuit({ day: "2026-10-25", seconds: 900 }), circuit({ id: "new", day: today, seconds: 850 }), circuit({ day: today, context: "solo", seconds: 750 })];
  const improvements = benchmarkImprovements(records, "hippos", today, today);
  assert.equal(improvements.length, 1);
  assert.equal(improvements[0].saved, 50);
  assert.equal(improvements[0].series.kind, "circuit");
});
