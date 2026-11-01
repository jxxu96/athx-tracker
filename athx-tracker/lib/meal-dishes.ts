import { ATHLETES, ESTIMATORS, type Estimator, type Macros, type Meal } from "./domain.ts";
import type { MealEstimate } from "./estimate-conversation.ts";
import type { MealDraftIds } from "./meal-fanout.ts";
import { bothOf, isText, oneOf, textOf } from "./drafts.ts";
import { splitDishText } from "./dish-split.ts";

/*
 * A meal the two of you shared, written down dish by dish. Each dish has its
 * own figures and a share for each of you, as percentages of that dish that
 * add up to 100: typing one sets the other to the rest, and the slider sets
 * both. Saving writes one meal for each of you holding your share of every
 * dish, so the two meals add up to what was on the table.
 */

export type Eater = "hippos" | "gators";
export const EATERS = ["hippos", "gators"] as const satisfies readonly Eater[];

/** The meal form's own bounds, the same the server holds a meal to. */
export const MACRO_LIMITS: Macros = { calories: 20000, protein: 2000, carbs: 3000, fat: 2000 };
export const ETHANOL_LIMIT = 500;
export const FIBER_LIMIT = 3000;
/** The server's limit on a meal's assumptions. */
export const ASSUMPTIONS_LIMIT = 3000;
/** A meal's name, which a dish's text is clipped to wherever it names something. */
export const MEAL_NAME_LIMIT = 300;
/**
 * What a dish says, which is also what its estimate reads: as long as a meal's
 * description can be, so turning a long description into a dish keeps all of it.
 */
export const DISH_TEXT_LIMIT = 4000;
export const DISH_LIMIT = 20;
/** A dish's quantity box: a number and what it counts, as in "8 slices". */
export const QUANTITY_LIMIT = 40;

const MACROS = [
  { key: "calories", label: "Calories" },
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
] as const satisfies readonly { key: keyof Macros; label: string }[];

type Figure = keyof Macros | "fiber" | "ethanol";
const FIGURES = ["calories", "protein", "carbs", "fat", "fiber", "ethanol"] as const satisfies readonly Figure[];

/** One dish as typed: every box as its text, so a half-typed number survives a draft. */
export type DishDraft = {
  id: string;
  /** What it was. It names the dish, and it is what an estimate reads. */
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  /** Already part of the carbs. */
  fiber: string;
  /** Ethanol grams, which count only on an Alcohol sitting, as on a meal. */
  ethanol: string;
  /**
   * How much the whole dish was, counted: "8 slices", "400 g". Optional. A
   * count lets the slider say how many of them each of you had.
   */
  quantity: string;
  /** Percentages of the dish. Blank counts as 0. */
  share: Record<Eater, string>;
  /** "grok" while the figures are an estimate's as it came back. */
  source: "manual" | "grok";
  estimator: Estimator | null;
  confidence: MealEstimate["confidence"] | null;
  /** An estimate was edited, so the figures are now your own. */
  adjusted: boolean;
  assumptions: string;
};

/** A quantity read as a count: 8 of "slices", 400 of "g", 6 of nothing named. */
export type Count = { amount: number; unit: string };

/** A dish read into numbers. Shares are fractions of the dish, 0 to 1. */
export type Dish = {
  name: string;
  macros: Macros & { alcohol: number; fiber: number };
  /** Present only when the quantity box starts with a number above 0. */
  count?: Count;
  share: Record<Eater, number>;
  source: "manual" | "grok";
  estimator?: Estimator;
  assumptions: string;
};

export function emptyDish(id: string): DishDraft {
  return {
    id,
    name: "",
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
    fiber: "",
    ethanol: "",
    quantity: "",
    share: { hippos: "50", gators: "50" },
    source: "manual",
    estimator: null,
    confidence: null,
    adjusted: false,
    assumptions: "",
  };
}

