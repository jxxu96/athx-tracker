import type { Meal } from "./domain.ts";

/** The header switch: one athlete, or a meal written for both of them. */
export type LoggingFor = "hippos" | "gators" | "both";

/** The meal, before anyone is chosen and before an id is assigned. */
export type MealDraft = Omit<Meal, "id" | "athlete">;

/** Stable for the life of one draft, so a retry upserts instead of inserting again. */
export type MealDraftIds = Record<Exclude<LoggingFor, "both">, string>;

function copyMacros(macros: Meal["macros"]): Meal["macros"] {
  return {
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    ...(typeof macros.alcohol === "number" ? { alcohol: macros.alcohol } : {}),
    ...(typeof macros.fiber === "number" ? { fiber: macros.fiber } : {}),
  };
}

/**
 * Who a meal save writes.
 * Logging for both creates one record per athlete, hippos then gators, with
 * the same day, sitting, name, macros, and source, and different ids.
 * Logging for one athlete writes that athlete only. An edit keeps the id and
 * athlete it was opened with, so Both cannot turn an update into a second
 * insert or move it onto the other athlete.
 * Ids belong to the caller. A retry passes the same ids, and the endpoint
 * upserts the athlete that already landed instead of inserting another copy.
 * Macros are copied so the two records cannot change each other.
 */
export function fanOutMeal(input: {
  loggingFor: LoggingFor;
  editing: Pick<Meal, "id" | "athlete"> | null;
  draft: MealDraft;
  ids: MealDraftIds;
}): Meal[] {
  if (input.editing) {
    return [{
      ...input.draft,
      id: input.editing.id,
      athlete: input.editing.athlete,
      macros: copyMacros(input.draft.macros),
    }];
  }
  const athletes = input.loggingFor === "both"
    ? (["hippos", "gators"] as const)
    : ([input.loggingFor] as const);
  return athletes.map((athlete) => ({
    ...input.draft,
    id: input.ids[athlete],
    athlete,
    macros: copyMacros(input.draft.macros),
  }));
}
