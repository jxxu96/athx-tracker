"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ESTIMATORS, type Meal } from "@/lib/domain";
import type { PartialEstimate } from "@/lib/estimate-stream";
import {
  ANSWER_ORDER,
  blendEstimates,
  type AnswerProvider,
  type EstimateWeights,
} from "@/lib/estimate-blend";
import type { MealEstimate } from "@/lib/estimate-conversation";
import { ETHANOL_LIMIT, FIBER_LIMIT, MACRO_LIMITS } from "@/lib/meal-dishes";

/** One estimator's answer, which may carry figures you typed over its own. */
export type Answer = PartialEstimate & { edited?: boolean };

export type AnswerFigure = "calories" | "protein" | "carbs" | "fiber" | "fat" | "alcohol";

const FIGURES: readonly { key: AnswerFigure; label: string; limit: number }[] = [
  { key: "calories", label: "kcal", limit: MACRO_LIMITS.calories },
  { key: "protein", label: "P", limit: MACRO_LIMITS.protein },
  { key: "carbs", label: "C", limit: MACRO_LIMITS.carbs },
  { key: "fiber", label: "Fib", limit: FIBER_LIMIT },
  { key: "fat", label: "F", limit: MACRO_LIMITS.fat },
];
const ETHANOL = { key: "alcohol", label: "EtOH", limit: ETHANOL_LIMIT } as const;

const SPOKEN: Record<AnswerFigure, string> = {
  calories: "calories",
  protein: "protein",
  carbs: "carbs",
  fiber: "fiber",
  fat: "fat",
  alcohol: "ethanol",
};

/** An answer's totals on one line. */
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
 * One of an answer's figures, to type over. It shows the figure until it is
 * typed in, then what is typed, so "12." can become "12.5"; a number from 0
 * to the meal's own limit counts as soon as it is one.
 */
function FigureBox({
  label,
  name,
  value,
  limit,
  onChange,
}: {
  label: string;
  name: string;
  value: number;
  limit: number;
  onChange: (value: number) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <label className="min-w-0 space-y-0.5">
      <span aria-hidden className="block text-[10px] text-muted-foreground">{label}</span>
      <Input
        aria-label={name}
        value={typed ?? String(Math.round(value * 10) / 10)}
        inputMode="decimal"
        className="h-8 px-1.5 text-center text-xs tabular-nums"
        onFocus={(event) => setTyped(event.target.value)}
        onBlur={() => setTyped(null)}
        onChange={(event) => {
          const text = event.target.value;
          setTyped(text);
          const number = text.trim() === "" ? 0 : Number(text);
          if (Number.isFinite(number) && number >= 0 && number <= limit) onChange(number);
        }}
      />
    </label>
  );
}

/**
 * Each estimator's figures and how much it counts, at the top of the meal:
 * the macros alone, which you can type over, and a slider for its weight.
 * The share is the one the average gives it: its weight over the weights of
 * whoever is included, or an even share when those are all 0. Moving a
 * slider or changing a figure reweighs the meal at once, and the weight is
 * this phone's default for the next meal too. A 0 a figure was given is
 * still left out of that figure's average, as the estimator leaves it out.
 */
export function EstimatorWeights({
  answers,
  included,
  weights,
  sitting,
  onToggle,
  onWeight,
  onFigure,
}: {
  answers: Answer[];
  included: readonly AnswerProvider[];
  weights: EstimateWeights;
  sitting: Meal["meal"];
  onToggle: (provider: AnswerProvider) => void;
  onWeight: (provider: AnswerProvider, weight: number) => void;
  onFigure: (provider: AnswerProvider, figure: AnswerFigure, value: number) => void;
}) {
  if (!answers.length) return null;
  const shown = [...answers].sort(
    (a, b) => ANSWER_ORDER.indexOf(a.provider) - ANSWER_ORDER.indexOf(b.provider),
  );
  const counted = shown.filter((answer) => included.includes(answer.provider));
  const mass = counted.reduce((sum, answer) => sum + Math.max(weights[answer.provider], 0), 0);
  const share = (provider: AnswerProvider) =>
    mass > 0 ? Math.max(weights[provider], 0) / mass : 1 / Math.max(counted.length, 1);
  const blended = counted.length > 1 ? blendEstimates(counted, weights)?.estimate : null;
  const figures = sitting === "Alcohol" ? [...FIGURES, ETHANOL] : FIGURES;
  return (
    <section aria-label="Estimator weights" className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
      <div>
        <h3 className="text-sm font-semibold">Estimator weights</h3>
        <p className="text-[11px] text-muted-foreground">
          Each estimator&apos;s macros, to correct, and how much it counts. Weights stay on this phone for the next meal.
        </p>
      </div>
      <ul className="space-y-2">
        {shown.map(({ provider, estimate, edited }) => {
          const on = included.includes(provider);
          const name = ESTIMATORS[provider];
          return (
            <li key={provider} className={`space-y-2 rounded-xl border p-2.5 ${on ? "" : "opacity-60"}`}>
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
                {edited ? <p className="text-[11px] text-muted-foreground">edited</p> : null}
                <p className="ml-auto text-muted-foreground tabular-nums">
                  {on ? `${Math.round(share(provider) * 100)}% of the meal` : "Left out"}
                </p>
              </div>
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0, 1fr))` }}
              >
                {figures.map(({ key, label, limit }) => (
                  <FigureBox
                    key={key}
                    label={label}
                    name={`${name} ${SPOKEN[key]}`}
                    value={estimate[key] ?? 0}
                    limit={limit}
                    onChange={(value) => onFigure(provider, key, value)}
                  />
                ))}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2">
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
