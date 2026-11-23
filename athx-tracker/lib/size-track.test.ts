import { test } from "node:test";
import assert from "node:assert/strict";
import { SCALE_MIN } from "./meal-dishes.ts";
import { TRACK_LENGTH, TRACK_MAX, TRACK_STEP, stepSize, trackPercent, trackPosition } from "./size-track.ts";

test("50% to 125% takes the middle 60% of the track", () => {
  assert.equal(trackPosition(0), 0);
  assert.equal(trackPosition(50), 200);
  assert.equal(trackPosition(75), 400);
  assert.equal(trackPosition(100), 600);
  assert.equal(trackPosition(125), 800);
  assert.equal(trackPosition(TRACK_MAX), TRACK_LENGTH);
  // A 5% step in the middle is twice one below it and three times one above.
  const width = (from: number) => trackPosition(from + TRACK_STEP) - trackPosition(from);
  assert.equal(width(80), 2 * width(20));
  assert.ok(Math.abs(width(80) - 3 * width(150)) < 1e-9);
  // Past either end, at that end; a size that is not a number sits at 100%.
  assert.equal(trackPosition(350), TRACK_LENGTH);
  assert.equal(trackPosition(-5), 0);
  assert.equal(trackPosition(Number.NaN), 600);
});

test("a place on the track is a whole 5%, and its left end the smallest size", () => {
  for (let size = TRACK_STEP; size <= TRACK_MAX; size += TRACK_STEP) assert.equal(trackPercent(trackPosition(size)), size);
  assert.equal(trackPercent(0), SCALE_MIN);
  assert.equal(trackPercent(5), SCALE_MIN, "nearer 0 than 5 is the smallest size");
  assert.equal(trackPercent(trackPosition(82)), 80);
  assert.equal(trackPercent(trackPosition(83)), 85);
  assert.equal(trackPercent(TRACK_LENGTH + 50), TRACK_MAX);
  assert.equal(trackPercent(Number.NaN), SCALE_MIN);
});

test("a key moves a size a 5% step along the track, onto the steps first", () => {
  assert.equal(stepSize(100, 1), 105);
  assert.equal(stepSize(100, -1), 95);
  assert.equal(stepSize(112.3, 1), 115);
  assert.equal(stepSize(112.3, -1), 110);
  assert.equal(stepSize(100, 5), 125);
  assert.equal(stepSize(5, -1), SCALE_MIN);
  assert.equal(stepSize(SCALE_MIN, -1), SCALE_MIN);
  assert.equal(stepSize(SCALE_MIN, 1), 5);
  assert.equal(stepSize(3, -5), SCALE_MIN);
  assert.equal(stepSize(TRACK_MAX, 1), TRACK_MAX);
  // A size typed past the track's end stays until it is stepped down, onto the track.
  assert.equal(stepSize(350, 1), 350);
  assert.equal(stepSize(350, -1), 195);
});
