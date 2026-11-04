import type { Estimator } from "./domain.ts";
import { ESTIMATORS } from "./domain.ts";
import type { MealEstimate } from "./estimate-conversation.ts";

/** Codex, then Claude, then Grok. The same order the answers are shown in. */
export const ANSWER_ORDER = ["codex", "claude", "grok"] as const;
export type AnswerProvider = (typeof ANSWER_ORDER)[number];

/**
 * How much each answer counts. Whole numbers, so the box can show them as
 * typed. Only the ratios matter: 40, 35 and 25 are the estimator's 0.4, 0.35
 * and 0.25. A change here is the default for the next meal too.
 */
export const DEFAULT_WEIGHTS: EstimateWeights = { codex: 40, claude: 35, grok: 25 };
export type EstimateWeights = Record<AnswerProvider, number>;

const WEIGHTS_KEY = "athx-estimate-weights";
const RANK = { low: 0, medium: 1, high: 2 } as const;
const FIGURES = ["calories", "protein", "carbs", "fat", "fiber", "alcohol"] as const;
type Figure = (typeof FIGURES)[number];

export type BlendAnswer = {
  provider: AnswerProvider;
  estimate: MealEstimate;
};

/**
 * A link or a list of three or more items is a complex meal. The same rule as
 * the estimator, so the box starts from the same answers the server kept.
 */
export function complexMeal(description: string) {
  const wrapped = (() => {
    try {
      return JSON.parse(description).mealDescription as unknown;
    } catch {
      return undefined;
    }
  })();
  const meal = typeof wrapped === "string" ? wrapped : description;
  if (/https?:\/\/|www\./i.test(meal)) return true;
  const items = meal.split(/[,;+&\n]|\b(?:and|with|plus)\b/i).filter((part) => part.trim());
  return items.length >= 3;
}

/**
 * Who the average starts from. A high answer found the label, which is the
 * exact calories, so only those count and a guess is not mixed back in.
 * Otherwise the best footing wins, plus anyone named in keep: a complex meal
 * still keeps Grok when nobody found a label.
 */
export function defaultIncluded<T extends BlendAnswer>(
  answers: readonly T[],
  keep: readonly AnswerProvider[] = [],
): T[] {
  if (!answers.length) return [];
  const exact = answers.filter((answer) => answer.estimate.confidence === "high");
  if (exact.length) return [...exact];
  const best = Math.max(...answers.map((answer) => RANK[answer.estimate.confidence]));
  return answers.filter(
    (answer) => RANK[answer.estimate.confidence] === best || keep.includes(answer.provider),
  );
}

/** A stored weight that is not a percent from 0 to 100 is the built-in one. */
export function parseWeights(value: unknown): EstimateWeights {
  const weights = { ...DEFAULT_WEIGHTS };
  if (!value || typeof value !== "object") return weights;
  const held = value as Record<string, unknown>;
  for (const provider of ANSWER_ORDER) {
    const parsed = Number(held[provider]);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100)
      weights[provider] = Math.round(parsed);
  }
  return weights;
}

