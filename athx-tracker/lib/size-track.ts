import { SCALE_MIN } from "./meal-dishes.ts";

/*
 * Where a size sits on its slider. The track runs from 0% to 200%, but a
 * meal or a dish is mostly resized between half and a bit over whole, so
 * 50% to 125% takes the middle 60% of the track: a 5% step there is twice as
 * wide as one below 50% and three times one above 125%. Ticks at 50, 100
 * and 125 show where the stretch is, and every size the slider gives, by
 * finger or by key, is a whole 5%. The track's left end is the smallest
 * size, 1%. The box beside it takes anything else.
 */

/** The track in positions, which is what the range input itself holds. */
export const TRACK_LENGTH = 1000;
/** The largest size the slider reaches; past it, the box. */
export const TRACK_MAX = 200;
export const TRACK_STEP = 5;
export const TRACK_TICKS = [50, 100, 125] as const;
/** Where the track bends, as [position, percent]: straight between each pair. */
const KNOTS = [[0, 0], [200, 50], [800, 125], [TRACK_LENGTH, TRACK_MAX]] as const;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Where a size sits on the track. One past either end sits at that end. */
export function trackPosition(percent: number) {
  const size = clamp(Number.isFinite(percent) ? percent : 100, 0, TRACK_MAX);
  for (let index = 1; index < KNOTS.length; index++) {
    const [from, low] = KNOTS[index - 1];
    const [to, high] = KNOTS[index];
    if (size <= high) return from + ((size - low) / (high - low)) * (to - from);
  }
  return TRACK_LENGTH;
}

/** The size at a place on the track, to the nearest 5%, and never under the smallest size. */
export function trackPercent(position: number) {
  const at = clamp(Number.isFinite(position) ? position : 0, 0, TRACK_LENGTH);
  for (let index = 1; index < KNOTS.length; index++) {
    const [from, low] = KNOTS[index - 1];
    const [to, high] = KNOTS[index];
    if (at <= to) {
      const size = low + ((at - from) / (to - from)) * (high - low);
      return Math.max(SCALE_MIN, Math.round(size / TRACK_STEP) * TRACK_STEP);
    }
  }
  return TRACK_MAX;
}

/**
 * A size moved some 5% steps along the track, as the arrow keys move it: a
 * size between steps goes to the next one that way first. It stays within
 * the track, and a size typed past its end is not pulled back by a step up.
 */
export function stepSize(percent: number, steps: number) {
  if (steps > 0 && percent >= TRACK_MAX) return percent;
  const on = steps > 0
    ? Math.floor(percent / TRACK_STEP + 1e-9) * TRACK_STEP
    : Math.ceil(percent / TRACK_STEP - 1e-9) * TRACK_STEP;
  return clamp(Math.min(on, TRACK_MAX) + steps * TRACK_STEP, SCALE_MIN, TRACK_MAX);
}
