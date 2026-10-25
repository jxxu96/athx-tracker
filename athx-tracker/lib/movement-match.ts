import { METCON, isDistanceUnit, type Workout } from "./domain.ts";
import { EXERCISES } from "./exercises.ts";
import type { WorkoutDraft } from "./workout-draft.ts";

/**
 * The model is asked to use list spelling. This still runs on its answer,
 * because a dictated "deadlif" or "ohp" has to land on the exercise that is
 * already in the picker. A name that is a different movement stays as typed
 * and is called out in the notes, rather than being quietly renamed.
 */

const FILLER = new Set(["a", "an", "the", "some", "my", "our", "just", "of", "with"]);
const IGNORABLE = new Set([
  "barbell", "bar", "weighted", "strict", "kipping", "unbroken", "bodyweight", "bw",
  "workout", "session", "wod", "training", "practice", "class", "exercise", "movement",
  "station", "x", "times", "by", "at", "kg", "lb", "lbs", "pound", "pounds", "kilo", "kilos",
]);
const SESSION_NOISE = new Set(["class", "session", "workout", "wod", "training", "practice", "lite"]);
const TOKEN_ALIAS: Record<string, string[]> = {
  db: ["dumbbell"],
  bb: ["barbell"],
  kb: ["kettlebell"],
  oh: ["overhead"],
  dumbell: ["dumbbell"],
  g2oh: ["dumbbell", "ground", "to", "overhead"],
  gtoh: ["dumbbell", "ground", "to", "overhead"],
  pullup: ["pull", "up"],
  pushup: ["push", "up"],
  pulldown: ["pull", "down"],
  rower: ["row"],
  rowing: ["row"],
  running: ["run"],
  skierg: ["ski", "erg"],
  wallball: ["wall", "ball"],
  pushpress: ["push", "press"],
  backsquat: ["back", "squat"],
  frontsquat: ["front", "squat"],
  hipthrust: ["hip", "thrust"],
};
const PHRASE: Record<string, string> = {
  ohp: "overhead press",
  "military press": "overhead press",
  "strict press": "overhead press",
  rdl: "romanian deadlift",
  dl: "deadlift",
  bs: "back squat",
  bsq: "back squat",
  fs: "front squat",
  fsq: "front squat",
  "c and j": "clean and jerk",
  cj: "clean and jerk",
  "clean jerk": "clean and jerk",
  pc: "power clean",
  sj: "split jerk",
  du: "double under",
  dub: "double under",
  "farmer walk": "farmer carry",
  "assault bike": "bike erg",
  "echo bike": "bike erg",
  "air bike": "bike erg",
};

const SESSION_PHRASES: { phrase: string; category: Workout["category"] }[] = [
  { phrase: "athx lite", category: "MetCon" },
  { phrase: "athx circuit", category: "MetCon" },
  { phrase: "met con", category: "MetCon" },
  { phrase: "solid core", category: "Solidcore" },
  { phrase: "metcon", category: "MetCon" },
  { phrase: "athx", category: "MetCon" },
  { phrase: "circuit", category: "MetCon" },
  { phrase: "solidcore", category: "Solidcore" },
  { phrase: "y t w", category: "YTW" },
  { phrase: "ytw", category: "YTW" },
  { phrase: "tennis", category: "Tennis" },
  { phrase: "strength", category: "Strength" },
  { phrase: "lifting", category: "Strength" },
  { phrase: "endurance", category: "Endurance" },
  { phrase: "mixed", category: "Mixed" },
];

type CatalogItem = { name: string; tokens: string[]; compact: string };

function singular(word: string) {
  if (word.length <= 2) return word;
  if (/(?:ss|ch|sh|x|z|o)es$/.test(word) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function isVolume(word: string) {
  return /^\d/.test(word) || [
    "mile", "km", "meter", "metre", "rep", "set", "cal", "calorie", "min", "minute", "sec", "second",
  ].includes(word);
}

/** Lower case, plurals and abbreviations. Phrase aliases are applied by the caller. */
export function normalize(raw: string) {
  const words = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const tokens: string[] = [];
  for (const word of words) {
    const stem = singular(word);
    const expanded = TOKEN_ALIAS[stem] ?? [stem];
    for (const token of expanded) {
      if (!token || FILLER.has(token) || isVolume(token)) continue;
      tokens.push(token);
    }
  }
  return tokens;
}

function queryTokens(raw: string) {
  const tokens = normalize(raw);
  const phrase = PHRASE[tokens.join(" ")];
  return phrase ? normalize(phrase) : tokens;
}

/** Session words keep their trailing s, so "tenis" can still reach Tennis. */
function spell(raw: string) {
  const words = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const tokens: string[] = [];
  for (const word of words) {
    const expanded = TOKEN_ALIAS[word] ?? [word];
    for (const token of expanded) {
      if (!token || FILLER.has(token) || isVolume(token)) continue;
      tokens.push(token);
    }
  }
  return tokens;
}

function editDistance(a: string, b: string) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
    }
  }
  return matrix[a.length][b.length];
}

