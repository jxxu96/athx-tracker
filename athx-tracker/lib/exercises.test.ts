import { test } from "node:test";
import assert from "node:assert/strict";
import { EXERCISES, STATIONS, stationUnit } from "./exercises.ts";
import { METCON } from "./domain.ts";

test("a station is picked from the ATHX stations alone, never the lifts", () => {
  const stations = STATIONS.flatMap((group) => group.items);
  // Every circuit station by the circuit's own name, and the plain row.
  for (const station of METCON) assert.ok(stations.includes(station.name), station.name);
  assert.ok(stations.includes("Row"));
  const rest = EXERCISES.filter((group) => !STATIONS.includes(group)).flatMap((group) => group.items);
  for (const name of rest) assert.ok(!stations.includes(name), `${name} is not a station`);
  // The stations stay on the lift list too, so either reads the same in the log.
  for (const name of stations) assert.ok(EXERCISES.some((group) => group.items.includes(name)), name);
});

test("a chosen station starts at its own unit, calories for every row", () => {
  assert.equal(stationUnit("Opening row"), "cal");
  assert.equal(stationUnit("Closing row"), "cal");
  assert.equal(stationUnit("Row"), "cal");
  assert.equal(stationUnit("Sandbag carry"), "m");
  for (const name of ["DB ground to overhead", "DB bench press", "Sandbag squats", "Burpees over bench"])
    assert.equal(stationUnit(name), "reps", name);
  // Anything typed under Other, or nothing chosen yet, counts reps.
  assert.equal(stationUnit("Wall balls"), "reps");
  assert.equal(stationUnit(""), "reps");
});
