import {
  MEAL_TEMPLATE_GRAMS_LIMIT,
  MEAL_TEMPLATE_ITEM_LIMIT,
  MEAL_TEMPLATE_ITEMS,
  type Meal,
  type MealTemplateItem,
} from "./domain.ts";
import { ingredientRow, providerSections, sameFood, type Figures } from "./meal-ingredients.ts";
import { splitDishText } from "./dish-split.ts";
import { textOf } from "./drafts.ts";
import {
  ASSUMPTIONS_LIMIT,
  DISH_TEXT_LIMIT,
  ETHANOL_LIMIT,
  FIBER_LIMIT,
  MACRO_LIMITS,
  emptyDish,
  looseDishes,
  type DishDraft,
} from "./meal-dishes.ts";

/*
 * A meal opened up into the items it was made of. Each item has its own
 * figures and, when it was weighed, its grams, which scale those figures. The
 * meal's figures are the items added up, so changing, removing or adding an
 * item changes the meal. The items start from the estimate's own working,
 * which lists every item with its figures in brackets, shared out so that
 * they add up to the figures already on the meal.
 */

const FIGURES = ["calories", "protein", "carbs", "fat", "fiber", "alcohol"] as const;
type Figure = (typeof FIGURES)[number];

/** The box each figure is typed into. Ethanol is the alcohol box, as on a meal. */
export const ITEM_BOX = {
  calories: "calories",
  protein: "protein",
  carbs: "carbs",
  fat: "fat",
  fiber: "fiber",
  alcohol: "ethanol",
} as const satisfies Record<Figure, string>;
export type ItemBox = (typeof ITEM_BOX)[Figure];

/** One item as typed: every box as its text, so a half-typed number survives a draft. */
export type ItemDraft = {
  id: string;
  name: string;
  /** Grams eaten. Blank when the amount lives in the name, as in "2 eggs". */
  grams: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  /** Already part of the carbs. */
  fiber: string;
  /** Ethanol grams, which count only on an Alcohol sitting. */
  ethanol: string;
  /**
   * The figures at a weight, which a new weight scales from. Fixed while the
   * grams move, so sliding to 0 and back loses nothing; typing a figure sets
   * it again at the grams it was typed at. Null until the item has both.
   */
  per: { grams: number; macros: Figures } | null;
};

/** What an item starts from, before it has an id. */
export type ItemSeed = {
  /** The item's name, without a weight that has a box of its own. */
  name: string;
  /** Everything its line said before the figures, weight and all. */
  label: string;
  grams: number;
  /** Null for an item still to be typed in. */
  macros: Figures | null;
  per: { grams: number; macros: Figures } | null;
  /** What the estimate said about how it reached this item's figures. */
  working: string;
};

const ZERO: Figures = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, alcohol: 0 };
const round1 = (value: number) => Math.round(value * 10) / 10;
const clipName = (text: string) => text.trim().slice(0, MEAL_TEMPLATE_ITEM_LIMIT);

