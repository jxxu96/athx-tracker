import type { Meal, MealTemplate, MealTemplateItem } from "./domain.ts";
import {
  MEAL_TEMPLATE_GRAMS_LIMIT,
  MEAL_TEMPLATE_ITEM_LIMIT,
  MEAL_TEMPLATE_ITEMS,
  MEAL_TEMPLATE_LIMIT,
  MEAL_TEMPLATE_NAME_LIMIT,
} from "./domain.ts";
import { commonMeals, mealKey, type CommonMeal } from "./common-meals.ts";

const LEADING_GRAMS = /^(\d+(?:\.\d+)?)\s*(?:g|grams)\b\s*(?:of\s+)?(.+)$/i;
const TRAILING_GRAMS = /^(.+?)\s+(\d+(?:\.\d+)?)\s*(?:g|grams)\b\.?$/i;

export type MealTemplates = { hippos: MealTemplate[]; gators: MealTemplate[] };

export const EMPTY_MEAL_TEMPLATES: MealTemplates = { hippos: [], gators: [] };

/** A saved template, or a repeated meal that has not been kept yet. */
export type MealOffer = {
  id: string;
  saved: boolean;
  name: string;
  meal: Meal["meal"];
  items: MealTemplateItem[];
  macros: Meal["macros"];
  assumptions: string;
  sourceKey: string;
};

export type TemplateWrite =
  | { ok: true; templates: MealTemplate[]; id: string }
  | { ok: false; error: string };

function cleanItemName(raw: string) {
  return raw
    .replace(/^[-*•–—]\s*/, "")
    .replace(/^\(+|\)+$/g, "")
    .replace(/\.$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEAL_TEMPLATE_ITEM_LIMIT);
}

function roundGrams(grams: number) {
  return Math.round(grams * 10) / 10;
}

/** Blank when the item has no gram amount, so "2 eggs" is not "0 g 2 eggs". */
export function formatGrams(grams: number) {
  if (!Number.isFinite(grams) || grams <= 0) return "";
  return String(roundGrams(grams));
}

/**
 * Pull foods and gram amounts out of a description.
 * "80 g oats, 2 eggs, banana" keeps the eggs as a counted item.
 */
export function parseMealItems(text: string): MealTemplateItem[] {
  const items: MealTemplateItem[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    if (items.length >= MEAL_TEMPLATE_ITEMS) break;
    const piece = part.trim();
    if (!piece) continue;
    const lead = piece.match(LEADING_GRAMS);
    const trail = lead ? null : piece.match(TRAILING_GRAMS);
    const grams = Number(lead?.[1] ?? trail?.[2] ?? 0);
    const name = cleanItemName(lead?.[2] ?? trail?.[1] ?? piece);
    if (!name || !Number.isFinite(grams)) continue;
    items.push({
      name,
      grams: grams > 0 && grams <= MEAL_TEMPLATE_GRAMS_LIMIT ? roundGrams(grams) : 0,
    });
  }
  return items;
}

/** The description a template fills in, so a later estimate sees the grams. */
export function templateDescription(items: MealTemplateItem[]) {
  return items
    .filter((item) => item.name.trim())
    .map((item) => {
      const name = item.name.trim();
      const grams = formatGrams(item.grams);
      return grams ? `${grams} g ${name}` : name;
    })
    .join(", ");
}

export function itemsFromText(text: string, fallbackName: string): MealTemplateItem[] {
  const parsed = parseMealItems(text);
  if (parsed.length) return parsed;
  const name = cleanItemName(fallbackName);
  return name ? [{ name, grams: 0 }] : [];
}

function copyMacros(macros: Meal["macros"]): Meal["macros"] {
  return {
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    alcohol: macros.alcohol ?? 0,
    fiber: macros.fiber ?? 0,
  };
}

