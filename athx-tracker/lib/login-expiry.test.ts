import { test } from "node:test";
import assert from "node:assert/strict";
import { dueWarning, readExpiry, showWarning, timeLeft } from "./login-expiry.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const end = "2026-11-26T15:00:00.000Z";
const at = (left: number) => Date.parse(end) - left;

test("a warning is due at 7 days, 3 days, 2 days, 1 day and 12 hours out", () => {
  assert.equal(dueWarning(end, at(8 * DAY)), -1);
  assert.equal(dueWarning(end, at(7 * DAY + 1)), -1);
  assert.equal(dueWarning(end, at(7 * DAY)), 0);
  assert.equal(dueWarning(end, at(5 * DAY)), 0);
  assert.equal(dueWarning(end, at(3 * DAY)), 1);
  assert.equal(dueWarning(end, at(2 * DAY)), 2);
  assert.equal(dueWarning(end, at(DAY)), 3);
  assert.equal(dueWarning(end, at(12 * HOUR + 1)), 3);
  assert.equal(dueWarning(end, at(12 * HOUR)), 4);
  // Past the end, the last warning stays due.
  assert.equal(dueWarning(end, at(-DAY)), 4);
  assert.equal(dueWarning("not a time", 0), -1);
});

test("one click sends a warning away until the next one is due", () => {
  assert.equal(showWarning(end, at(6 * DAY), null), true);
  const seven = { expiresAt: end, warning: 0 };
  assert.equal(showWarning(end, at(6 * DAY), seven), false);
  assert.equal(showWarning(end, at(4 * DAY), seven), false);
  assert.equal(showWarning(end, at(3 * DAY), seven), true);
  // Unopened between warnings: the one due now shows, once.
  assert.equal(showWarning(end, at(20 * HOUR), seven), true);
  assert.equal(showWarning(end, at(20 * HOUR), { expiresAt: end, warning: 3 }), false);
  assert.equal(showWarning(end, at(11 * HOUR), { expiresAt: end, warning: 3 }), true);
  assert.equal(showWarning(end, at(-HOUR), { expiresAt: end, warning: 4 }), false);
  // A new sign-in has a new end, and the old one's dismissals do not cover it.
  const later = "2027-01-02T15:00:00.000Z";
  assert.equal(showWarning(later, Date.parse(later) - 6 * DAY, { expiresAt: end, warning: 4 }), true);
  // Nothing to warn about: no end known, or not yet in range.
  assert.equal(showWarning(null, 0, null), false);
  assert.equal(showWarning(end, at(10 * DAY), null), false);
});

test("the time left reads in days, then hours, then minutes", () => {
  assert.equal(timeLeft(end, at(7 * DAY)), "in 7 days");
  assert.equal(timeLeft(end, at(2.5 * DAY)), "in 3 days");
  assert.equal(timeLeft(end, at(2 * DAY)), "in 2 days");
  assert.equal(timeLeft(end, at(2 * DAY - 1000)), "in 2 days");
  assert.equal(timeLeft(end, at(36 * HOUR)), "in 2 days");
  assert.equal(timeLeft(end, at(36 * HOUR - 1)), "in 36 hours");
  assert.equal(timeLeft(end, at(DAY)), "in 24 hours");
  assert.equal(timeLeft(end, at(HOUR)), "in 1 hour");
  assert.equal(timeLeft(end, at(40 * 60_000)), "in 40 minutes");
  assert.equal(timeLeft(end, at(10_000)), "in 1 minute");
  assert.equal(timeLeft(end, at(0)), null);
  assert.equal(timeLeft(end, at(-DAY)), null);
});

test("only a real time is taken from the server", () => {
  assert.equal(readExpiry("2026-11-26T10:00:00-05:00"), end);
  for (const junk of [null, undefined, "", "soon", 1795705200000, {}]) assert.equal(readExpiry(junk), null);
});