/** Short words only match exactly, so "row" cannot typo into "run". */
function tokenDistance(a: string, b: string) {
  if (a === b) return 0;
  const distance = editDistance(a, b);
  const short = Math.min(a.length, b.length);
  const long = Math.max(a.length, b.length);
  if (a[0] !== b[0]) return null;
  if (short <= 2) return null;
  if (short === 3) return distance === 1 && long === 4 ? 1 : null;
  const limit = short >= 7 ? 2 : 1;
  return distance <= limit ? distance : null;
}

const CATALOG: CatalogItem[] = [];
{
  const seen = new Set<string>();
  for (const name of [...EXERCISES.flatMap((group) => group.items), ...METCON.map((station) => station.name)]) {
    if (seen.has(name)) continue;
    seen.add(name);
    const tokens = normalize(name);
    CATALOG.push({ name, tokens, compact: tokens.join("") });
  }
}
const FOLDED = new Map(CATALOG.map((item) => [item.name.toLowerCase(), item.name]));

function alignment(input: string[], name: string[]) {
  const used = new Set<number>();
  let missing = 0;
  for (const token of name) {
    let best = -1;
    let bestDistance = 99;
    input.forEach((word, index) => {
      if (used.has(index)) return;
      const distance = tokenDistance(word, token);
      if (distance === null || distance >= bestDistance) return;
      bestDistance = distance;
      best = index;
    });
    if (best < 0) missing += 1;
    else used.add(best);
  }
  return { missing, extra: input.filter((_, index) => !used.has(index)) };
}

function acceptable(extra: string[]) {
  return extra.every((token) => IGNORABLE.has(token));
}

function humanList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function leftAsTyped(raw: string, options: string[]) {
  const heard = raw.trim();
  if (options.length) return `Left as typed: "${heard}" could be ${humanList(options)}.`;
  return `Left as typed: "${heard}" is not in the list.`;
}

export type MovementMatch = { name: string; listed: boolean; note: string | null };

/** The list spelling when the words are that movement, otherwise the typed name and a note. */
export function matchMovement(raw: string): MovementMatch {
  const trimmed = raw.trim();
  const folded = FOLDED.get(trimmed.toLowerCase());
  if (folded) return { name: folded, listed: true, note: null };

  const tokens = queryTokens(trimmed);
  if (!tokens.length) return { name: trimmed, listed: false, note: leftAsTyped(trimmed, []) };

  const aligned = CATALOG.map((item) => ({ item, ...alignment(tokens, item.tokens) }));
  const exact = aligned.filter((row) => row.missing === 0 && acceptable(row.extra));
  if (exact.length >= 1) {
    const fewest = Math.min(...exact.map((row) => row.extra.length));
    const tight = exact.filter((row) => row.extra.length === fewest);
    if (tight.length === 1) return { name: tight[0].item.name, listed: true, note: null };
    return { name: trimmed, listed: false, note: leftAsTyped(trimmed, tight.map((row) => row.item.name)) };
  }

  const compact = tokens.join("");
  const ranked = CATALOG.map((item) => ({
    name: item.name,
    distance: item.compact === compact ? 0 : editDistance(compact, item.compact),
  })).sort((a, b) => a.distance - b.distance || a.name.length - b.name.length);
  const best = ranked[0];
  const second = ranked[1]?.distance ?? Infinity;
  const typo = best && (best.distance === 0 || (
    best.distance <= 2 && compact.length >= 6 && best.name[0].toLowerCase() === compact[0]
  ));
  if (best && typo && second > best.distance)
    return { name: best.name, listed: true, note: null };

  const partial = aligned.filter((row) => row.missing > 0 && acceptable(row.extra));
  if (partial.length) {
    const fewest = Math.min(...partial.map((row) => row.missing));
    const close = partial.filter((row) => row.missing === fewest);
    // One list item that is only a word short ("db bench" → DB bench press) is still that item.
    // Two list items at the same distance stay typed, with both names in the note.
    if (fewest === 1 && close.length === 1)
      return { name: close[0].item.name, listed: true, note: null };
    if (fewest <= 2)
      return {
        name: trimmed,
        listed: false,
        note: leftAsTyped(trimmed, close.map((row) => row.item.name).slice(0, 4)),
      };
  }
  return { name: trimmed, listed: false, note: leftAsTyped(trimmed, []) };
}

