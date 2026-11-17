"use client";

import type { Answer } from "@/components/meal/estimator-weights";
import { ESTIMATORS } from "@/lib/domain";
import { ANSWER_ORDER, type AnswerProvider } from "@/lib/estimate-blend";
import type { MissedEstimate } from "@/lib/estimate-stream";
import { figuresOf } from "./form-model";

/**
 * Each estimator that was asked and gave nothing, and the reason it gave: not
 * signed in, timed out, out of time. The others may have answered, so this is
 * the only place a provider that keeps failing says so.
 */
export function Missed({ missed }: { missed: MissedEstimate[] }) {
  if (!missed.length) return null;
  const shown = [...missed].sort(
    (a, b) => ANSWER_ORDER.indexOf(a.provider) - ANSWER_ORDER.indexOf(b.provider),
  );
  return (
    <ul aria-label="No answer from" className="space-y-1 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
      {shown.map(({ provider, detail }) => (
        <li key={provider} className="break-words">
          <span className="font-bold text-foreground">{ESTIMATORS[provider]}</span> did not answer
          {detail ? `: ${detail}` : "."}
        </li>
      ))}
    </ul>
  );
}

/**
 * Each estimator that has answered. The settled figures may still average
 * them, or keep only the ones that found a label. Every model's own description
 * stays here, bold name first and a rule under the section. Once the estimate
 * has finished, an answer left out of the meal is dimmed; which ones count,
 * how much, and their figures are set under Estimator weights at the top of
 * the form. This is each one's working, which is not repeated anywhere else.
 */
export function SoFar({
  partials,
  included,
}: {
  partials: Answer[];
  /** Which answers the meal uses, once it has settled. */
  included?: readonly AnswerProvider[];
}) {
  if (!partials.length) return null;
  const shown = [...partials].sort(
    (a, b) => ANSWER_ORDER.indexOf(a.provider) - ANSWER_ORDER.indexOf(b.provider),
  );
  return (
    <div role="status" aria-label="Answers so far" className="space-y-3 rounded-xl border bg-muted/40 p-3 text-xs">
      <p className="font-medium">Answers so far</p>
      <ul className="space-y-3">
        {shown.map(({ provider, estimate, edited }) => {
          const on = !included || included.includes(provider);
          const name = ESTIMATORS[provider];
          return (
            <li key={provider} className={`space-y-1 ${on ? "" : "opacity-60"}`}>
              <div className="flex items-center gap-2">
                <p className="font-bold">{name}</p>
                {edited ? <p className="text-muted-foreground">figures edited by you</p> : null}
              </div>
              <p className="font-medium">
                {figuresOf(estimate)}
                <span className="font-normal text-muted-foreground"> · {estimate.confidence} confidence</span>
              </p>
              <p className="whitespace-pre-wrap break-words">{estimate.assumptions}</p>
              <p aria-hidden="true" className="font-mono text-muted-foreground">________</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