/** A summary line of a blend, which has brackets but is not an item. */
const PROVIDER_LINE = /^\s*From (?:Codex|Claude|Grok)\b[^[]*\[/;
/** One person's share of a dish, as a split meal's assumptions give it. */
const SHARE_HEAD = /^\d+(?:\.\d+)?% of /;

type Row = {
  name: string;
  label: string;
  grams: number;
  macros: Figures;
  working: string;
};

/**
 * The items one estimate's working lists, each with what it went on to say
 * about that item: the rest of its line, and the lines under it up to a blank
 * one. A split meal's record lists each share of a dish instead, with the
 * whole dish and that dish's own items under it, so only the shares count.
 */
export function itemBlocks(text: string): Row[] {
  const lines = text.split(/\r?\n/);
  const shared = lines.some((line) => SHARE_HEAD.test(line.trim()));
  const rows: (Row & { lines: string[] })[] = [];
  let open = false;
  for (const line of lines) {
    if (!line.trim() || PROVIDER_LINE.test(line)) {
      open = false;
      continue;
    }
    const row = ingredientRow(line);
    if (row && (!shared || SHARE_HEAD.test(row.label))) {
      rows.push({
        name: shared ? row.label : row.name,
        label: row.label,
        grams: shared ? 0 : row.grams,
        macros: row.macros,
        working: "",
        lines: !shared && row.after ? [row.after] : [],
      });
      open = !shared;
      continue;
    }
    if (open) rows[rows.length - 1].lines.push(line.trim());
  }
  return rows.map(({ lines: said, ...row }) => ({ ...row, working: said.join("\n") }));
}

/**
 * Several estimators' items as one list. The one that counts most gives the
 * list; another that lists the same foods, one for one, is averaged into it
 * by weight. One that listed the meal another way is left out, since its
 * items cannot be told apart, and one that gave it as a single item has no
 * list to give. The grams are the leading list's.
 */
function blendRows(sources: readonly { rows: Row[]; weight: number }[]): Row[] {
  const listed = sources.filter((source) => source.rows.length >= 2);
  if (!listed.length) return [];
  const lead = listed.reduce((best, source) => (source.weight > best.weight ? source : best));
  const partners = listed.flatMap((source) => {
    if (source === lead || source.rows.length !== lead.rows.length) return [];
    const found = lead.rows.map((row) => source.rows.filter((other) => sameFood(row.name, other.name)));
    if (found.some((matches) => matches.length !== 1)) return [];
    const rows = found.map(([match]) => match);
    return new Set(rows).size === rows.length ? [{ rows, weight: source.weight }] : [];
  });
  const group = [lead, ...partners];
  const mass = group.reduce((sum, source) => sum + Math.max(source.weight, 0), 0);
  const share = (weight: number) => (mass > 0 ? Math.max(weight, 0) / mass : 1 / group.length);
  return lead.rows.map((row, index) => ({
    ...row,
    macros: Object.fromEntries(FIGURES.map((key) => [
      key,
      group.reduce((sum, source) => sum + source.rows[index].macros[key] * share(source.weight), 0),
    ])) as Figures,
  }));
}

/**
 * A total shared out in proportion to parts, in tenths, so the shares add up
 * to the total exactly: the tenths left over go to whoever lost most to the
 * rounding. Parts that come to nothing share it by the fallback, and failing
 * that, evenly.
 */
function shareOut(total: number, parts: readonly number[], fallback: readonly number[]) {
  const tenths = Math.round(Math.max(total, 0) * 10);
  if (!parts.length || tenths === 0) return parts.map(() => 0);
  const positive = (list: readonly number[]) => list.map((value) => Math.max(Number.isFinite(value) ? value : 0, 0));
  const by = [positive(parts), positive(fallback), parts.map(() => 1)].find(
    (list) => list.length === parts.length && list.some((value) => value > 0),
  )!;
  const mass = by.reduce((sum, value) => sum + value, 0);
  const exact = by.map((value) => (value / mass) * tenths);
  const shares = exact.map(Math.floor);
  let left = tenths - shares.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, lost: value - shares[index] }))
    .sort((a, b) => b.lost - a.lost || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares.map((value) => value / 10);
}

/**
 * Items in the proportions given, adding up to the totals to a tenth. Fiber
 * and the rest of the carbs are shared out apart, so every item's fiber stays
 * part of its carbs. A figure the items do not account for at all, such as
 * fiber that only another estimator found, follows the carbs for fiber and
 * the calories for the rest.
 */