export function buildTemplate(input: {
  id: string;
  name: string;
  meal: Meal["meal"];
  items: MealTemplateItem[];
  macros: Meal["macros"];
  assumptions: string;
  sourceKey: string;
}): { ok: true; template: MealTemplate } | { ok: false; error: string } {
  const name = input.name.trim().slice(0, MEAL_TEMPLATE_NAME_LIMIT);
  if (!name) return { ok: false, error: "Name the template." };
  const items = input.items
    .map((item) => ({
      name: item.name.trim().slice(0, MEAL_TEMPLATE_ITEM_LIMIT),
      grams: roundGrams(item.grams),
    }))
    .filter((item) => item.name);
  if (!items.length) return { ok: false, error: "Add at least one item." };
  if (items.length > MEAL_TEMPLATE_ITEMS) return { ok: false, error: "That meal has too many items." };
  for (const item of items) {
    if (!Number.isFinite(item.grams) || item.grams < 0 || item.grams > MEAL_TEMPLATE_GRAMS_LIMIT)
      return { ok: false, error: "Grams need a number from 0 up to 5000." };
  }
  return {
    ok: true,
    template: {
      id: input.id,
      name,
      meal: input.meal,
      items,
      macros: {
        ...copyMacros(input.macros),
        alcohol: input.meal === "Alcohol" ? (input.macros.alcohol ?? 0) : 0,
      },
      assumptions: input.assumptions.trim().slice(0, 3000),
      sourceKey: input.sourceKey.trim().slice(0, 120),
    },
  };
}

/**
 * Insert, or replace the template this one already is.
 * The same id, the same repeated meal, or the same label is one template,
 * so saving "oats" twice does not grow a second button.
 */
export function upsertTemplate(list: MealTemplate[], template: MealTemplate): TemplateWrite {
  const named = mealKey(template.name);
  const byId = list.findIndex((item) => item.id === template.id);
  const bySource = template.sourceKey
    ? list.findIndex((item) => item.sourceKey === template.sourceKey)
    : -1;
  const byName = named ? list.findIndex((item) => mealKey(item.name) === named) : -1;
  const index = byId >= 0 ? byId : bySource >= 0 ? bySource : byName;
  if (index < 0) {
    if (list.length >= MEAL_TEMPLATE_LIMIT)
      return { ok: false, error: `You already have ${MEAL_TEMPLATE_LIMIT} meal templates.` };
    return { ok: true, templates: [template, ...list], id: template.id };
  }
  const next = list.slice();
  const id = list[index].id;
  next[index] = { ...template, id };
  return { ok: true, templates: next, id };
}

export function removeTemplate(list: MealTemplate[], id: string) {
  return list.filter((item) => item.id !== id);
}

function itemsForCommon(suggestion: CommonMeal): MealTemplateItem[] {
  const fromAssumptions = parseMealItems(suggestion.assumptions);
  // A sentence of assumptions is not a shopping list. Use it only when it
  // actually names a portion in grams.
  if (fromAssumptions.some((item) => item.grams > 0)) return fromAssumptions;
  return itemsFromText(suggestion.name, suggestion.name);
}

/**
 * Saved templates first, newest at the top, then repeated meals that are not
 * already one of those. Pass one person's meals and templates.
 */
export function mealOffers(templates: MealTemplate[], meals: Meal[], today: string): MealOffer[] {
  const covered = new Set<string>();
  for (const template of templates) {
    if (template.sourceKey) covered.add(template.sourceKey);
    const key = mealKey(template.name);
    if (key) covered.add(key);
  }
  const saved: MealOffer[] = templates.map((template) => ({
    id: template.id,
    saved: true,
    name: template.name,
    meal: template.meal,
    items: template.items.map((item) => ({ ...item })),
    macros: copyMacros(template.macros),
    assumptions: template.assumptions,
    sourceKey: template.sourceKey,
  }));
  const repeated: MealOffer[] = [];
  for (const suggestion of commonMeals(meals, today)) {
    const sourceKey = mealKey(suggestion.name);
    if (!sourceKey || covered.has(sourceKey)) continue;
    repeated.push({
      id: `common:${sourceKey}`,
      saved: false,
      name: suggestion.name,
      meal: suggestion.meal,
      items: itemsForCommon(suggestion),
      macros: copyMacros(suggestion.macros),
      assumptions: suggestion.assumptions,
      sourceKey,
    });
  }
  return [...saved, ...repeated];
}
