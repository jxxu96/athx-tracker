import type { Eater } from "./meal-dishes.ts";

/*
 * A shared meal's description cut into dishes as it was written: a line, or a
 * bullet, for each, or commas, semicolons, "and", "plus", and a "+", "&" or
 * "/" with space around it between them. This is the first cut, made on the
 * phone without asking anyone. The estimate makes the last one: it is given
 * these dishes, and splits one that is plainly two, such as "burger fries"
 * written with only a space, or joins two that are plainly one.
 *
 * A dish can say in brackets how it was shared: "sandwich (60% gators 40%
 * hippos)", "fries (80% h 20% g)", "coke (75% g)", "sprouts (50% each)", or
 * in pieces, "8pc hongshaorou (5.5pc gators)". That is not food, so it is
 * taken off the dish before anything estimates it, and becomes its share.
 */

/** "and" written any of the ways people write it inside a name. */
const AND = "\\s*(?:and|&|'n'?|n'|n)\\s*";

/** Names that are one dish with "and" in them. */
const ONE_DISH = [
  "mac(?:aroni)? and cheese",
  "fish and chips",
  "salt and (?:pepper|vinegar)",
  "(?:sweet|hot) and sour",
  "surf and turf",
  "chips and (?:salsa|guac(?:amole)?|queso|dip)",
  "bread and butter",
  "(?:peanut butter|pb) and (?:jelly|jam|j)",
  "(?:red )?beans and rice",
  "rice and beans",
  "chicken and waffles",
  "biscuits and gravy",
  "bangers and mash",
  "shrimp and grits",
  "spaghetti and meatballs",
  "(?:franks|pork) and beans",
  "(?:bacon|sausage|ham),? egg and cheese",
  "(?:ham|egg|turkey) and cheese",
  "(?:cookies|strawberries|peaches) and cream",
  "half and half",
  "sour cream and onion",
  "steak and eggs",
  "corned beef and cabbage",
  "liver and onions",
  "black and white",
  "cheese and crackers",
].map((name) => new RegExp(`\\b${name.replace(/ and /g, AND)}\\b`, "gi"));

/** A part that only says more about the dish before it: its size, its weight, or how it came. */
const DETAIL = new RegExp(
  [
    "^\\d+(?:\\.\\d+)?\\s*(?:-?\\s*inch(?:es)?|in|\"|cm|mm|g|gr|grams?|kg|oz|ounces?|ml|cl|l|liters?|litres?|lbs?|pounds?|cups?|tbsp|tsp|pints?|fl ?oz|servings?|portions?|orders?|helpings?|pcs?|pieces?)(?=\\s|$)(?:\\s+(?:cooked|raw|dry|uncooked|each|total|wide|across|pie))?$",
    "^(?:small|medium|large|regular|x?xl|extra large|grande|venti|tall|short|kids?|personal|single|double|triple)(?:\\s+(?:size|order|portion|serving|one))?$",
    "^(?:grilled|fried|deep fried|baked|steamed|raw|cooked|roasted|toasted|iced|hot|cold|warm|spicy|mild|well done|medium rare|rare|scrambled|poached|sunny side up|over easy|plain|unsweetened|sweetened)$",
    "^(?:no|without|extra|light|easy on|add(?:ed)?|with|w/|hold the|sub(?:stitute)?)(?=\\s|$)",
    "^(?:sauce|dressing|cheese)? ?on the side$",
  ].join("|"),
  "i",
);

/**
 * After one of these, "and" joins what is on the dish rather than starting
 * another: "burger with lettuce and tomato", "platter: 2 rolls and 6 nigiri".
 */
const ON_IT = /(?:^|\s)(?:with|w\/|topped with|served with|no|without|extra|add)(?=\s|$)|:/i;

