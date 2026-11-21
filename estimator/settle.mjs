/**
 * Checking an answer before the app sees it, and settling several answers
 * into one meal: who counts, by how much, and what the header says.
 */
import { COMPLEX_ITEMS, WEIGHTS } from "./config.mjs";
import { DISH_LIMIT } from "./prompts.mjs";

/**
 * A meal's name without the figures an item line carries. Told to start each
 * item with its name, portion and macros in brackets, Claude has named a whole
 * meal with its first item line, "Zorbly Oat Bar, 1 bar (40 g) [190 kcal, 10P,
 * 23C, 7F, 3 fiber]", even when told to name it in plain words. Only a bracket
 * that gives kcal goes, and only at the end, so "Pad thai [spicy]" keeps its
 * own, and a name that is nothing but one stays as it came.
 */
export function plainName(raw) {
  const name = String(raw ?? "").trim();
  const bare = name.replace(/\s*\[[^[\]]*\bkcal\b[^[\]]*\]\s*$/i, "").trim();
  return (bare || name).slice(0, 300);
}

/** Never hand the app something it would only reject: fall through instead. */
export function clean(value) {
  if (!value || typeof value !== "object") return null;
  const number = (input, max) => {
    const parsed = Number(input);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return null;
    return Math.round(parsed * 10) / 10;
  };
  const estimate = {
    name: plainName(value.name),
    calories: number(value.calories, 20000),
    protein: number(value.protein, 2000),
    carbs: number(value.carbs, 3000),
    fat: number(value.fat, 2000),
    fiber: number(value.fiber === undefined ? 0 : value.fiber, 3000),
    alcohol: number(value.alcohol === undefined ? 0 : value.alcohol, 500),
    assumptions: String(value.assumptions ?? "").trim().slice(0, 3000),
    confidence: ["low", "medium", "high"].includes(value.confidence)
      ? value.confidence
      : "low",
  };
  const missing = ["calories", "protein", "carbs", "fat", "fiber", "alcohol"].some(
    (key) => estimate[key] === null,
  );
  if (!estimate.name || missing) return null;
  // Fiber is a subset of total carbs. An estimate that says otherwise is unusable.
  if (estimate.fiber > estimate.carbs) return null;
  return estimate;
}

const FIGURES = ["calories", "protein", "carbs", "fat", "fiber", "alcohol"];
const CEILINGS = { calories: 20000, protein: 2000, carbs: 3000, fat: 2000, fiber: 3000, alcohol: 500 };
const weakest = (levels) => levels.reduce((low, level) => (RANK[level] < RANK[low] ? level : low), "high");

/**
 * A shared meal's answer: every dish usable on its own, or the answer is not
 * usable at all, since a dish dropped is food nobody is given. The totals are
 * the dishes added up, so the meal and its dishes never disagree, and its
 * confidence is the weakest of theirs.
 */
export function cleanDishes(value) {
  const meal = clean(value);
  if (!meal || !Array.isArray(value.dishes) || !value.dishes.length || value.dishes.length > DISH_LIMIT) return null;
  const dishes = value.dishes.map(clean);
  if (dishes.some((dish) => !dish)) return null;
  const totals = Object.fromEntries(
    FIGURES.map((key) => [key, Math.round(dishes.reduce((sum, dish) => sum + dish[key], 0) * 10) / 10]),
  );
  if (FIGURES.some((key) => totals[key] > CEILINGS[key])) return null;
  return {
    ...meal,
    ...totals,
    fiber: Math.min(totals.fiber, totals.carbs),
    confidence: weakest([meal.confidence, ...dishes.map((dish) => dish.confidence)]),
    dishes,
  };
}

const RANK = { low: 0, medium: 1, high: 2 };
const title = (name) => name[0].toUpperCase() + name.slice(1);
const brackets = ({ calories, protein, carbs, fat, fiber, alcohol }) =>
  `[${[
    `${Math.round(calories)} kcal`,
    `${Math.round(protein)}P`,
    `${Math.round(carbs)}C`,
    `${Math.round(fat)}F`,
    ...(fiber ? [`${Math.round(fiber)} fiber`] : []),
    ...(alcohol ? [`${Math.round(alcohol)} ethanol`] : []),
  ].join(", ")}]`;

