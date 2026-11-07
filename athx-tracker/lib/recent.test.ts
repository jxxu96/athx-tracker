import { test } from "node:test";
import assert from "node:assert/strict";
import { recentOf } from "./recent.ts";
import type { RecordItem } from "./domain.ts";

const entry = (kind: RecordItem["kind"], day: string, id: string): RecordItem =>
  ({ id, kind, athlete: kind === "request" ? "team" : "hippos", day }) as RecordItem;

test("weigh-ins, check-ins and requests stay in a limited slice", () => {
  const records = [
    entry("workout", "2026-11-07", "w1"),
    entry("meal", "2026-11-06", "m1"),
    entry("meal", "2026-11-05", "m2"),
    entry("request", "2026-01-01", "idea"),
    entry("bodyweight", "2025-01-01", "bw"),
    entry("energy", "2025-02-01", "en"),
    entry("workout", "2024-01-01", "old"),
  ];
  const recent = recentOf(records, 2);
  assert.deepEqual(
    recent.map((record) => record.id),
    ["w1", "m1", "idea", "bw", "en"],
  );
});