/** A share box as a percentage. Blank is 0; anything that is not 0 to 100 is null. */
export function readShare(text: string) {
  const typed = text.trim().replace(/\s*%$/, "");
  if (typed === "") return 0;
  const value = Number(typed);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/**
 * What the other share box shows once one is typed: the rest of 100, so the
 * dish is always shared out whole. Null leaves it alone, for saving to point
 * out what was typed.
 */
export function otherShare(text: string) {
  const share = readShare(text);
  if (share === null) return null;
  return String(Math.round((100 - share) * 10000) / 10000);
}

/** One share box typed into, and the other following it. */
export function setShare(dish: DishDraft, eater: Eater, text: string): DishDraft {
  const other = eater === "hippos" ? "gators" : "hippos";
  const rest = otherShare(text);
  return { ...dish, share: { ...dish.share, [eater]: text, ...(rest === null ? {} : { [other]: rest }) } };
}

/**
 * A quantity box as a count: a number above 0 first, then the word for what
 * it counts, if any. "8 slices", "400g" and "6" read; "eight slices", "1/2
 * pizza" and "0 slices" do not, and leave the dish shared by percentage.
 */
export function readQuantity(text: string): Count | null {
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)(?:\s*(\p{L}.*?))?\s*$/u.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  return amount > 0 ? { amount, unit: match[2] ?? "" } : null;
}

/**
 * How many steps the share slider has. A dish of two or more whole units
 * moves a unit at a time, so 8 slices give 8 steps and 400 g gives 400.
 * Anything else moves a percent at a time: one of something would otherwise
 * be all or nothing, and part of a unit is not a step. A share between steps
 * is still typed into the boxes.
 */
export function sliderSteps(quantity: string) {
  const count = readQuantity(quantity);
  return count && Number.isInteger(count.amount) && count.amount >= 2 ? count.amount : 100;
}

/**
 * Where the slider sits: Hippos' share, in its steps. Hippos is the left end
 * and Gators the right. A box that does not read yet leaves it where the
 * other box says, and half each when neither reads.
 */
export function sliderValue(dish: DishDraft) {
  const hippos = readShare(dish.share.hippos);
  const gators = readShare(dish.share.gators);
  const percent = hippos ?? (gators === null ? 50 : 100 - gators);
  return (percent / 100) * sliderSteps(dish.quantity);
}

/** The slider moved: Hippos has that many of its steps, and Gators the rest. */
export function slideShare(dish: DishDraft, value: number): DishDraft {
  const percent = Math.min(100, Math.max(0, (value / sliderSteps(dish.quantity)) * 100));
  return setShare(dish, "hippos", String(Math.round(percent * 10000) / 10000));
}

/** A figure typed into. An estimate's figures stop being the estimate's once one is changed. */
export function setFigure(dish: DishDraft, figure: Figure, text: string): DishDraft {
  const edited = dish.source === "grok";
  return {
    ...dish,
    [figure]: text,
    ...(edited ? { source: "manual" as const, adjusted: true } : {}),
  };
}

/** An estimate's answer on the dish. The name stays as typed: it is what was estimated. */
export function fillDish(dish: DishDraft, estimate: MealEstimate, provider?: Estimator): DishDraft {
  return {
    ...dish,
    calories: String(estimate.calories),
    protein: String(estimate.protein),
    carbs: String(estimate.carbs),
    fat: String(estimate.fat),
    fiber: String(estimate.fiber ?? 0),
    ethanol: String(estimate.alcohol ?? 0),
    assumptions: estimate.assumptions,
    confidence: estimate.confidence,
    estimator: provider && provider in ESTIMATORS ? provider : null,
    source: "grok",
    adjusted: false,
  };
}

/**
 * How the phone cut a description into dishes, sent with its estimate so the
 * estimator keeps that cut where it can, and every estimator asked cuts it
 * the same way. Never more than the server takes.
 */
export function dishHint(text: string) {
  const parts = splitDishText(text, DISH_LIMIT);
  return parts.length && parts.join("").length <= DISH_TEXT_LIMIT ? parts : [text.slice(0, DISH_TEXT_LIMIT)];
}

/**
 * The dishes an estimate came back with, each with its own figures, working
 * and confidence, shared half and half to start. Re-estimating a dish keeps
 * how it was shared: answered as one dish, it keeps its own words and its
 * count; answered as several, each takes its share, and the count, which was
 * for all of it, is left off. An estimator from before dishes answers for the
 * whole meal, which becomes one dish named after what was described.
 */
export function dishesFromEstimate(
  estimate: MealEstimate,
  provider: Estimator | undefined,
  id: () => string,
  from?: DishDraft,
  text = "",
): DishDraft[] {
  const answers = estimate.dishes ?? [];
  if (!answers.length) return [fillDish(from ?? { ...emptyDish(id()), name: text || estimate.name }, estimate, provider)];
  if (from && answers.length === 1) return [fillDish(from, answers[0], provider)];
  return answers.map((answer) =>
    fillDish({ ...emptyDish(id()), name: answer.name, ...(from ? { share: from.share } : {}) }, answer, provider),
  );
}

