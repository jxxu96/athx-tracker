import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyweightHistory, bodyweightKnown, bodyweightOn, currentBodyweight } from "./bodyweight.ts";
import type { Bodyweight, RecordItem } from "./domain.ts";

const weighIn = (day: string, kg: number, over: Partial<Bodyweight> = {}): Bodyweight => ({
  id: `${day}-${kg}`, kind: "bodyweight", athlete: "gators", day, kg, ...over,
});

test("a day takes the latest weigh-in on or before it", () => {
  const records: RecordItem[] = [weighIn("2026-03-10", 82), weighIn("2026-02-01", 85), weighIn("2026-03-10", 81, { time: "07:00" })];
  const history = bodyweightHistory(records, { hippos: 0, gators: 0 });
  assert.equal(bodyweightOn(history, "gators", "2026-02-01"), 85);
  assert.equal(bodyweightOn(history, "gators", "2026-03-09"), 85);
  // Two on a day: the later clock. An untimed one counts as earlier than a timed one.
  assert.equal(bodyweightOn(history, "gators", "2026-03-10"), 81);
  assert.equal(currentBodyweight(history, "gators")?.kg, 81);
});

test("before the first weigh-in, Setup's undated weight, then the first weigh-in", () => {
  const records: RecordItem[] = [weighIn("2026-03-10", 82)];
  assert.equal(bodyweightOn(bodyweightHistory(records, { hippos: 0, gators: 90 }), "gators", "2026-01-01"), 90);
  assert.equal(bodyweightOn(bodyweightHistory(records, { hippos: 0, gators: 0 }), "gators", "2026-01-01"), 82);
  const none = bodyweightHistory([], { hippos: 0, gators: 0 });
  assert.equal(bodyweightOn(none, "gators", "2026-01-01"), 0);
  assert.equal(bodyweightKnown(none, "gators"), false);
  assert.equal(bodyweightKnown(bodyweightHistory(records, undefined), "gators"), true);
  assert.equal(bodyweightKnown(bodyweightHistory(records, undefined), "hippos"), false);
});
