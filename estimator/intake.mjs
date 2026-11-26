/**
 * What else a meal held, kept for trends and never shown: sodium, sugar,
 * caffeine, fruit and vegetables. They ride along with an estimate and never
 * decide whether it is usable. An answer without them, or with one that does
 * not read, is still an answer; only that figure is left out.
 */

/** Sodium mg, total sugars g, caffeine mg, fruit g, vegetables g. */
export const INTAKE_KEYS = ["sodium", "sugar", "caffeine", "fruit", "vegetables"];
export const INTAKE_CEILINGS = { sodium: 50000, sugar: 3000, caffeine: 5000, fruit: 10000, vegetables: 10000 };

export const INTAKE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    INTAKE_KEYS.map((key) => [key, { type: "number", minimum: 0, maximum: INTAKE_CEILINGS[key] }]),
  ),
  required: INTAKE_KEYS,
};

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * The figures that read, each to a tenth, or undefined when none do. Sugar is
 * part of the carbs, so it is held to them rather than turning the answer away.
 */
export function cleanIntake(value, carbs = Infinity) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  for (const key of INTAKE_KEYS) {
    if (value[key] === null || value[key] === undefined || value[key] === "") continue;
    const parsed = Number(value[key]);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > INTAKE_CEILINGS[key]) continue;
    out[key] = round1(parsed);
  }
  if (out.sugar !== undefined && Number.isFinite(carbs)) out.sugar = Math.min(out.sugar, carbs);
  return Object.keys(out).length ? out : undefined;
}

/**
 * Several intakes added up, as dishes add up to a meal: each figure over the
 * ones that gave it. Undefined when none of them gave anything.
 */
export function sumIntake(list) {
  const out = {};
  for (const key of INTAKE_KEYS) {
    const given = list.filter((intake) => intake?.[key] !== undefined);
    if (given.length) out[key] = round1(given.reduce((sum, intake) => sum + intake[key], 0));
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The weighted average of each figure over the answers that gave it. Unlike
 * the macros, a 0 counts: no caffeine in a salad is a measurement, and an
 * answer that left a figure out has no figure at all rather than a 0.
 */
export function averageIntake(list) {
  const out = {};
  for (const key of INTAKE_KEYS) {
    const given = list.filter(({ intake, weight }) => intake?.[key] !== undefined && weight > 0);
    const mass = given.reduce((sum, { weight }) => sum + weight, 0);
    if (mass > 0) out[key] = given.reduce((sum, { intake, weight }) => sum + intake[key] * weight, 0) / mass;
  }
  return Object.keys(out).length ? out : undefined;
}