export function fitItems(portions: readonly Figures[], totals: Figures): Figures[] {
  const column = (key: Figure) => portions.map((portion) => portion[key]);
  const calories = column("calories");
  const plain = Object.fromEntries((["calories", "protein", "fat", "alcohol"] as const).map((key) => [
    key,
    shareOut(totals[key], column(key), calories),
  ])) as Record<"calories" | "protein" | "fat" | "alcohol", number[]>;
  const fiber = shareOut(totals.fiber, column("fiber"), column("carbs"));
  const net = shareOut(
    Math.max(totals.carbs - totals.fiber, 0),
    portions.map((portion) => portion.carbs - portion.fiber),
    calories,
  );
  return portions.map((_, index) => ({
    calories: plain.calories[index],
    protein: plain.protein[index],
    carbs: round1(fiber[index] + net[index]),
    fat: plain.fat[index],
    fiber: fiber[index],
    alcohol: plain.alcohol[index],
  }));
}

/**
 * The items an estimate's working breaks the meal into, shared out to add up
 * to the totals. Fewer than two is not a breakdown, and more than a meal can
 * keep is not one either.
 */
export function breakdown(
  sources: readonly { assumptions: string; weight: number }[],
  totals: Figures,
): ItemSeed[] {
  const rows = blendRows(sources.map((source) => ({ rows: itemBlocks(source.assumptions), weight: source.weight })));
  if (rows.length < 2 || rows.length > MEAL_TEMPLATE_ITEMS) return [];
  const fitted = fitItems(rows.map((row) => row.macros), totals);
  return rows.map((row, index) => {
    // A weight a meal cannot keep is left in the name instead.
    const grams = row.grams > 0 && row.grams <= MEAL_TEMPLATE_GRAMS_LIMIT ? round1(row.grams) : 0;
    return {
      name: clipName(grams ? row.name : row.label),
      label: row.label,
      grams,
      macros: fitted[index],
      per: grams ? { grams, macros: fitted[index] } : null,
      working: row.working,
    };
  });
}

/** The first line of a meal's item list, which also tells a list from an estimate's working. */
export const ITEM_LIST_HEAD = "Adjusted item by item:";

/**
 * Where a meal's items can be read from. A list written when the items were
 * changed is what they last were; otherwise each estimator's working, with
 * the share of the average each one had.
 */
export function assumptionSources(assumptions: string) {
  if (assumptions.startsWith(ITEM_LIST_HEAD)) {
    const end = assumptions.indexOf("\n\n");
    return [{ assumptions: end < 0 ? assumptions : assumptions.slice(0, end), weight: 1 }];
  }
  return providerSections(assumptions);
}

/**
 * Items saved with the meal, at the grams they are at now. Shared out to add
 * up to the meal's figures, so opening them changes nothing.
 */
export function seedsFromIngredients(items: readonly MealTemplateItem[], totals: Figures): ItemSeed[] {
  if (items.length < 2 || items.length > MEAL_TEMPLATE_ITEMS || !items.every((item) => item.nutrition)) return [];
  const references = items.map((item) => {
    const { grams, macros } = item.nutrition!;
    return { grams, macros: Object.fromEntries(FIGURES.map((key) => [key, macros[key] ?? 0])) as Figures };
  });
  const fitted = fitItems(
    items.map((item, index) => {
      const { grams, macros } = references[index];
      const scale = grams ? item.grams / grams : 1;
      return Object.fromEntries(FIGURES.map((key) => [key, macros[key] * scale])) as Figures;
    }),
    totals,
  );
  return items.map((item, index) => ({
    name: clipName(item.name),
    label: item.name,
    grams: item.grams > 0 ? round1(item.grams) : 0,
    macros: fitted[index],
    per: references[index].grams > 0 ? references[index] : null,
    working: "",
  }));
}

/** A meal with no figures yet, as items to type in: cut where it was written as several, including on "and". */
export function blankSeeds(description: string): ItemSeed[] {
  const parts = splitDishText(description, MEAL_TEMPLATE_ITEMS, true);
  if (parts.length < 2) return [];
  return parts.map((part) => ({ name: clipName(part), label: part, grams: 0, macros: null, per: null, working: "" }));
}