/** Whole items first: cut at the last blank line that fits, else mid-text. */
function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n\n", max - 1);
  return `${(cut > 0 ? text.slice(0, cut) : text.slice(0, max - 1)).trimEnd()}…`;
}

/**
 * How much more a surer answer counts than its weight alone says: a label
 * found counts double, a reference value as it is, and a product not found or
 * extrapolated half. Each weight is multiplied by this before the shares are
 * worked out, so answers on the same footing share as WEIGHTS do, and
 * otherwise share moves from the less sure to the surer. The app's box uses
 * the same, as CONFIDENCE_FACTOR in lib/estimate-blend.ts.
 */
const CONFIDENCE_FACTOR = { low: 0.5, medium: 1, high: 2 };
const counts = ({ provider, estimate }) => WEIGHTS[provider] * CONFIDENCE_FACTOR[estimate.confidence];

/**
 * Who the average starts from: everyone, except that when two or more found
 * the label, an answer that could not find the product is left out. Anyone
 * else less sure stays in and counts for less.
 */
function kept(answers) {
  const labels = answers.filter(({ estimate }) => estimate.confidence === "high").length;
  return labels >= 2 ? answers.filter(({ estimate }) => estimate.confidence !== "low") : answers;
}

/** One phrase for the header. Same footing stays "each low confidence". */
function footing(list) {
  const [first] = list;
  return list.every(({ estimate }) => estimate.confidence === first.estimate.confidence)
    ? `each ${first.estimate.confidence} confidence`
    : `${list.map(({ provider, estimate }) => `${title(provider)} ${estimate.confidence} confidence`).join(", ")}, a high answer counting double its weight and a low one half`;
}

/**
 * The kept answers averaged by WEIGHTS times CONFIDENCE_FACTOR, each figure
 * over the answers that gave it more than 0: a 0 beside real figures is one
 * left out, not one measured. The name is the answer that counts for most.
 * Each one's working is kept, inside the 3000 characters the app holds for
 * assumptions.
 */
export function settle(answers) {
  const top = kept(answers);
  if (top.length === 1) return top[0];

  const weight = (list) => list.reduce((sum, answer) => sum + counts(answer), 0);
  const mean = (key) => {
    const given = top.filter(({ estimate }) => estimate[key] > 0);
    return given.length
      ? given.reduce((sum, answer) => sum + answer.estimate[key] * counts(answer), 0) / weight(given)
      : 0;
  };
  const macros = Object.fromEntries(
    ["calories", "protein", "carbs", "fat", "fiber", "alcohol"].map((key) => [key, mean(key)]),
  );
  const shares = top.map(
    (answer) => `${title(answer.provider)} ${Math.round((counts(answer) / weight(top)) * 100)}%`,
  );
  const confidence = weakest(top.map(({ estimate }) => estimate.confidence));
  const header = `Weighted average of ${shares.slice(0, -1).join(", ")} and ${shares.at(-1)}, ${footing(top)}. A 0 is left out of that figure's average.`;
  const room = Math.floor((3000 - header.length) / top.length) - 2;
  const lead = top.reduce((best, answer) => (counts(answer) > counts(best) ? answer : best));
  return {
    estimate: clean({
      name: lead.estimate.name,
      ...macros,
      // Fiber is averaged over fewer answers than carbs can be, so it is held
      // to them.
      fiber: Math.min(macros.fiber, macros.carbs),
      assumptions: [
        header,
        ...top.map(({ estimate, provider }) => {
          const line = `From ${title(provider)} ${brackets(estimate)}:\n`;
          return line + shorten(estimate.assumptions, room - line.length);
        }),
      ].join("\n\n"),
      confidence,
    }),
    provider: "average",
  };
}

