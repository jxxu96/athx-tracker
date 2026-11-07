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
 * hippos)", "fries (80% h 20% g)", "coke (75% g)". That is not food, so it is
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
    "^\\d+(?:\\.\\d+)?\\s*(?:-?\\s*inch(?:es)?|in|\"|cm|mm|g|gr|grams?|kg|oz|ounces?|ml|cl|l|liters?|litres?|lbs?|pounds?|cups?|tbsp|tsp|pints?|fl ?oz)(?=\\s|$)(?:\\s+(?:cooked|raw|dry|uncooked|each|total|wide|across|pie))?$",
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
const WHO = "(gators?|hippos?|g|h)";
/** A percentage. The % is required: "60 g" is grams. */
const PERCENT = "(\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%";
/** "60% gators", "60%g", "gators 60%", "g: 60%". */
const TERM = new RegExp(`${PERCENT}\\s*${WHO}(?!\\p{L})|(?<!\\p{L})${WHO}\\s*:?\\s*${PERCENT}`, "giu");
/** What may stand between two shares in the same brackets. */
const BETWEEN = /[\s,;/&+|-]|\band\b/gi;
const BRACKETS = /\(([^()]*)\)|\[([^[\]]*)\]|\{([^{}]*)\}/g;

/** A share written with a dish, as percentages of it; whoever is missing was not written. */
export type WrittenShare = Partial<Record<Eater, number>>;

/**
 * What is in a pair of brackets as a share, or null when it is anything else:
 * every word in it has to be a share, each from 0 to 100, and naming the same
 * person twice has to say the same thing both times.
 */
function shareIn(inside: string): WrittenShare | null {
  if (inside.replace(TERM, "").replace(BETWEEN, "") !== "") return null;
  const share: WrittenShare = {};
  for (const match of inside.matchAll(TERM)) {
    const value = Number(match[1] ?? match[4]);
    const eater: Eater = (match[2] ?? match[3]).toLowerCase().startsWith("g") ? "gators" : "hippos";
    if (value > 100 || (share[eater] !== undefined && share[eater] !== value)) return null;
    share[eater] = value;
  }
  return Object.keys(share).length ? share : null;
}

/** A line with its shares taken out, and the gap and punctuation they leave tidied up. */
function lineWithout(line: string) {
  const out = line.replace(BRACKETS, (whole, ...inside: (string | undefined)[]) =>
    shareIn(inside[0] ?? inside[1] ?? inside[2] ?? "") ? "" : whole);
  if (out === line) return line;
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,;])/g, "$1")
    .replace(/([,;])(?:[ \t]*[,;])+/g, "$1")
    .replace(/[\s,;]+$/, "")
    .replace(/^[ \t]+/, "");
}

/** The description with every share written in it taken out: what an estimate is given to read. */
export function withoutShares(text: string) {
  return text.replace(/[^\r\n]+/g, lineWithout);
}

/**
 * A dish as written: its words without the share, and the share. Two pairs
 * of brackets with shares in them make one share, the later saying the last
 * word. A dish with no share, or none that reads, keeps every word.
 */
export function readDishShare(text: string): { name: string; share: WrittenShare | null } {
  let share: WrittenShare | null = null;
  for (const match of text.matchAll(BRACKETS)) {
    const found = shareIn(match[1] ?? match[2] ?? match[3] ?? "");
    if (found) share = { ...(share ?? {}), ...found };
  }
  if (!share) return { name: text, share: null };
  return { name: withoutShares(text).replace(/^[\s.,;:+&/-]+|[\s.,;:+&/-]+$/g, ""), share };
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
    const bare = withoutShares(dish).trim();
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
export type WrittenDish = { name: string; share: WrittenShare | null };

/**
 * The dishes in a description, each with the share written with it, if any.
 * A dish that was only a share, with nothing left to eat, is left out.
 */
export function writtenDishes(text: string, limit = 20): WrittenDish[] {
  return splitDishText(text, limit).map(readDishShare).filter((dish) => dish.name !== "");
}
