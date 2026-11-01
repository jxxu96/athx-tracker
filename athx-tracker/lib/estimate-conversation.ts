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
};

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
