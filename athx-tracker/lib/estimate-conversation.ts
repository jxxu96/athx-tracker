import type { Macros } from "./domain.ts";

/** One answer for some food: a whole meal, or one dish of a shared one. */
export type DishEstimate = Macros & {
  alcohol?: number;
  fiber?: number;
  name: string;
  assumptions: string;
  confidence: "low" | "medium" | "high";
};

/** A meal asked for dish by dish comes back with its dishes as well. */
export type MealEstimate = DishEstimate & { dishes?: DishEstimate[] };

export type EstimateRefinement = {
  previous: MealEstimate;
  replies: string[];
  /** Each estimator's own last answer, to continue from in place of previous. */
  byEstimator?: Partial<Record<OwnEstimator, DishEstimate>>;
};

/** The estimators that answer for themselves; the average is none of them. */
export const OWN_ESTIMATORS = ["codex", "claude", "grok"] as const;
export type OwnEstimator = (typeof OWN_ESTIMATORS)[number];

const FIGURES = ["calories", "protein", "carbs", "fat", "fiber", "alcohol"] as const;

/**
 * In a reply, each estimator continues from its own last answer rather than
 * the average on the form. Given the same average, all three applied the same
 * correction to it and came back with the same figures, so the average of a
 * reply was one answer three times. Only while the form still shows that
 * average as it came: an edited figure or assumption is a correction of the
 * user's own, and every estimator has to start from it, so then there is none.
 * figures is what the form holds, or undefined while it holds nothing usable.
 */
export function ownPrevious(
  previous: MealEstimate,
  shown: { figures?: Partial<Record<(typeof FIGURES)[number], number>>; assumptions: string },
  answers: readonly { provider: string; estimate: MealEstimate }[],
): EstimateRefinement["byEstimator"] {
  const figuresEdited = shown.figures !== undefined &&
    FIGURES.some((key) => (shown.figures?.[key] ?? 0) !== (previous[key] ?? 0));
  if (figuresEdited || shown.assumptions !== previous.assumptions) return undefined;
  const own: NonNullable<EstimateRefinement["byEstimator"]> = {};
  for (const { provider, estimate } of answers) {
    if (!(OWN_ESTIMATORS as readonly string[]).includes(provider)) continue;
    // A whole meal's answer: its figures and working, without any dishes.
    const { name, calories, protein, carbs, fat, fiber, alcohol, assumptions, confidence } = estimate;
    own[provider as OwnEstimator] = { name, calories, protein, carbs, fat, fiber, alcohol, assumptions, confidence };
  }
  return Object.keys(own).length ? own : undefined;
}

export const REPLY_LIMIT = 1000;
export const CONVERSATION_LIMIT = 6000;
export const MAX_REPLIES = 20;
export const FOOD_NOTES_LIMIT = 2000;

/**
 * Every provider gets the same context, even when a fallback answers.
 * Food notes ride along with every estimate, first or follow-up, so a usual
 * order or a label typed once in Setup is not looked up again each time.
 */
export function estimatePrompt(
  description: string,
  refinement?: EstimateRefinement,
  foodNotes = "",
  dishes?: string[],
) {
  const notes = foodNotes.trim();
  if (!refinement && !notes && !dishes?.length) return description;
  return JSON.stringify({
    mealDescription: description,
    // How the phone cut a shared meal into dishes, for the estimator to keep.
    ...(dishes?.length ? { dishes } : {}),
    ...(refinement
      ? { previousEstimate: refinement.previous, replies: refinement.replies }
      : {}),
    ...(notes ? { foodNotes: notes } : {}),
  });
}
