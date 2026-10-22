import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayToDate,
  daysBetween,
  formatDay,
  sortRecords,
  weekStart,
} from "./client.ts";
import type { RecordItem } from "./domain.ts";

/** Walks days forward without going through any local timezone. */
const plus = (day: string, n: number) =>
  new Date(dayToDate(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);

test("a week starts on Monday", () => {
  // Every day in a run of seven agrees on the same Monday.
  const start = weekStart("2026-10-22");
  for (let i = 0; i < 7; i += 1) {
    assert.equal(weekStart(plus(start, i)), start, `day ${i} of the week`);
  }
  assert.equal(dayToDate(start).getUTCDay(), 1, "Monday is UTC day 1");
  assert.ok(start <= "2026-10-22");
});

test("consecutive weeks are seven days apart", () => {
  const a = weekStart("2026-10-22");
  const b = weekStart(plus(a, 7));
  assert.equal(daysBetween(a, b), 7);
  assert.notEqual(a, b);
});

test("week boundaries do not leak across a year", () => {
  const sunday = weekStart("2027-01-03");
  const monday = weekStart("2027-01-04");
  assert.notEqual(sunday, monday, "Sunday belongs to the week before");
  assert.equal(dayToDate(sunday).getUTCDay(), 1);
  assert.equal(dayToDate(monday).getUTCDay(), 1);
});

test("day arithmetic survives month ends and leap years", () => {
  assert.equal(daysBetween("2026-10-31", "2026-11-01"), 1);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2, "2028 is a leap year");
  assert.equal(daysBetween("2027-02-28", "2027-03-01"), 1);
  assert.equal(daysBetween("2026-10-22", "2026-10-22"), 0);
});

test("day arithmetic is unmoved by daylight saving", () => {
  // US clocks move on these weekends; anchoring at noon UTC keeps them whole.
  assert.equal(daysBetween("2027-03-13", "2027-03-15"), 2);
  assert.equal(daysBetween("2027-11-06", "2027-11-08"), 2);
});

test("the countdown to the event is a whole number of days", () => {
  assert.equal(daysBetween("2027-08-27", "2027-08-28"), 1);
  assert.ok(daysBetween("2026-10-22", "2027-08-28") > 300);
});

test("recent days are named rather than dated", () => {
  const today = "2026-10-22";
  assert.equal(formatDay(today, today), "Today");
  assert.equal(formatDay("2026-10-21", today), "Yesterday");
  assert.ok(!/Today|Yesterday/.test(formatDay("2026-10-01", today)));
});

test("the log reads newest day first", () => {
  const at = (day: string, id: string) =>
    ({ id, day, kind: "meal" }) as unknown as RecordItem;
  const sorted = sortRecords([
    at("2026-10-20", "a"),
    at("2026-10-22", "b"),
    at("2026-10-21", "c"),
  ]);
  assert.deepEqual(sorted.map((r) => r.day), [
    "2026-10-22",
    "2026-10-21",
    "2026-10-20",
  ]);
});

test("entries on the same day keep the order they arrived in", () => {
  // The server hands them over newest-first within a day, and a stable sort is
  // what preserves that; losing it would silently reorder the day's entries.
  const at = (day: string, id: string) =>
    ({ id, day, kind: "meal" }) as unknown as RecordItem;
  const sorted = sortRecords([
    at("2026-10-22", "first"),
    at("2026-10-22", "second"),
    at("2026-10-22", "third"),
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ["first", "second", "third"]);
});

test("sorting does not disturb the caller's array", () => {
  const at = (day: string) => ({ day, kind: "meal" }) as unknown as RecordItem;
  const input = [at("2026-10-20"), at("2026-10-22")];
  sortRecords(input);
  assert.deepEqual(input.map((r) => r.day), ["2026-10-20", "2026-10-22"]);
});
