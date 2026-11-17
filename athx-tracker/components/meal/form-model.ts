/**
 * The Meal form's draft: its macro boxes, the sittings and their shortcuts,
 * and the readers that take a saved draft back without trusting its shape.
 * No React here.
 */
import type { Answer } from "@/components/meal/estimator-weights";
import { isClockTime, type Macros, type Meal } from "@/lib/domain";
import type { AnswerProvider } from "@/lib/estimate-blend";
import type { MealEstimate as Estimate } from "@/lib/estimate-conversation";

export const MACRO_FIELDS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
] as const satisfies readonly { key: keyof Macros; label: string; unit: string }[];

export const MEAL_SHORTCUTS = {
  b: "Breakfast",
  l: "Lunch",
  d: "Dinner",
  s: "Snack",
  a: "Alcohol",
} as const satisfies Record<string, Meal["meal"]>;

export const MEALS = Object.values(MEAL_SHORTCUTS);

export type MacroDraft = Record<keyof Macros, string>;
export const emptyMacros: MacroDraft = { calories: "", protein: "", carbs: "", fat: "" };

export type EstimateTurn = { reply?: string; estimate: Estimate };
export type Kept = { id: string; athlete: "hippos" | "gators"; sourceKey: string };

export function macroDraftOf(value: unknown): MacroDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const held = value as Record<string, unknown>;
  return MACRO_FIELDS.every(({ key }) => typeof held[key] === "string") ? (held as MacroDraft) : undefined;
}

export function keptOf(value: unknown): Kept | null {
  if (!value || typeof value !== "object") return null;
  const held = value as Record<string, unknown>;
  return typeof held.id === "string" && typeof held.sourceKey === "string" &&
    (held.athlete === "hippos" || held.athlete === "gators")
    ? (held as Kept)
    : null;
}

/** Today at a time of day, for the sitting it falls in; now when there is none. */
export function atTime(time: string) {
  const date = new Date();
  if (isClockTime(time)) date.setHours(Number(time.slice(0, 2)), Number(time.slice(3)), 0, 0);
  return date;
}

/** An estimate's figures on one line, as the conversation shows them. */
export function figuresOf(estimate: Estimate) {
  return [
    `${Math.round(estimate.calories)} kcal`,
    `${Math.round(estimate.protein)} g protein`,
    `${Math.round(estimate.carbs)} g carbs`,
    ...(estimate.fiber ? [`${Math.round(estimate.fiber)} g fiber`] : []),
    `${Math.round(estimate.fat)} g fat`,
    ...(estimate.alcohol ? [`${Math.round(estimate.alcohol)} g ethanol`] : []),
  ].join(" · ");
}

/** Answers saved with a draft, with any figures typed over them. Anything that is not one is left out. */
export function partialsOf(value: unknown): Answer[] {
  if (!Array.isArray(value)) return [];
  const out: Answer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const held = item as Answer;
    const estimate = held.estimate;
    if (!estimate || typeof estimate !== "object") continue;
    if (held.provider !== "codex" && held.provider !== "claude" && held.provider !== "grok") continue;
    if (![estimate.calories, estimate.protein, estimate.carbs, estimate.fat].every((n) => typeof n === "number"))
      continue;
    out.push({
      type: "partial",
      provider: held.provider,
      estimate: {
        ...estimate,
        name: String(estimate.name ?? ""),
        assumptions: String(estimate.assumptions ?? ""),
        confidence: estimate.confidence === "high" || estimate.confidence === "medium" ? estimate.confidence : "low",
        fiber: typeof estimate.fiber === "number" ? estimate.fiber : 0,
        alcohol: typeof estimate.alcohol === "number" ? estimate.alcohol : 0,
      },
      ...(held.edited === true ? { edited: true } : {}),
    });
  }
  return out;
}

/** Which answers the draft had switched on. Missing or damaged means not chosen yet. */
export function includedOf(value: unknown): AnswerProvider[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const names = value.filter(
    (item): item is AnswerProvider => item === "codex" || item === "claude" || item === "grok",
  );
  return names.length === value.length ? names : null;
}

export function browserStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** A saved or usual meal, as the estimate a reply can start from. */
export function savedEstimate(meal: Pick<Meal, "name" | "macros" | "assumptions">): Estimate {
  return { ...meal.macros, name: meal.name, assumptions: meal.assumptions, confidence: "low" };
}
