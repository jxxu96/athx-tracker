import {
  MEAL_TEMPLATE_GRAMS_LIMIT,
  MEAL_TEMPLATE_ITEM_LIMIT,
  MEAL_TEMPLATE_ITEMS,
  type Meal,
  type MealTemplateItem,
} from "./domain.ts";
import { mealKey } from "./common-meals.ts";

const FIGURES = ["calories", "protein", "carbs", "fat", "fiber", "alcohol"] as const;
export type Figures = Record<(typeof FIGURES)[number], number>;
type SavedItem = MealTemplateItem & { nutrition: NonNullable<MealTemplateItem["nutrition"]> };

const FIGURE_NAMES = [/^kcal$/i, /^(p|protein)$/i, /^(c|carbs?)$/i, /^(f|fat)$/i, /^fib(?:er|re)$/i, /^(ethanol|alcohol)$/i];
const PROVIDER_BREAKDOWN = /^From (?:Codex|Claude|Grok) \[[^\n]+\]:\s*/m;

/** The figures inside an item's brackets, "248 kcal, 47P, 0C, 5F", or undefined when they do not read. */
export function readFigures(text: string): Figures | undefined {
  const values: Partial<Figures> = {};
  for (const part of text.split(",")) {
    const match = part.trim().match(/^(\d+(?:\.\d+)?)\s*(?:g\s+)?([a-z]+)$/i);
    if (!match) return;
    const index = FIGURE_NAMES.findIndex((pattern) => pattern.test(match[2]));
    if (index === -1 || values[FIGURES[index]] !== undefined) return;
    values[FIGURES[index]] = Number(match[1]);
  }
  const { calories, protein, carbs, fat, fiber = 0, alcohol = 0 } = values;
  if (calories === undefined || protein === undefined || carbs === undefined || fat === undefined) return;
  if (fiber > carbs || !Object.values(values).every(Number.isFinite)) return;
  return { calories, protein, carbs, fat, fiber, alcohol };
}