/** A box as a number. Blank is 0; NaN is something that is not a number at all. */
function amount(text: string) {
  const typed = text.trim();
  return typed === "" ? 0 : Number(typed);
}

const usable = (value: number) => (Number.isFinite(value) && value >= 0 ? value : 0);

function withCount(quantity: string): { count?: Count } {
  const count = readQuantity(quantity);
  return count ? { count } : {};
}

/**
 * The dishes as far as they can be read, for the shares shown as you type:
 * anything unreadable counts as nothing. Saving reads them strictly instead.
 */
export function looseDishes(drafts: readonly DishDraft[], sitting: Meal["meal"]): Dish[] {
  return drafts.map((draft) => ({
    name: draft.name.trim(),
    ...withCount(draft.quantity),
    macros: {
      calories: usable(amount(draft.calories)),
      protein: usable(amount(draft.protein)),
      carbs: usable(amount(draft.carbs)),
      fat: usable(amount(draft.fat)),
      fiber: usable(amount(draft.fiber)),
      alcohol: sitting === "Alcohol" ? usable(amount(draft.ethanol)) : 0,
    },
    share: {
      hippos: (readShare(draft.share.hippos) ?? 0) / 100,
      gators: (readShare(draft.share.gators) ?? 0) / 100,
    },
    source: draft.source,
    ...(draft.estimator ? { estimator: draft.estimator } : {}),
    assumptions: draft.assumptions.trim(),
  }));
}

