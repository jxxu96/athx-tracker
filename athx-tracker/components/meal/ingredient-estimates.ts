"use client";

import { useState } from "react";
import { api, message } from "@/lib/client";
import type { MealTemplateItem } from "@/lib/domain";
import type { MealEstimate } from "@/lib/estimate-conversation";
import { itemWithEstimate, weighedInstead } from "@/lib/meal-ingredients";
import { templateDescription } from "@/lib/meal-templates";

/**
 * One ingredient estimated on its own: a food added to a template's meal, or
 * a counted one weighed instead, whose figures were for however much one of
 * it was, so a weight cannot scale them. Either is estimated once at the
 * amount written and put on the meal, the others keeping their figures. One
 * runs at a time, never beside the meal's own estimate, and an answer that
 * comes back after the form was cleared is dropped.
 */
export function useIngredientEstimates({
  ingredients,
  blocked,
  epoch,
  write,
}: {
  ingredients: readonly MealTemplateItem[];
  /** The meal itself is being estimated. */
  blocked: boolean;
  /** Moves on whenever the form is cleared. */
  epoch: { readonly current: number };
  /** Puts a new list of ingredients on the meal, figures, description and all. */
  write: (next: MealTemplateItem[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function estimate(item: MealTemplateItem, place: (estimated: MealTemplateItem) => MealTemplateItem[]) {
    if (busy || blocked) return false;
    const started = epoch.current;
    setBusy(true);
    setError("");
    try {
      const { estimate: answer } = await api<{ estimate: MealEstimate }>("/api/estimate", {
        method: "POST",
        body: JSON.stringify({ description: templateDescription([item]) }),
      });
      // The form was cleared while it was out.
      if (started !== epoch.current) return false;
      write(place(itemWithEstimate(item, answer)));
      return true;
    } catch (problem) {
      if (started === epoch.current) setError(message(problem));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    setError,
    /** In this meal until it is slid to zero, and kept with the template once that is updated. */
    add: (item: MealTemplateItem) => estimate(item, (estimated) => [...ingredients, estimated]),
    /** In the counted item's place, at that weight. */
    weigh: (index: number, grams: number) => {
      const current = ingredients[index];
      if (!current) return Promise.resolve(false);
      return estimate(weighedInstead(current, grams), (estimated) =>
        ingredients.map((each, i) => (i === index ? estimated : each)));
    },
  };
}