export function itemDraft(id: string, seed: ItemSeed): ItemDraft {
  const box = (key: Figure) => (seed.macros ? String(seed.macros[key]) : "");
  return {
    id,
    name: seed.name,
    grams: seed.grams > 0 ? String(seed.grams) : "",
    calories: box("calories"),
    protein: box("protein"),
    carbs: box("carbs"),
    fat: box("fat"),
    fiber: box("fiber"),
    ethanol: box("alcohol"),
    per: seed.per,
  };
}

export function emptyItem(id: string): ItemDraft {
  return itemDraft(id, { name: "", label: "", grams: 0, macros: null, per: null, working: "" });
}

/** A box as a number. Blank is 0; NaN is something that is not a number at all. */
function amount(text: string) {
  const typed = text.trim();
  return typed === "" ? 0 : Number(typed);
}

const usable = (value: number) => (Number.isFinite(value) && value >= 0 ? value : 0);

/** An item's figures as far as they read: anything unreadable counts as nothing. */
export function looseFigures(item: ItemDraft): Figures {
  return Object.fromEntries(FIGURES.map((key) => [key, usable(amount(item[ITEM_BOX[key]]))])) as Figures;
}

/** The grams box as a weight, or null while it does not read as one. */
function readGrams(text: string) {
  const grams = amount(text);
  return Number.isFinite(grams) && grams >= 0 && grams <= MEAL_TEMPLATE_GRAMS_LIMIT ? grams : null;
}

/** A figure typed in: the item now holds these figures at the grams it is at. */
export function setItemFigure(item: ItemDraft, box: ItemBox, text: string): ItemDraft {
  const next = { ...item, [box]: text };
  const grams = readGrams(next.grams);
  return { ...next, per: grams ? { grams, macros: looseFigures(next) } : null };
}

/**
 * A new weight. A weighed item's figures scale with it, from the weight they
 * were given at. One with no figures at that weight yet just takes the number;
 * leaving the box (anchorItem) is what ties its figures to it, so typing
 * "150" a digit at a time does not scale them at 1 and again at 15.
 */
export function setItemGrams(item: ItemDraft, text: string): ItemDraft {
  const next = { ...item, grams: text };
  const grams = readGrams(text);
  if (grams === null || !item.per) return next;
  const scale = grams / item.per.grams;
  const scaled = Object.fromEntries(FIGURES.map((key) => [key, round1(item.per!.macros[key] * scale)])) as Figures;
  return {
    ...next,
    ...Object.fromEntries(FIGURES.map((key) => [ITEM_BOX[key], String(scaled[key])])),
  };
}

/** The grams box was left: the figures there are what that weight holds. */
export function anchorItem(item: ItemDraft): ItemDraft {
  if (item.per) return item;
  const grams = readGrams(item.grams);
  return grams ? { ...item, per: { grams, macros: looseFigures(item) } } : item;
}

/**
 * The meal's boxes, as the items add up: to a tenth, and blank where every
 * item's box is blank, so a meal still being typed in does not fill with 0s.
 */
export function itemTotals(items: readonly ItemDraft[]): Record<ItemBox, string> {
  return Object.fromEntries(FIGURES.map((key) => {
    const box = ITEM_BOX[key];
    if (items.every((item) => item[box].trim() === "")) return [box, ""];
    const tenths = items.reduce((sum, item) => sum + Math.round(usable(amount(item[box])) * 10), 0);
    return [box, String(tenths / 10)];
  })) as Record<ItemBox, string>;
}

