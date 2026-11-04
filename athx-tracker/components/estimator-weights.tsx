"use client";

import { ESTIMATORS } from "@/lib/domain";
import type { PartialEstimate } from "@/lib/estimate-stream";
import {
  ANSWER_ORDER,
  blendEstimates,
  type AnswerProvider,
  type EstimateWeights,
} from "@/lib/estimate-blend";
import type { MealEstimate } from "@/lib/estimate-conversation";

/** An answer's totals on one line, short enough to sit beside its slider on a phone. */
function totalsOf(estimate: Pick<MealEstimate, "calories" | "protein" | "carbs" | "fat" | "fiber" | "alcohol">) {
  return [
    `${Math.round(estimate.calories)} kcal`,
    `${Math.round(estimate.protein)}P`,
    `${Math.round(estimate.carbs)}C`,
    `${Math.round(estimate.fat)}F`,
    ...(estimate.fiber ? [`${Math.round(estimate.fiber)} fiber`] : []),
    ...(estimate.alcohol ? [`${Math.round(estimate.alcohol)} ethanol`] : []),
  ].join(" · ");
}

/**
 * Each estimator's totals and how much it counts, at the foot of the meal.
 * The share is the one the average gives it: its weight over the weights of
 * whoever is included, or an even share when those are all 0. Moving a
 * slider reweighs the meal at once, and the weight is this phone's default
 * for the next meal too. A 0 a figure was given is still left out of that
 * figure's average, as the estimator leaves it out.
 */
export function EstimatorWeights({
  partials,
  included,
  weights,
  onToggle,
  onWeight,
}: {
  partials: PartialEstimate[];
  included: readonly AnswerProvider[];
  weights: EstimateWeights;
  onToggle: (provider: AnswerProvider) => void;
  onWeight: (provider: AnswerProvider, weight: number) => void;
}) {
  if (!partials.length) return null;
  const shown = [...partials].sort(
    (a, b) => ANSWER_ORDER.indexOf(a.provider) - ANSWER_ORDER.indexOf(b.provider),
  );
  const counted = shown.filter((answer) => included.includes(answer.provider));
  const mass = counted.reduce((sum, answer) => sum + Math.max(weights[answer.provider], 0), 0);
  const share = (provider: AnswerProvider) =>
    mass > 0 ? Math.max(weights[provider], 0) / mass : 1 / Math.max(counted.length, 1);
  const blended = counted.length > 1 ? blendEstimates(counted, weights)?.estimate : null;
  return (
    <section aria-label="Estimator weights" className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
      <div>
        <h3 className="text-sm font-semibold">Estimator weights</h3>
        <p className="text-[11px] text-muted-foreground">
          How much each answer counts in the meal. The weights stay on this phone for the next meal.
        </p>
      </div>
      <ul className="space-y-3">
        {shown.map(({ provider, estimate }) => {
          const on = included.includes(provider);
          const name = ESTIMATORS[provider];
          return (
            <li key={provider} className={`space-y-1.5 rounded-xl border p-3 ${on ? "" : "opacity-60"}`}>
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && counted.length === 1}
                  aria-label={`Include ${name}`}
                  onChange={() => onToggle(provider)}
                  className="size-4 shrink-0 accent-primary"
                />
                <p className="font-bold">{name}</p>
                <p className="ml-auto text-muted-foreground tabular-nums">
                  {on ? `${Math.round(share(provider) * 100)}% of the meal` : "Left out"}
                </p>
              </div>
              <p className="text-xs font-medium tabular-nums">
                {totalsOf(estimate)}
                <span className="font-normal text-muted-foreground"> · {estimate.confidence} confidence</span>
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3">
                <input
                  type="range"
                  className="w-full accent-primary"
                  aria-label={`${name} weight`}
                  aria-valuetext={`${weights[provider]}${on ? `, ${Math.round(share(provider) * 100)}% of the meal` : ", left out"}`}
                  min={0}
                  max={100}
                  step={1}
                  value={weights[provider]}
                  onChange={(event) => onWeight(provider, event.target.valueAsNumber)}
                />
                <output aria-hidden className="text-right text-xs font-medium tabular-nums">
                  {weights[provider]}
                </output>
              </div>
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite" aria-atomic="true" className="text-xs tabular-nums">
        {blended ? (
          <>
            <span className="font-semibold">Weighted average</span> · {totalsOf(blended)}
          </>
        ) : shown.length === 1 ? (
          <span className="text-muted-foreground">
            Only {ESTIMATORS[shown[0].provider]} answered, so the meal is its answer.
          </span>
        ) : (
          <span className="text-muted-foreground">
            Only {ESTIMATORS[counted[0]?.provider ?? shown[0].provider]} counts, so the meal is its answer. Include
            another to average them.
          </span>
        )}
      </p>
    </section>
  );
}
