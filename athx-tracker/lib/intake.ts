/*
 * What else a meal held, as the estimate judged it: sodium, sugar, caffeine,
 * fruit and vegetables. Kept on the meal for trends and not shown anywhere.
 * They never decide whether an estimate or a meal is usable: a figure that
 * does not read is left out, and a meal typed by hand has none.
 *
 * The figures are for the food as estimated. The meal can then be made
 * bigger or smaller, split by dish, or have its figures typed over, so the
 * form holds them with the calories they came with and saves them scaled to
 * the calories the meal is saved with. The estimator states the same shape
 * as JSON Schema, in estimator/intake.mjs.
 */

/** Sodium mg, total sugars g, caffeine mg, fruit g, vegetables g. */
export const INTAKE_KEYS = ["sodium", "sugar", "caffeine", "fruit", "vegetables"] as const;
export type IntakeKey = (typeof INTAKE_KEYS)[number];
export type Intake = Partial<Record<IntakeKey, number>>;

/** As high as one meal's figure can be, the same as the estimator allows. */
export const INTAKE_CEILINGS: Record<IntakeKey, number> = {
  sodium: 50000,
  sugar: 3000,
  caffeine: 5000,
  fruit: 10000,
  vegetables: 10000,
};

/** An estimate's intake and the calories it gave with it. */
export type IntakeHeld = { intake: Intake; calories: number };

const round1 = (value: number) => Math.round(value * 10) / 10;
const usable = (value: unknown, key: IntakeKey): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= INTAKE_CEILINGS[key];

/** The figures that read, each to a tenth, or undefined when none do. Untrusted input is fine. */
export function intakeOf(value: unknown): Intake | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const held = value as Record<string, unknown>;
  const out: Intake = {};
  for (const key of INTAKE_KEYS) if (usable(held[key], key)) out[key] = round1(held[key]);
  return Object.keys(out).length ? out : undefined;
}

/** What an estimate gave, held with its calories, or null for one without. */
export function holdIntake(estimate: { intake?: Intake; calories: number }): IntakeHeld | null {
  const intake = intakeOf(estimate.intake);
  return intake ? { intake, calories: Number.isFinite(estimate.calories) ? Math.max(estimate.calories, 0) : 0 } : null;
}

/** A held intake from a draft, or null for one from before intake or damaged in storage. */
export function heldOf(value: unknown): IntakeHeld | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const held = value as { intake?: unknown; calories?: unknown };
  const intake = intakeOf(held.intake);
  if (!intake || typeof held.calories !== "number") return null;
  return { intake, calories: Number.isFinite(held.calories) ? Math.max(held.calories, 0) : 0 };
}

/**
 * The intake at the calories the food is saved with: half the calories,
 * half the sodium, and none at none. Food estimated at no calories, such as
 * a diet soda, has nothing to scale by, so it stays as it came. Each figure
 * is held to its ceiling.
 */
export function scaledIntake(held: IntakeHeld | null | undefined, calories: number): Intake | undefined {
  if (!held) return undefined;
  const ratio = held.calories > 0 ? (Number.isFinite(calories) ? Math.max(calories, 0) : 0) / held.calories : 1;
  const out: Intake = {};
  for (const key of INTAKE_KEYS) {
    const value = held.intake[key];
    if (value !== undefined) out[key] = Math.min(round1(value * ratio), INTAKE_CEILINGS[key]);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Food held at its own calories put together, such as a meal and an
 * ingredient estimated on its own to add to it: each part's intake at the
 * calories it is at now, held with their calories together. A part without
 * intake adds its calories and nothing else, so it is not counted as more of
 * the rest. Null when no part has any.
 */
export function joinHeld(parts: readonly { held: IntakeHeld | null | undefined; calories: number }[]): IntakeHeld | null {
  const intake = sumIntake(parts.map(({ held, calories }) => scaledIntake(held, calories)));
  if (!intake) return null;
  return { intake, calories: parts.reduce((sum, { calories }) => sum + (Number.isFinite(calories) ? Math.max(calories, 0) : 0), 0) };
}

/**
 * Several intakes added up, each figure over the ones that gave it, and held
 * to its ceiling. Undefined when none gave anything.
 */
export function sumIntake(list: readonly (Intake | undefined)[]): Intake | undefined {
  const out: Intake = {};
  for (const key of INTAKE_KEYS) {
    const given = list.filter((intake) => intake?.[key] !== undefined);
    if (given.length)
      out[key] = Math.min(round1(given.reduce((sum, intake) => sum + (intake?.[key] ?? 0), 0)), INTAKE_CEILINGS[key]);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The weighted average of each figure over the answers that gave it. Unlike
 * the macros, a 0 counts: no caffeine in a salad is a measurement, and an
 * answer that left a figure out has none rather than a 0. The estimator
 * averages the same way.
 */
export function averageIntake(list: readonly { intake?: Intake; weight: number }[]): Intake | undefined {
  const out: Intake = {};
  for (const key of INTAKE_KEYS) {
    const given = list.filter(({ intake, weight }) => intake?.[key] !== undefined && weight > 0);
    const mass = given.reduce((sum, { weight }) => sum + weight, 0);
    if (mass > 0)
      out[key] = round1(given.reduce((sum, { intake, weight }) => sum + (intake?.[key] ?? 0) * weight, 0) / mass);
  }
  return Object.keys(out).length ? out : undefined;
}