/** Every item, held to what a meal's items are held to, or the first thing wrong with one. */
export function readItems(
  drafts: readonly ItemDraft[],
  sitting: Meal["meal"],
): { ok: true; items: MealTemplateItem[] } | { ok: false; error: string } {
  if (!drafts.length) return { ok: false, error: "Add an item." };
  if (drafts.length > MEAL_TEMPLATE_ITEMS)
    return { ok: false, error: `A meal holds up to ${MEAL_TEMPLATE_ITEMS} items.` };
  const items: MealTemplateItem[] = [];
  for (const [index, draft] of drafts.entries()) {
    const label = `Item ${index + 1}`;
    const name = draft.name.trim();
    if (!name) return { ok: false, error: `Name item ${index + 1}.` };
    if (name.length > MEAL_TEMPLATE_ITEM_LIMIT) return { ok: false, error: `${label}: the name is too long.` };
    const grams = amount(draft.grams);
    if (!Number.isFinite(grams) || grams < 0)
      return { ok: false, error: `${label}: Grams need a number of zero or more.` };
    if (grams > MEAL_TEMPLATE_GRAMS_LIMIT)
      return { ok: false, error: `${label}: Grams need a number up to ${MEAL_TEMPLATE_GRAMS_LIMIT}.` };
    const macros = { ...ZERO };
    for (const [key, field] of [
      ["calories", "Calories"],
      ["protein", "Protein"],
      ["carbs", "Carbs"],
      ["fat", "Fat"],
    ] as const) {
      const value = amount(draft[key]);
      if (!Number.isFinite(value) || value < 0)
        return { ok: false, error: `${label}: ${field} needs a number of zero or more.` };
      if (value > MACRO_LIMITS[key]) return { ok: false, error: `${label}: ${field} looks too high.` };
      macros[key] = value;
    }
    const fiber = amount(draft.fiber);
    if (!Number.isFinite(fiber) || fiber < 0)
      return { ok: false, error: `${label}: Fiber needs a number of zero or more.` };
    if (fiber > FIBER_LIMIT) return { ok: false, error: `${label}: Fiber looks too high.` };
    if (fiber > macros.carbs)
      return { ok: false, error: `${label}: Fiber is part of total carbs, so it cannot be higher.` };
    macros.fiber = fiber;
    if (sitting === "Alcohol") {
      const ethanol = amount(draft.ethanol);
      if (!Number.isFinite(ethanol) || ethanol < 0)
        return { ok: false, error: `${label}: Ethanol needs a number of zero or more.` };
      if (ethanol > ETHANOL_LIMIT) return { ok: false, error: `${label}: Ethanol looks too high.` };
      macros.alcohol = ethanol;
    }
    const weight = round1(grams);
    // The figures are kept at the grams the item is at, so a template made
    // from it scales from exactly what was logged.
    items.push({ name, grams: weight, nutrition: { grams: weight, macros } });
  }
  return { ok: true, items };
}

/**
 * The items as far as they read, for a list written while one may still be
 * half-typed: anything unreadable counts as nothing, and an unnamed item is
 * called by its place.
 */
export function looseItems(drafts: readonly ItemDraft[], sitting: Meal["meal"]): MealTemplateItem[] {
  return drafts.map((draft, index) => {
    const grams = Math.min(round1(usable(amount(draft.grams))), MEAL_TEMPLATE_GRAMS_LIMIT);
    const macros = looseFigures(draft);
    return {
      name: clipName(draft.name) || `Item ${index + 1}`,
      grams,
      nutrition: {
        grams,
        macros: {
          ...macros,
          fiber: Math.min(macros.fiber, macros.carbs),
          alcohol: sitting === "Alcohol" ? macros.alcohol : 0,
        },
      },
    };
  });
}

/** An item's figures to a tenth, in the brackets the estimator writes them in. */
function figuresOf(macros: Meal["macros"]) {
  return `[${[
    `${round1(macros.calories)} kcal`,
    `${round1(macros.protein)}P`,
    `${round1(macros.carbs)}C`,
    `${round1(macros.fat)}F`,
    ...(macros.fiber ? [`${round1(macros.fiber)} fiber`] : []),
    ...(macros.alcohol ? [`${round1(macros.alcohol)} ethanol`] : []),
  ].join(", ")}]`;
}

/** A list written before, which a new one replaces rather than stacks on. */
export function withoutItemList(assumptions: string) {
  if (!assumptions.startsWith(ITEM_LIST_HEAD)) return assumptions;
  const end = assumptions.indexOf("\n\n");
  return end < 0 ? "" : assumptions.slice(end + 2);
}

