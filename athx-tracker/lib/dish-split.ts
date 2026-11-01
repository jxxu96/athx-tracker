/*
 * A shared meal's description cut into dishes as it was written: a line, or a
 * bullet, for each, or commas, semicolons, "and", "plus", and a "+", "&" or
 * "/" with space around it between them. This is the first cut, made on the
 * phone without asking anyone. The estimate makes the last one: it is given
 * these dishes, and splits one that is plainly two, such as "burger fries"
 * written with only a space, or joins two that are plainly one.
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
    // "pizza, 12 inch" is one dish, said in two goes.
    if (parts.length && DETAIL.test(dish)) parts[parts.length - 1] += `, ${dish}`;
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
