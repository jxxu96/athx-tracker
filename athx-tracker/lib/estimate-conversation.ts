import type { Macros } from "./domain";

export type MealEstimate = Macros & {
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

/** Every provider gets the same context, even when a fallback answers. */
export function estimatePrompt(description: string, refinement?: EstimateRefinement) {
  if (!refinement) return description;
  return JSON.stringify({
    mealDescription: description,
    previousEstimate: refinement.previous,
    replies: refinement.replies,
  });
}