function foodWords(name: string) {
  return mealKey(name.replace(/['’]s\b/gi, "").replace(/\bpb\b/gi, "peanut butter")).split(" ").filter(Boolean);
}

/** Two names for the same food: most of each one's words are in the other. */
export function sameFood(a: string, b: string) {
  const first = foodWords(a);
  const second = foodWords(b);
  const shared = first.filter((word) => second.includes(word)).length;
  return shared > 0 && shared >= Math.ceil(first.length * 0.6) && shared >= Math.ceil(second.length * 0.6);
}

/**
 * One item's line, as the estimator is asked to write it: its name, its
 * portion and its own figures in brackets, "Chicken breast, 150 g cooked
 * [248 kcal, 47P, 0C, 5F]". label is everything before the brackets, and
 * after is whatever the line goes on to say. Anything else is not an item.
 */
export function ingredientRow(line: string) {
  const heading = line.replace(/\*\*/g, "").replace(/^\s*(?:[-*•]|\d+[.)])?\s*/, "");
  const match = heading.match(/^([^[]+?)\s*\[([^\]]+)\]/);
  if (!match) return null;
  const macros = readFigures(match[2]);
  if (!macros) return null;
  const headingText = match[1].trim();
  const portion = headingText.match(/^(.+?),\s*(\d+(?:\.\d+)?)\s*(?:g|grams)\b/i);
  const leading = portion ? null : headingText.match(/^(\d+(?:\.\d+)?)\s*(?:g|grams)\b\s*(?:of\s+)?(.+)$/i);
  return {
    name: (portion?.[1] ?? leading?.[2] ?? headingText.split(",")[0]).trim(),
    grams: Number(portion?.[2] ?? leading?.[1] ?? 0),
    macros,
    label: headingText,
    after: heading.slice(match[0].length).replace(/^\s*[-–—:.]?\s*/, "").trim(),
  };
}

function ingredientRows(assumptions: string) {
  return assumptions.split(/\r?\n/).flatMap((line) => {
    const row = ingredientRow(line);
    return row ? [{ name: row.name, grams: row.grams, macros: row.macros }] : [];
  });
}

/**
 * Each estimator's own working, with the share of the average it had. A
 * blended estimate lists every one under its summary line; anything else is
 * one estimate, which is all of it.
 */
export function providerSections(assumptions: string): { assumptions: string; weight: number }[] {
  const sections = assumptions.split(PROVIDER_BREAKDOWN);
  const shares = [...sections[0].matchAll(/(?:Codex|Claude|Grok) (\d+)%/g)];
  return sections.length > 1 && shares.length === sections.length - 1
    ? sections.slice(1).map((text, index) => ({ assumptions: text, weight: Number(shares[index][1]) }))
    : [{ assumptions, weight: 1 }];
}

/** Match a complete breakdown to the described items before reusing its numbers. */
function matchRows(items: readonly MealTemplateItem[], assumptions: string) {
  const rows = ingredientRows(assumptions);
  if (rows.length !== items.length) return;
  const matched = items.map((item) => {
    // A counted item may put its count in the name or in the portion column.
    const foodName = (name: string) => item.grams === 0 ? name.replace(/^\d+(?:\.\d+)?\s+/, "") : name;
    return rows.filter((row) =>
      Math.abs(row.grams - item.grams) < 0.051 && sameFood(foodName(item.name), foodName(row.name)),
    );
  });
  if (matched.some((matches) => matches.length !== 1)) return;
  const ordered = matched.map(([row]) => row);
  if (new Set(ordered).size !== rows.length) return;
  return ordered;
}

export function hasIngredientNutrition(items: MealTemplateItem[]): items is SavedItem[] {
  return items.some((item) => (item.nutrition?.grams ?? 0) > 0) &&
    items.every((item) => item.nutrition);
}

/**
 * Save the figures at a reference portion. Reconcile small rounding differences
 * against the saved meal totals so loading the recipe keeps the original figures.
 */
export function captureIngredientNutrition(
  items: MealTemplateItem[],
  totals: Meal["macros"],
  assumptions: string,
  sources?: readonly { assumptions: string; weight: number }[],
): MealTemplateItem[] {
  if (hasIngredientNutrition(items) || !items.some((item) => item.grams > 0)) return items;
  // Older blended estimates list each provider's breakdown below its summary.
  const candidates = sources ?? providerSections(assumptions);
  const complete = candidates.flatMap(({ assumptions: text, weight }) => {
    const rows = matchRows(items, text);
    return rows ? [{ rows, weight }] : [];
  });
  if (!complete.length) return items;
  const mass = complete.reduce((sum, { weight }) => sum + weight, 0);
  const portions = items.map((_, index) => Object.fromEntries(FIGURES.map((key) => [
    key,
    complete.reduce((sum, { rows, weight }) => sum + rows[index].macros[key] * (mass ? weight : 1), 0) /
      (mass || complete.length),
  ])) as Figures);
  const sums = portions.reduce((sum, portion) => {
    for (const key of FIGURES) sum[key] += portion[key];
    return sum;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, alcohol: 0 });
  if (FIGURES.some((key) => !Number.isFinite(sums[key]) || ((totals[key] ?? 0) > 0 && sums[key] === 0))) return items;
  // A single saved breakdown can be stale after a manual edit. Allow only
  // the difference from rounding each item and the total.
  if (candidates.length === 1 && FIGURES.some((key) =>
    Math.abs((totals[key] ?? 0) - sums[key]) > (items.length + 1) * 0.5,
  )) return items;
  return items.map((item, index) => {
    const portion = portions[index];
    const macros = Object.fromEntries(FIGURES.map((key) => [
      key, sums[key] ? portion[key] / sums[key] * (totals[key] ?? 0) : 0,
    ])) as Figures;
    // Distribute fiber and the rest of the carbs separately so every
    // ingredient's fiber stays part of its total carbs.
    const netTotal = totals.carbs - (totals.fiber ?? 0);
    const netSum = sums.carbs - sums.fiber;
    const share = netSum > 0
      ? (portion.carbs - portion.fiber) / netSum
      : sums.carbs > 0 ? portion.carbs / sums.carbs : 0;
    macros.carbs = macros.fiber + share * netTotal;
    return { ...item, nutrition: { grams: item.grams, macros } };
  });
}

/** An older log entry may have ingredients in its estimate notes alone. */
export function loggedIngredients(meal: Pick<Meal, "items" | "macros" | "assumptions">): MealTemplateItem[] {
  if (meal.items) return meal.items;
  const sections = meal.assumptions.split(PROVIDER_BREAKDOWN);
  const rows = ingredientRows(sections.length > 1 ? sections[1] : sections[0]);
  if (rows.length > MEAL_TEMPLATE_ITEMS || rows.some((row) => row.grams > MEAL_TEMPLATE_GRAMS_LIMIT)) return [];
  const items = captureIngredientNutrition(
    rows.map(({ name, grams }) => ({ name: name.slice(0, MEAL_TEMPLATE_ITEM_LIMIT), grams })),
    meal.macros,
    meal.assumptions,
  );
  return hasIngredientNutrition(items) ? items : [];
}

export function ingredientTotals(items: readonly MealTemplateItem[]): Meal["macros"] | undefined {
  if (!items.length || !items.every((item): item is SavedItem => !!item.nutrition)) return;
  const totals = Object.fromEntries(FIGURES.map((key) => [
    key,
    Math.round(items.reduce((sum, item) => {
      const { grams, macros } = item.nutrition;
      return sum + (macros[key] ?? 0) * (grams ? item.grams / grams : 1);
    }, 0) * 1000) / 1000,
  ])) as Figures;
  totals.fiber = Math.min(totals.fiber, totals.carbs);
  return totals;
}

export function ingredientSliderMax(grams: number, reference: number) {
  return Math.min(MEAL_TEMPLATE_GRAMS_LIMIT, Math.max(100, Math.ceil(Math.max(grams, reference * 3) / 10) * 10));
}