const LIST_MARK = /^\s*(?:[-*•·▪◦‣]|\d+[.)])\s+/;
const LINE_BETWEEN = /\s*[;|]\s*|\s*,\s*(?:(?:and|plus|&)\s+)?/i;
const WORD_BETWEEN = /(\s+[+&/]\s+|\s+(?:and|plus)\s+)/i;

/** Brackets hide what is in them: "pizza (ham and pineapple)" is one dish. */
function hide(text: string, kept: string[]) {
  let depth = 0;
  let out = "";
  let held = "";
  for (const char of text) {
    if ("([{".includes(char)) depth += 1;
    if (depth > 0) held += char;
    else out += char;
    if (")]}".includes(char) && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        out += `\u0000${kept.push(held) - 1}\u0000`;
        held = "";
      }
    }
  }
  return out + held;
}

const show = (text: string, kept: string[]) =>
  text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => kept[Number(index)]);

/** Who a share is for: either name, singular or plural, or its first letter. */
const WHO = "(gators?|hippos?|g|h)(?!\\p{L})";
const NUMBER = "(\\d+(?:\\.\\d+)?|\\.\\d+)";
const PIECES = "(?:pcs?|pieces?)\\.?";
const BOTH: readonly Eater[] = ["hippos", "gators"];
const BRACKETS = /\(([^()]*)\)|\[([^[\]]*)\]|\{([^{}]*)\}/g;

/** A share written with a dish, as percentages of it; whoever is missing was not written. */
export type WrittenShare = Partial<Record<Eater, number>>;

type Term = { who: Eater | "each"; value: number; unit: "%" | "pc" };
const eaterOf = (word: string): Eater => (word.toLowerCase().startsWith("g") ? "gators" : "hippos");

/**
 * Each way a share is written, tried where the last one left off. The % is
 * required, since "60 g" is grams; so is the "pc" on a count of pieces.
 */
const TERMS: [RegExp, (match: RegExpExecArray) => Term | null][] = [
  // What stands between two shares: spaces, punctuation, "and".
  [/(?:[\s,;/&+|-]|and(?!\p{L}))+/iuy, () => null],
  // "60% gators", "60%g"
  [new RegExp(`${NUMBER}\\s*%\\s*${WHO}`, "iuy"), (m) => ({ who: eaterOf(m[2]), value: Number(m[1]), unit: "%" })],
  // "50% each", "50% ea"
  [new RegExp(`${NUMBER}\\s*%\\s*(?:each|ea)\\.?(?!\\p{L})`, "iuy"), (m) => ({ who: "each", value: Number(m[1]), unit: "%" })],
  // "3 pc gators", "5.5pc g"
  [new RegExp(`${NUMBER}\\s*${PIECES}\\s*${WHO}`, "iuy"), (m) => ({ who: eaterOf(m[2]), value: Number(m[1]), unit: "pc" })],
  // "gators 60%", "g: 60%"
  [new RegExp(`${WHO}\\s*:?\\s*${NUMBER}\\s*%`, "iuy"), (m) => ({ who: eaterOf(m[1]), value: Number(m[2]), unit: "%" })],
  // "gators 3 pc", "g: 5.5pcs"
  [new RegExp(`${WHO}\\s*:?\\s*${NUMBER}\\s*${PIECES}(?!\\p{L})`, "iuy"), (m) => ({ who: eaterOf(m[1]), value: Number(m[2]), unit: "pc" })],
];

/** The next share, or what stands between two, at a place in the brackets; null when it is neither. */
function termAt(inside: string, at: number): { term: Term | null; next: number } | null {
  for (const [pattern, read] of TERMS) {
    pattern.lastIndex = at;
    const match = pattern.exec(inside);
    if (match) return { term: read(match), next: pattern.lastIndex };
  }
  return null;
}

/** Percentages, and counts of pieces, each person was written down for. */
type Shape = { percent: WrittenShare; pieces: WrittenShare };

/**
 * What is in a pair of brackets as a share, or null when it is anything else:
 * every word in it has to be a share, a percentage from 0 to 100 or a count
 * of pieces, and naming the same person twice has to say the same thing.
 */
