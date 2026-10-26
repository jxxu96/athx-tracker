import type { Macros } from "./domain.ts";

export type MealEstimate = Macros & {
  alcohol?: number;
  fiber?: number;
  name: string;
  assumptions: string;
  confidence: "low" | "medium" | "high";
};

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
) {
  const notes = foodNotes.trim();
  if (!refinement && !notes) return description;
  return JSON.stringify({
    mealDescription: description,
    ...(refinement
      ? { previousEstimate: refinement.previous, replies: refinement.replies }
      : {}),
    ...(notes ? { foodNotes: notes } : {}),
  });
}