/** Whole paragraphs first: cut at the last blank line that fits, else mid-text. */
function shorten(text: string, max: number) {
  if (text.length <= max) return text;
  if (max < 2) return "";
  const cut = text.lastIndexOf("\n\n", max - 1);
  return `${(cut > 0 ? text.slice(0, cut) : text.slice(0, max - 1)).trimEnd()}…`;
}

/**
 * The meal's assumptions once its items were changed: the items as they are
 * now, each line written the way the estimator writes one, then what the
 * estimate said, cut to fit. A reply to the estimate reads the list, and so
 * does opening the items again.
 */
export function withItemList(assumptions: string, items: readonly MealTemplateItem[]) {
  const list = [
    ITEM_LIST_HEAD,
    ...items.map((item) => {
      const grams = item.grams > 0 ? `, ${round1(item.grams)} g` : "";
      return `${item.name}${grams} ${figuresOf(item.nutrition?.macros ?? ZERO)}`;
    }),
  ].join("\n").slice(0, ASSUMPTIONS_LIMIT);
  const rest = withoutItemList(assumptions).trim();
  const room = ASSUMPTIONS_LIMIT - list.length - 2;
  return rest && room > 1 ? `${list}\n\n${shorten(rest, room)}` : list;
}

/** Items from a draft. One damaged in storage keeps what still reads as an item. */
export function itemDraftsOf(value: unknown): ItemDraft[] {
  if (!Array.isArray(value)) return [];
  const items: ItemDraft[] = [];
  for (const entry of value) {
    if (items.length >= MEAL_TEMPLATE_ITEMS) break;
    if (!entry || typeof entry !== "object") continue;
    const held = entry as Record<string, unknown>;
    if (typeof held.id !== "string" || !held.id) continue;
    const per = held.per as { grams?: unknown; macros?: Record<string, unknown> } | null | undefined;
    const reference = per && typeof per.grams === "number" && per.grams > 0 && per.macros &&
      FIGURES.every((key) => typeof per.macros![key] === "number")
      ? { grams: per.grams, macros: Object.fromEntries(FIGURES.map((key) => [key, per.macros![key]])) as Figures }
      : null;
    items.push({
      id: held.id,
      name: textOf(held.name, ""),
      grams: textOf(held.grams, ""),
      calories: textOf(held.calories, ""),
      protein: textOf(held.protein, ""),
      carbs: textOf(held.carbs, ""),
      fat: textOf(held.fat, ""),
      fiber: textOf(held.fiber, ""),
      ethanol: textOf(held.ethanol, ""),
      per: reference,
    });
  }
  return items;
}

/**
 * A shared dish opened up into its items, each a dish of its own with the
 * share the dish had, so one of you can have all of one item. Each keeps the
 * estimate's footing and its own part of the working, and a weighed item is
 * counted in grams, so it shares a gram at a time. None when the dish's
 * working does not list two or more items.
 */
export function expandDish(dish: DishDraft, sitting: Meal["meal"], id: () => string): DishDraft[] {
  const [read] = looseDishes([dish], sitting);
  const seeds = breakdown(assumptionSources(dish.assumptions), {
    ...read.macros,
    fiber: Math.min(read.macros.fiber, read.macros.carbs),
  });
  return seeds.map((seed) => {
    const macros = seed.macros ?? ZERO;
    return {
      ...emptyDish(id()),
      name: seed.label.slice(0, DISH_TEXT_LIMIT),
      calories: String(macros.calories),
      protein: String(macros.protein),
      carbs: String(macros.carbs),
      fat: String(macros.fat),
      fiber: String(macros.fiber),
      ethanol: String(macros.alcohol),
      quantity: seed.grams > 0 ? `${seed.grams} g` : "",
      share: { ...dish.share },
      source: dish.source,
      estimator: dish.estimator,
      confidence: dish.confidence,
      adjusted: dish.adjusted,
      assumptions: seed.working,
    };
  });
}