function shapeOf(inside: string): Shape | null {
  const shape: Shape = { percent: {}, pieces: {} };
  let named = false;
  for (let at = 0; at < inside.length; ) {
    const step = termAt(inside, at);
    if (!step) return null;
    at = step.next;
    const { term } = step;
    if (!term) continue;
    if (term.unit === "%" && term.value > 100) return null;
    const [into, other] = term.unit === "%" ? [shape.percent, shape.pieces] : [shape.pieces, shape.percent];
    for (const eater of term.who === "each" ? BOTH : [term.who]) {
      if (other[eater] !== undefined || (into[eater] !== undefined && into[eater] !== term.value)) return null;
      into[eater] = term.value;
      named = true;
    }
  }
  return named ? shape : null;
}

const insideOf = (match: RegExpMatchArray) => match[1] ?? match[2] ?? match[3] ?? "";

/** Taken out where a share was, until the line it was on is tidied. */
const GAP = "\u0001";

/**
 * The text with these brackets taken out, each the first of its kind after
 * the last, and the lines they were on tidied: no double spaces, and no comma
 * left dangling or doubled.
 */
function cutOut(text: string, brackets: readonly string[]) {
  let out = "";
  let rest = text;
  for (const bracket of brackets) {
    const at = rest.indexOf(bracket);
    if (at < 0) continue;
    out += rest.slice(0, at) + GAP;
    rest = rest.slice(at + bracket.length);
  }
  return (out + rest).replace(/[^\r\n]*\u0001[^\r\n]*/g, (line) =>
    line
      .replaceAll(GAP, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([,;])/g, "$1")
      .replace(/([,;])(?:[ \t]*[,;])+/g, "$1")
      .replace(/[\s,;]+$/, "")
      .replace(/^[ \t]+/, ""));
}

/** A dish without anything in brackets that is shaped like a share, worked out or not. */
const unshared = (dish: string) =>
  dish.replace(BRACKETS, (whole, ...inside: (string | undefined)[]) =>
    shapeOf(inside[0] ?? inside[1] ?? inside[2] ?? "") ? "" : whole).trim();

/** Words after a number that make it a measure, not a count: "250g", "12 inch", "2 l". */
const MEASURES = "inch(?:es)?|in|cm|mm|g|gr|grams?|kg|oz|ounces?|ml|cl|l|liters?|litres?|lbs?|pounds?|cups?|tbsp|tsp|pints?|fl|x";
/** How many of something a dish starts with: "8pc hongshaorou", "5 shengjianbao", "3 blue crabs". */
const COUNT = new RegExp(`^\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${PIECES})?(?=[\\s,]|$)(?!\\s*(?:(?:${MEASURES})(?!\\p{L})|["%]))`, "iu");

function countOf(dish: string) {
  const count = Number(COUNT.exec(dish)?.[1] ?? 0);
  return count > 0 ? count : undefined;
}

const tenThousandth = (value: number) => Math.round(value * 10000) / 10000;

/** A dish as written: its words without its share, the share, and how many pieces it was when they were counted. */
export type DishShare = {
  name: string;
  share: WrittenShare | null;
  /** "8 pc", when a share was written in pieces and the dish had no count of its own. */
  quantity?: string;
  /** The brackets the share came from, as written. */
  taken: string[];
};

/**
 * A dish as written: its words without the share, and the share. A share in
 * pieces is a part of the dish's count, "8pc hongshaorou (5.5pc gators)" or
 * "5 shengjianbao (3 pc g)", or of the count in its quantity box when it has
 * one; with neither, of the pieces both of you were written down for. Two
 * pairs of brackets with shares in them make one share, the later saying the
 * last word. A dish with no share, or none that can be worked out, keeps
 * every word.
 */