/** A whole name that means a session type, not a movement. "metcon finisher" does not. */
export function sessionOf(raw: string): Workout["category"] | null {
  const tokens = spell(raw);
  const full = tokens.join(" ");
  const core = tokens.filter((token) => !SESSION_NOISE.has(token)).join(" ");
  for (const entry of SESSION_PHRASES) {
    if (entry.phrase === full || entry.phrase === core) return entry.category;
  }
  const compact = core.replace(/ /g, "");
  if (compact.length < 5) return null;
  let best: { category: Workout["category"]; distance: number } | null = null;
  let second = Infinity;
  for (const entry of SESSION_PHRASES) {
    const key = entry.phrase.replace(/ /g, "");
    if (key.length < 5 || compact[0] !== key[0]) continue;
    const distance = editDistance(compact, key);
    if (!best || distance < best.distance) {
      second = best ? best.distance : Infinity;
      best = { category: entry.category, distance };
    } else if (distance < second && entry.category !== best.category) second = distance;
  }
  if (best && best.distance <= 1 && second > best.distance) return best.category;
  return null;
}

function alreadyCalledOut(draft: Pick<WorkoutDraft, "notes" | "assumptions">, heard: string) {
  const haystack = `${draft.notes}\n${draft.assumptions}`.toLowerCase();
  const name = heard.trim().toLowerCase();
  return name.length > 0 && haystack.includes(name)
    && (haystack.includes("left as typed") || haystack.includes("not in the list"));
}

function circuitStations(): WorkoutDraft["stations"] {
  const blank = () => ({ completed: null, seconds: null, kg: null });
  return METCON.map((station) => ({
    name: station.name,
    unit: station.unit,
    target: station.target,
    block: "metcon" as const,
    hippos: blank(),
    gators: blank(),
  }));
}

function settle(
  category: Workout["category"],
  lifts: number,
  stations: { name: string; block: "metcon" | "endurance"; unit: string }[],
  asked: Set<Workout["category"]>,
): Workout["category"] {
  const hasLifts = lifts > 0;
  const hasEndurance = stations.some((station) => station.block === "endurance");
  const hasMetcon = stations.some((station) => station.block === "metcon");
  if (!hasLifts && !hasMetcon && !hasEndurance) {
    if (asked.has("Solidcore")) return "Solidcore";
    if (asked.has("Tennis")) return "Tennis";
    if (asked.has("YTW")) return "YTW";
    if (asked.has("MetCon")) return "MetCon";
    if (asked.has("Endurance")) return "Endurance";
    if (asked.has("Strength")) return "Strength";
    if (asked.has("Mixed")) return "Mixed";
    return category;
  }
  // A category that hides lifts or stations would drop work the description named.
  if ((hasLifts && (hasMetcon || hasEndurance)) || (hasMetcon && hasEndurance)) return "Mixed";
  if (hasLifts) {
    if (!["Strength", "Mixed", "Other"].includes(category) || (asked.has("Strength") && category === "Other"))
      return "Strength";
    return category;
  }
  if (hasMetcon) {
    if (category === "Strength" || category === "Other" || category === "Endurance" || asked.has("MetCon"))
      return "MetCon";
    return category;
  }
  const runOnly = stations.every((station) => station.name === "Run" && isDistanceUnit(station.unit));
  if (runOnly && (category === "Other" || category === "MetCon" || category === "Strength" || asked.has("Endurance")))
    return "Endurance";
  if (!runOnly && category === "Endurance") return "Mixed";
  return category;
}

/**
 * Rewrite lift and station names onto the list. A MetCon with no stations of
 * its own becomes the ATHX circuit. Anything too far from the list stays, and
 * the notes say so.
 */
export function alignWorkoutDraft(draft: WorkoutDraft): WorkoutDraft {
  const asked = new Set<Workout["category"]>();
  const notes: string[] = [];
  const customSession = draft.category === "Other" ? sessionOf(draft.customCategory) : null;
  if (customSession) asked.add(customSession);

  const take = (raw: string) => {
    const session = sessionOf(raw);
    if (session) {
      asked.add(session);
      return null;
    }
    const match = matchMovement(raw);
    if (!match.listed && match.note && !alreadyCalledOut(draft, raw)) notes.push(match.note);
    return match.name;
  };

  const lifts = draft.lifts.flatMap((lift) => {
    const name = take(lift.name);
    return name === null ? [] : [{ ...lift, name }];
  });
  let stations = draft.stations.flatMap((station) => {
    const name = take(station.name);
    return name === null ? [] : [{ ...station, name }];
  });

  const wantsCircuit = asked.has("MetCon") || draft.category === "MetCon" || customSession === "MetCon";
  if (wantsCircuit && stations.length === 0) stations = circuitStations();

  const category = settle(customSession ?? draft.category, lifts.length, stations, asked);
  let customCategory = draft.customCategory;
  if (category !== "Other") customCategory = "";
  else if (customCategory.trim() && !alreadyCalledOut(draft, customCategory))
    notes.push(`Left as typed: "${customCategory.trim()}" is not a workout in the list.`);

  const addition = notes.filter((line) => !draft.notes.includes(line));
  const combined = [draft.notes.trim(), ...addition].filter(Boolean).join("\n");
  return {
    ...draft,
    category,
    customCategory,
    notes: combined.slice(0, 2000),
    lifts,
    stations,
  };
}