/** Every dish, held to what a meal is held to, or the first thing wrong with one. */
export function readDishes(
  drafts: readonly DishDraft[],
  sitting: Meal["meal"],
): { ok: true; dishes: Dish[] } | { ok: false; error: string } {
  if (!drafts.length) return { ok: false, error: "Add a dish." };
  if (drafts.length > DISH_LIMIT) return { ok: false, error: `A meal holds up to ${DISH_LIMIT} dishes.` };
  const dishes = looseDishes(drafts, sitting);
  for (const [index, draft] of drafts.entries()) {
    const dish = `Dish ${index + 1}`;
    if (!draft.name.trim()) return { ok: false, error: `Name dish ${index + 1}.` };
    if (draft.name.trim().length > DISH_TEXT_LIMIT) return { ok: false, error: `${dish}: the description is too long.` };
    if (sitting === "Alcohol") {
      const ethanol = amount(draft.ethanol);
      if (!Number.isFinite(ethanol) || ethanol < 0)
        return { ok: false, error: `${dish}: Ethanol needs a number of zero or more.` };
      if (ethanol > ETHANOL_LIMIT) return { ok: false, error: `${dish}: Ethanol looks too high.` };
    }
    for (const { key, label } of MACROS) {
      const value = amount(draft[key]);
      if (!Number.isFinite(value) || value < 0)
        return { ok: false, error: `${dish}: ${label} needs a number of zero or more.` };
      if (value > MACRO_LIMITS[key]) return { ok: false, error: `${dish}: ${label} looks too high.` };
    }
    const fiber = amount(draft.fiber);
    if (!Number.isFinite(fiber) || fiber < 0)
      return { ok: false, error: `${dish}: Fiber needs a number of zero or more.` };
    if (fiber > FIBER_LIMIT) return { ok: false, error: `${dish}: Fiber looks too high.` };
    if (fiber > amount(draft.carbs))
      return { ok: false, error: `${dish}: Fiber is part of total carbs, so it cannot be higher.` };
    const { calories, protein, carbs, fat, alcohol } = dishes[index].macros;
    if (calories === 0 && protein === 0 && carbs === 0 && fat === 0 && alcohol === 0)
      return { ok: false, error: `${dish} needs at least one macro value.` };
    const hippos = readShare(draft.share.hippos);
    const gators = readShare(draft.share.gators);
    if (hippos === null || gators === null)
      return { ok: false, error: `${dish}: a share is a percentage from 0 to 100.` };
    if (Math.abs(hippos + gators - 100) > 1e-6)
      return { ok: false, error: `${dish}: the two shares have to add up to 100%.` };
  }
  return { ok: true, dishes };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** One person's share of every dish, to a tenth, as a meal's figures are. */
export function shareTotals(dishes: readonly Dish[], eater: Eater): Meal["macros"] {
  const sum = (key: keyof Dish["macros"]) =>
    dishes.reduce((total, dish) => total + dish.macros[key] * dish.share[eater], 0);
  const carbs = round(sum("carbs"));
  return {
    calories: round(sum("calories")),
    protein: round(sum("protein")),
    carbs,
    fat: round(sum("fat")),
    alcohol: round(sum("alcohol")),
    // Each dish's fiber is within its carbs, so the share's is too; this only
    // stops rounding from saying otherwise.
    fiber: Math.min(round(sum("fiber")), carbs),
  };
}

function hasAny(macros: Meal["macros"]) {
  return macros.calories > 0 || macros.protein > 0 || macros.carbs > 0 || macros.fat > 0 || (macros.alcohol ?? 0) > 0;
}

/** Who gets a meal out of these dishes: anyone whose share comes to something. */
export function eatersOf(dishes: readonly Dish[], eaters: readonly Eater[]) {
  return eaters.filter((eater) => hasAny(shareTotals(dishes, eater)));
}

/** A figure in brackets, the way the estimator writes each item's: [352 kcal, 14P, 40C, 12F]. */
export function bracketed(macros: Meal["macros"]) {
  return `[${[
    `${Math.round(macros.calories)} kcal`,
    `${Math.round(macros.protein)}P`,
    `${Math.round(macros.carbs)}C`,
    `${Math.round(macros.fat)}F`,
    ...(macros.fiber ? [`${Math.round(macros.fiber)} fiber`] : []),
    ...(macros.alcohol ? [`${Math.round(macros.alcohol)} ethanol`] : []),
  ].join(", ")}]`;
}

/** A share as a percentage to a tenth: 40, 33.3. */
export function percent(fraction: number) {
  return String(Math.round(fraction * 1000) / 10);
}

/** A share of a count, to a hundredth: "3 of 8 slices", "150 of 400 g", "2 of 6". */
export function countShare(count: Count, fraction: number) {
  const part = Math.round(count.amount * fraction * 100) / 100;
  return `${part} of ${count.amount}${count.unit ? ` ${count.unit}` : ""}`;
}

/**
 * One person's part of a dish, as the slider shows it: the percentage on the
 * bar, then under it the calories and, when the dish is counted, how many.
 */
export function portionOf(dish: Dish, eater: Eater) {
  const share = dish.share[eater];
  return {
    percent: `${percent(share)}%`,
    calories: Math.round(dish.macros.calories * share),
    count: dish.count ? countShare(dish.count, share) : "",
  };
}

/**
 * A share box as it reads while nobody is typing in it: to a tenth, so the
 * slider's third shows 33.3 rather than the 33.3333 it keeps. Anything that
 * is not a share yet shows as typed.
 */
export function tidyShare(text: string) {
  const share = readShare(text);
  return share === null || text.trim() === "" ? text : percent(share / 100);
}

/** A dish's text where it names something: a meal, or a line of the assumptions. */
function clip(text: string, max = MEAL_NAME_LIMIT) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Whole paragraphs first: cut at the last blank line that fits, else mid-text. */
function shorten(text: string, max: number) {
  if (text.length <= max) return text;
  if (max < 2) return "";
  const cut = text.lastIndexOf("\n\n", max - 1);
  return `${(cut > 0 ? text.slice(0, cut) : text.slice(0, max - 1)).trimEnd()}…`;
}

/**
 * What one person's meal says it was: their share of each dish, then the whole
 * dish and how its figures were reached, in the room a meal's assumptions have.
 * The shares come first and are kept whole; each dish's own working is cut to fit.
 */
export function shareAssumptions(dishes: readonly Dish[], eater: Eater) {
  const blocks = dishes
    .filter((dish) => dish.share[eater] > 0)
    .map((dish) => {
      const whole = dish.share[eater] >= 1;
      const yours = whole ? dish.macros : shareTotals([dish], eater);
      const counted = dish.count ? ` (${countShare(dish.count, dish.share[eater])})` : "";
      const head = [
        `${percent(dish.share[eater])}% of ${clip(dish.name)}${counted} ${bracketed(yours)}`,
        ...(whole ? [] : [`The whole dish ${bracketed(dish.macros)}`]),
      ].join("\n");
      return { head, working: dish.assumptions };
    });
  const fixed = blocks.reduce((length, block) => length + block.head.length, 0) + Math.max(0, blocks.length - 1) * 2;
  const explained = blocks.filter((block) => block.working);
  const room = explained.length
    ? Math.floor((ASSUMPTIONS_LIMIT - fixed) / explained.length) - 1
    : 0;
  const text = blocks
    .map((block) => {
      const working = block.working && room > 0 ? shorten(block.working, room) : "";
      return working ? `${block.head}\n${working}` : block.head;
    })
    .join("\n\n");
  return shorten(text, ASSUMPTIONS_LIMIT);
}

/** One person's meal is named after their dishes when no name is typed. */
export function shareName(dishes: readonly Dish[], eater: Eater) {
  return clip(dishes.filter((dish) => dish.share[eater] > 0).map((dish) => dish.name).join(", "));
}

/**
 * The meals a shared meal saves: one for each person whose share comes to
 * something, with the same day, time and sitting. The ids come from the
 * caller and stay the same for the life of the draft, so a retry upserts the
 * person who already landed instead of adding a second copy. A meal reads as
 * estimated when every dish in it was estimated and left alone, and names its
 * estimator when they all had the same one.
 */
export function splitMeal(input: {
  eaters: readonly Eater[];
  meal: Pick<Meal, "kind" | "day" | "time" | "meal">;
  name: string;
  dishes: readonly Dish[];
  ids: MealDraftIds;
}): { ok: true; meals: Meal[] } | { ok: false; error: string } {
  const eaters = eatersOf(input.dishes, input.eaters);
  if (!eaters.length)
    return {
      ok: false,
      error: input.eaters.length === 1
        ? `${ATHLETES[input.eaters[0]].name} has no share of these dishes.`
        : "Neither of you has a share of these dishes.",
    };
  const meals: Meal[] = [];
  for (const eater of eaters) {
    const macros = shareTotals(input.dishes, eater);
    for (const { key, label } of MACROS) {
      if (macros[key] > MACRO_LIMITS[key])
        return { ok: false, error: `${ATHLETES[eater].name}' share: ${label} looks too high.` };
    }
    if ((macros.alcohol ?? 0) > ETHANOL_LIMIT)
      return { ok: false, error: `${ATHLETES[eater].name}' share: Ethanol looks too high.` };
    if ((macros.fiber ?? 0) > FIBER_LIMIT)
      return { ok: false, error: `${ATHLETES[eater].name}' share: Fiber looks too high.` };
    const mine = input.dishes.filter((dish) => dish.share[eater] > 0);
    const estimated = mine.every((dish) => dish.source === "grok");
    const estimators = new Set(mine.map((dish) => dish.estimator));
    const [estimator] = estimators;
    meals.push({
      kind: input.meal.kind,
      day: input.meal.day,
      ...(input.meal.time ? { time: input.meal.time } : {}),
      meal: input.meal.meal,
      id: input.ids[eater],
      athlete: eater,
      name: input.name.trim().slice(0, MEAL_NAME_LIMIT) || shareName(input.dishes, eater),
      macros,
      source: estimated ? "grok" : "manual",
      ...(estimated && estimators.size === 1 && estimator ? { estimator } : {}),
      assumptions: shareAssumptions(input.dishes, eater),
    });
  }
  return { ok: true, meals };
}

/**
 * Dishes from a draft. A draft written by an older form has none, and one
 * damaged in storage keeps what still reads as a dish.
 */
export function dishesOf(value: unknown): DishDraft[] {
  if (!Array.isArray(value)) return [];
  const dishes: DishDraft[] = [];
  for (const item of value) {
    if (dishes.length >= DISH_LIMIT) break;
    if (!item || typeof item !== "object") continue;
    const held = item as Record<string, unknown>;
    if (typeof held.id !== "string" || !held.id) continue;
    const blank = emptyDish(held.id);
    const figures = Object.fromEntries(
      FIGURES.map((figure) => [figure, textOf(held[figure], "")]),
    ) as Record<Figure, string>;
    dishes.push({
      ...blank,
      ...figures,
      name: textOf(held.name, ""),
      // Drafts from before quantities have none.
      quantity: textOf(held.quantity, ""),
      share: bothOf(held.share, isText) ?? blank.share,
      source: oneOf(held.source, ["manual", "grok"] as const) ?? "manual",
      estimator: oneOf(held.estimator, Object.keys(ESTIMATORS) as Estimator[]) ?? null,
      confidence: oneOf(held.confidence, ["low", "medium", "high"] as const) ?? null,
      adjusted: held.adjusted === true,
      assumptions: textOf(held.assumptions, ""),
    });
  }
  return dishes;
}