export function readWeights(storage: { getItem(key: string): string | null } | null): EstimateWeights {
  if (!storage) return { ...DEFAULT_WEIGHTS };
  try {
    return parseWeights(JSON.parse(storage.getItem(WEIGHTS_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export function writeWeights(
  storage: { setItem(key: string, value: string): void } | null,
  weights: EstimateWeights,
) {
  try {
    storage?.setItem(WEIGHTS_KEY, JSON.stringify(parseWeights(weights)));
  } catch {
    // Full or refused: this meal still uses the weights just chosen.
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10;

const brackets = (estimate: MealEstimate) =>
  `[${[
    `${Math.round(estimate.calories)} kcal`,
    `${Math.round(estimate.protein)}P`,
    `${Math.round(estimate.carbs)}C`,
    `${Math.round(estimate.fat)}F`,
    ...(estimate.fiber ? [`${Math.round(estimate.fiber)} fiber`] : []),
    ...(estimate.alcohol ? [`${Math.round(estimate.alcohol)} ethanol`] : []),
  ].join(", ")}]`;

/** Whole items first: cut at the last blank line that fits, else mid-text. */
function shorten(text: string, max: number) {
  if (max <= 1 || text.length <= max) return text.slice(0, Math.max(max, 0));
  const cut = text.lastIndexOf("\n\n", max - 1);
  return `${(cut > 0 ? text.slice(0, cut) : text.slice(0, max - 1)).trimEnd()}…`;
}

function byOrder<T extends BlendAnswer>(answers: readonly T[]) {
  return [...answers].sort(
    (a, b) => ANSWER_ORDER.indexOf(a.provider) - ANSWER_ORDER.indexOf(b.provider),
  );
}

/**
 * The answers the box has switched on, averaged by weight. One answer is
 * itself. A 0 beside real figures is left out of that figure. Weights are
 * shared out again over whoever is included; when every included weight is 0
 * they count equally, so the average still has somewhere to stand.
 */
export function blendEstimates(
  answers: readonly BlendAnswer[],
  weights: EstimateWeights = DEFAULT_WEIGHTS,
): { estimate: MealEstimate; provider: Estimator } | null {
  const top = byOrder(answers);
  if (!top.length) return null;
  if (top.length === 1) return { estimate: top[0].estimate, provider: top[0].provider };

  const weightOf = (provider: AnswerProvider) => {
    const value = weights[provider];
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const weighed = (provider: AnswerProvider, list: readonly BlendAnswer[]) => {
    const total = list.reduce((sum, answer) => sum + weightOf(answer.provider), 0);
    return total > 0 ? weightOf(provider) : 1;
  };
  const mass = (list: readonly BlendAnswer[]) => {
    const total = list.reduce((sum, answer) => sum + weightOf(answer.provider), 0);
    return total > 0 ? total : list.length;
  };
  const mean = (key: Figure) => {
    const given = top.filter((answer) => (answer.estimate[key] ?? 0) > 0);
    if (!given.length) return 0;
    return given.reduce(
      (sum, answer) => sum + (answer.estimate[key] ?? 0) * weighed(answer.provider, given),
      0,
    ) / mass(given);
  };
  const macros = Object.fromEntries(FIGURES.map((key) => [key, mean(key)])) as Record<Figure, number>;
  const scale = mass(top);
  const shares = top.map(
    (answer) => `${ESTIMATORS[answer.provider]} ${Math.round((weighed(answer.provider, top) / scale) * 100)}%`,
  );
  const [first] = top;
  const footing = top.every((answer) => answer.estimate.confidence === first.estimate.confidence)
    ? `each ${first.estimate.confidence} confidence`
    : top.map((answer) => `${ESTIMATORS[answer.provider]} ${answer.estimate.confidence} confidence`).join(", ");
  const header = `Weighted average of ${shares.slice(0, -1).join(", ")} and ${shares[shares.length - 1]}, ${footing}. A 0 is left out of that figure's average.`;
  const room = Math.floor((3000 - header.length) / top.length) - 2;
  const confidence = top.reduce(
    (low, answer) => (RANK[answer.estimate.confidence] < RANK[low] ? answer.estimate.confidence : low),
    "high" as MealEstimate["confidence"],
  );
  const lead = top.reduce((best, answer) =>
    weightOf(answer.provider) > weightOf(best.provider) ? answer : best,
  );
  return {
    estimate: {
      name: lead.estimate.name.slice(0, 300),
      calories: round1(macros.calories),
      protein: round1(macros.protein),
      carbs: round1(macros.carbs),
      fat: round1(macros.fat),
      fiber: round1(Math.min(macros.fiber, macros.carbs)),
      alcohol: round1(macros.alcohol),
      assumptions: [
        header,
        ...top.map((answer) => {
          const line = `From ${ESTIMATORS[answer.provider]} ${brackets(answer.estimate)}:\n`;
          return line + shorten(answer.estimate.assumptions, room - line.length);
        }),
      ].join("\n\n").slice(0, 3000),
      confidence,
    },
    provider: "average",
  };
}
