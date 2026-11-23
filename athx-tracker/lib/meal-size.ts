import { MEAL_TEMPLATE_GRAMS_LIMIT, type MealTemplateItem } from "./domain.ts";
import {
  SCALE_MAX,
  SCALE_MIN,
  scaleDish,
  type DishDraft,
  type DishScale,
  type Figure,
  type FigureTexts,
} from "./meal-dishes.ts";
import { amountOf, leftOut, withAmount } from "./meal-ingredients.ts";
import { ITEM_LIST_HEAD, anchorItem, scaleItem, setItemGrams, type ItemDraft } from "./meal-items.ts";

/*
 * A whole meal made bigger or smaller with the same bar a dish has. It
 * resizes whatever the meal is made of: a split meal's dishes, together; a
 * single meal's weighed ingredients, or its items once it is opened up into
 * them; and otherwise the meal's own figures, kept at 100% as a dish's are.
 */

const FIGURES = ["calories", "protein", "carbs", "fat", "fiber", "ethanol"] as const satisfies readonly Figure[];

/** A box as a number. Blank is 0; NaN is something that is not a number at all. */
function amount(text: string) {
  const typed = text.trim();
  return typed === "" ? 0 : Number(typed);
}

const usable = (value: number) => (Number.isFinite(value) && value >= 0 ? value : 0);
/** Clear of floating-point dust, so a dish sized back to 100% is at 100% and says nothing. */
const tidy = (percent: number) => Math.round(percent * 10000) / 10000;
const within = (percent: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, percent));

/** A size the bar takes: the same as a dish's. */
export function isSize(percent: number) {
  return Number.isFinite(percent) && percent >= SCALE_MIN && percent <= SCALE_MAX;
}

/** Figures shown at a size, as the size they make at 100%. Anything unreadable counts as nothing. */
export function scaleAt(texts: FigureTexts, percent: number): DishScale {
  return {
    percent,
    base: Object.fromEntries(FIGURES.map((figure) => [figure, (usable(amount(texts[figure])) * 100) / percent])) as
      Record<Figure, number>,
  };
}

/**
 * How big a split meal is: each dish's size, weighed by its calories at
 * 100%, so the bar sits at 100% until something is resized, and follows a
 * dish resized or estimated on its own. full is those calories added up,
 * what the meal comes to with every dish at 100%. A dish whose calories box
 * does not read weighs nothing; with no calories anywhere yet, every dish
 * counts the same.
 */
export function tableSize(dishes: readonly DishDraft[]): { percent: number; full: number } {
  if (!dishes.length) return { percent: 100, full: 0 };
  const parts = dishes.map((dish) => {
    const typed = amount(dish.calories);
    const reads = dish.calories.trim() !== "" && Number.isFinite(typed) && typed >= 0;
    return { size: dish.scale?.percent ?? 100, full: reads ? (dish.scale ? dish.scale.base.calories : typed) : 0 };
  });
  const full = parts.reduce((sum, part) => sum + part.full, 0);
  const percent = full > 0
    ? parts.reduce((sum, part) => sum + part.full * part.size, 0) / full
    : parts.reduce((sum, part) => sum + part.size, 0) / parts.length;
  return { percent: tidy(percent), full };
}

/**
 * Every dish resized by the same ratio, so the meal comes to the size asked
 * and each dish keeps its size against the others: one already at half of
 * what it was stays at half of the rest. No dish goes past what a dish's own
 * size can be. A size the bar cannot take changes nothing.
 */
export function sizeTable(dishes: readonly DishDraft[], percent: number): DishDraft[] {
  if (!isSize(percent)) return dishes as DishDraft[];
  const from = tableSize(dishes).percent;
  if (from <= 0 || percent === from) return dishes as DishDraft[];
  const ratio = percent / from;
  return dishes.map((dish) => scaleDish(dish, within(tidy((dish.scale?.percent ?? 100) * ratio))));
}

/**
 * Where a resize starts from: the parts as they were when the bar first
 * moved them, at the size it was then, and what the bar last made of them.
 * Each resize works from that start rather than from what the last one
 * left, so a meal taken to 1% and back is what it was: 125 g at 1% rounds
 * to 1.3 g, and 3 g of oil to nothing, which would otherwise stay out.
 */
export type SizeStart = { percent: number; parts: readonly unknown[]; made: readonly unknown[] };

/**
 * The start for a resize of these parts: the one kept while the parts are
 * still what the bar made, else the parts as they are now, at this size,
 * since something else changed them.
 */
export function startOf<T>(start: SizeStart | null, parts: readonly T[], percent: number) {
  return start && start.made === parts
    ? { percent: start.percent, parts: start.parts as readonly T[] }
    : { percent, parts };
}

/**
 * Weighed ingredients resized by a ratio: each one's grams, or how many of a
 * counted one, so the meal's figures follow from them as they do from the
 * ingredients' own sliders. An option slid to zero stays out.
 */
export function sizeIngredients<T extends MealTemplateItem>(items: readonly T[], ratio: number): T[] {
  if (!Number.isFinite(ratio) || ratio <= 0) return [...items];
  return items.map((item) => item.nutrition && !leftOut(item)
    ? withAmount(item, Math.min(MEAL_TEMPLATE_GRAMS_LIMIT, amountOf(item) * ratio))
    : item);
}

/**
 * Items resized by a ratio: a weighed one by its grams, which its figures
 * follow, and any other by its own size, as its own bar would. One weighed
 * at zero stays at zero.
 */
export function sizeItems(items: readonly ItemDraft[], ratio: number): ItemDraft[] {
  if (!Number.isFinite(ratio) || ratio <= 0) return [...items];
  return items.map((item) => {
    const weighed = anchorItem(item);
    if (!weighed.per) return scaleItem(item, within(tidy((item.scale?.percent ?? 100) * ratio)));
    const grams = amount(weighed.grams);
    if (!Number.isFinite(grams) || grams <= 0) return weighed;
    return setItemGrams(weighed, String(Math.round(Math.min(MEAL_TEMPLATE_GRAMS_LIMIT, grams * ratio) * 10) / 10));
  });
}

/**
 * A resized meal says so, and what 100% was, since its working was written
 * for 100%, as a resized dish does. It comes after the list of items when
 * there is one, which has to stay first, and is first otherwise. No
 * brackets: a line in brackets reads as one of the meal's items.
 */
export function sizedAssumptions(assumptions: string, percent: number, full: number) {
  if (Math.round(percent * 10) === 1000) return assumptions;
  const note = `Scaled to ${Math.round(percent * 10) / 10}% of ${Math.round(full)} kcal.`;
  const text = assumptions.trim();
  if (!text) return note;
  if (!text.startsWith(ITEM_LIST_HEAD)) return `${note}\n\n${text}`;
  const end = text.indexOf("\n\n");
  return end < 0 ? `${text}\n\n${note}` : `${text.slice(0, end)}\n\n${note}\n\n${text.slice(end + 2)}`;
}