/**
 * A shared meal settled dish by dish, by the same rule as a whole one: the
 * same answers are kept, and each dish is averaged by WEIGHTS times that
 * answer's confidence for that dish, each figure over the answers that gave
 * it more than 0. A dish is averaged with the dish in the same place in the
 * others, so only answers that split the meal into as many dishes as the one
 * that counts for most are averaged; one that split it another way is left
 * out, and the meal's assumptions say so. Each dish keeps every answer's
 * working for it, and the totals are the dishes added up.
 */
export function settleDishes(answers) {
  const top = kept(answers);
  if (top.length === 1) return top[0];
  const [lead] = [...top].sort((a, b) => counts(b) - counts(a));
  const same = top.filter(({ estimate }) => estimate.dishes.length === lead.estimate.dishes.length);
  const apart = top.filter((answer) => !same.includes(answer));
  if (same.length === 1) return lead;

  // Each answer for one dish counts by its weight and its confidence there.
  const weigh = ({ value, provider }) => counts({ provider, estimate: value });
  const weight = (list) => list.reduce((sum, item) => sum + weigh(item), 0);
  const mean = (list, key) => {
    const given = list.filter(({ value }) => value[key] > 0);
    return given.length
      ? given.reduce((sum, item) => sum + item.value[key] * weigh(item), 0) / weight(given)
      : 0;
  };
  const shares = (list) => {
    const named = list.map(
      (item) => `${title(item.provider)} ${Math.round((weigh(item) / weight(list)) * 100)}%`,
    );
    return `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  };
  const dishes = lead.estimate.dishes.map((dish, index) => {
    const each = same.map(({ estimate, provider }) => ({ value: estimate.dishes[index], provider }));
    const macros = Object.fromEntries(FIGURES.map((key) => [key, mean(each, key)]));
    const header = `Weighted average of ${shares(each)}.`;
    const room = Math.floor((3000 - header.length) / each.length) - 2;
    return {
      name: dish.name,
      ...macros,
      fiber: Math.min(macros.fiber, macros.carbs),
      assumptions: [
        header,
        ...each.map(({ value, provider }) => {
          const line = `From ${title(provider)} ${brackets(value)}:\n`;
          return line + shorten(value.assumptions, room - line.length);
        }),
      ].join("\n\n"),
      confidence: weakest(each.map(({ value }) => value.confidence)),
    };
  });
  const confidence = weakest(same.map(({ estimate }) => estimate.confidence));
  const left = apart.length
    ? ` ${apart.map(({ provider }) => title(provider)).join(" and ")} split the meal into a different number of dishes, so ${apart.length > 1 ? "they are" : "it is"} left out.`
    : "";
  // The meal's shares are each answer's whole-meal footing; each dish says its own.
  const header = `Weighted average of ${shares(same.map(({ estimate, provider }) => ({ value: estimate, provider })))}, dish by dish, ${footing(same)}. A 0 is left out of that figure's average.${left}`;
  const notes = same.filter(({ estimate }) => estimate.assumptions);
  const room = notes.length ? Math.floor((3000 - header.length) / notes.length) - 2 : 0;
  const settled = cleanDishes({
    name: lead.estimate.name,
    // The totals are worked out from the dishes.
    calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, alcohol: 0,
    assumptions: [
      header,
      ...notes.map(({ estimate, provider }) => {
        const line = `From ${title(provider)}:\n`;
        return line + shorten(estimate.assumptions, room - line.length);
      }),
    ].join("\n\n"),
    confidence,
    dishes,
  });
  return settled ? { estimate: settled, provider: "average" } : lead;
}

/**
 * A link or a list of items is complex. The description is the meal itself, or
 * JSON around it when notes or a follow-up ride along.
 */
export function complex(description) {
  const wrapped = (() => {
    try {
      return JSON.parse(description).mealDescription;
    } catch {
      return undefined;
    }
  })();
  const meal = typeof wrapped === "string" ? wrapped : description;
  if (/https?:\/\/|www\./i.test(meal)) return true;
  const items = meal.split(/[,;+&\n]|\b(?:and|with|plus)\b/i).filter((part) => part.trim());
  return items.length >= COMPLEX_ITEMS;
}