export function readDishShare(text: string, counted?: number): DishShare {
  const found = [...text.matchAll(BRACKETS)]
    .map((match) => ({ whole: match[0], shape: shapeOf(insideOf(match)) }))
    .filter((bracket): bracket is { whole: string; shape: Shape } => bracket.shape !== null);
  if (!found.length) return { name: text, share: null, taken: [] };
  const own = countOf(cutOut(text, found.map(({ whole }) => whole)));
  let share: WrittenShare = {};
  let quantity: string | undefined;
  const taken: string[] = [];
  for (const { whole, shape } of found) {
    const percent = { ...shape.percent };
    const pieces = Object.entries(shape.pieces) as [Eater, number][];
    if (pieces.length) {
      const of = counted ?? own ?? (pieces.length === 2 ? pieces[0][1] + pieces[1][1] : undefined);
      if (!of || pieces.some(([, count]) => count > of)) continue;
      for (const [eater, count] of pieces) percent[eater] = tenThousandth((count / of) * 100);
      if (counted === undefined) quantity = `${of} pc`;
    }
    share = { ...share, ...percent };
    taken.push(whole);
  }
  if (!taken.length) return { name: text, share: null, taken: [] };
  return {
    name: cutOut(text, taken).replace(/^[\s.,;:+&/-]+|[\s.,;:+&/-]+$/g, ""),
    share,
    ...(quantity ? { quantity } : {}),
    taken,
  };
}

/** The description with every share written in it taken out: what an estimate is given to read. */
export function withoutShares(text: string) {
  return cutOut(text, splitDishText(text, Number.MAX_SAFE_INTEGER).flatMap((dish) => readDishShare(dish).taken));
}

/**
 * The dishes in a description, in its order. Every word of it is in one of
 * them, so nothing typed is lost; blank gives none. Past the limit, the rest
 * share the last dish.
 */
export function splitDishText(text: string, limit = 20): string[] {
  const parts: string[] = [];
  const add = (raw: string, kept: string[]) => {
    const dish = show(raw, kept)
      .trim()
      .replace(/^(?:(?:and|plus|&)\s+)+/i, "")
      .replace(/^[\s.,;:+&/-]+|[\s.,;:+&/-]+$/g, "");
    if (!dish) return;
    // "pizza, 12 inch" is one dish, said in two goes, and so is "pizza, (60% g)".
    const bare = unshared(dish);
    if (parts.length && (!bare || DETAIL.test(bare))) parts[parts.length - 1] += `, ${dish}`;
    else parts.push(dish);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(LIST_MARK, "").trim();
    if (!line) continue;
    const kept: string[] = [];
    let guarded = hide(line, kept);
    for (const name of ONE_DISH)
      guarded = guarded.replace(name, (match) => `\u0000${kept.push(match) - 1}\u0000`);
    for (const segment of guarded.split(LINE_BETWEEN)) {
      // Pieces and the words between them, so a joined piece keeps its "and".
      const pieces = segment.split(WORD_BETWEEN);
      let dish = pieces[0] ?? "";
      for (let index = 1; index < pieces.length; index += 2) {
        if (ON_IT.test(show(dish, kept))) dish += pieces[index] + pieces[index + 1];
        else {
          add(dish, kept);
          dish = pieces[index + 1];
        }
      }
      add(dish, kept);
    }
  }
  if (parts.length <= limit) return parts;
  return [...parts.slice(0, limit - 1), parts.slice(limit - 1).join(", ")];
}

/** A dish cut from a description, without the share it was written with, and that share. */
export type WrittenDish = Omit<DishShare, "taken">;

/**
 * The dishes in a description, each with the share written with it, if any.
 * A dish that was only a share, with nothing left to eat, is left out.
 */
export function writtenDishes(text: string, limit = 20): WrittenDish[] {
  return splitDishText(text, limit)
    .map((dish) => {
      const { name, share, quantity } = readDishShare(dish);
      return { name, share, ...(quantity ? { quantity } : {}) };
    })
    .filter((dish) => dish.name !== "");
}
