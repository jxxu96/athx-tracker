import { ESTIMATORS, type Estimator } from "./domain.ts";
import type { MealEstimate } from "./estimate-conversation.ts";

/**
 * A meal estimate, streamed. Each estimator's answer arrives as it lands, so
 * the form can show it while the rest are still working, and the settled
 * answer, or the failure, comes last. One JSON object per line.
 */
export const NDJSON = "application/x-ndjson";

export type EstimateEvent =
  | { type: "partial"; provider: Exclude<Estimator, "average">; estimate: MealEstimate }
  | { type: "done"; provider?: Estimator; estimate: MealEstimate }
  | { type: "error"; status: number; error: string };

export type PartialEstimate = Extract<EstimateEvent, { type: "partial" }>;

export const UNUSABLE = {
  type: "error",
  status: 502,
  error: "The estimator answered with something unusable. Try again, or enter the macros by hand.",
} as const satisfies EstimateEvent;

export const UNANSWERED = {
  type: "error",
  status: 503,
  error: "The estimator did not answer. Check it is running, or enter the macros by hand.",
} as const satisfies EstimateEvent;

/** The estimator's name for itself, if it is one this app knows. */
export function namedEstimator(value: unknown): Estimator | undefined {
  return typeof value === "string" && value in ESTIMATORS ? (value as Estimator) : undefined;
}

/** Whole lines out of a byte stream, however its chunks happen to be cut. */
export async function* ndjsonLines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  // stream: true holds a character cut between two chunks until its rest arrives.
  const decoder = new TextDecoder();
  let held = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      held += decoder.decode(value, { stream: true });
      for (let end = held.indexOf("\n"); end >= 0; end = held.indexOf("\n")) {
        const line = held.slice(0, end).trim();
        held = held.slice(end + 1);
        if (line) yield line;
      }
    }
    held += decoder.decode();
    if (held.trim()) yield held.trim();
  } finally {
    // Left early, the stream is cancelled so the request behind it ends too.
    await reader.cancel().catch(() => {});
  }
}

/**
 * What the estimator streams, as the browser may see it. Every estimate is
 * checked first: a partial that fails is dropped, a final one that fails is
 * the estimator's fault. Exactly one done or error ends it, whether the
 * estimator said so or the stream simply stopped.
 */
export async function* relayEstimate(
  lines: AsyncIterable<string>,
  valid: (value: unknown) => MealEstimate | null,
): AsyncGenerator<EstimateEvent> {
  try {
    for await (const line of lines) {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (!event || typeof event !== "object") continue;
      const { type, provider, estimate, detail } = event as Record<string, unknown>;
      const named = namedEstimator(provider);
      if (type === "partial") {
        const checked = valid(estimate);
        if (checked && named && named !== "average")
          yield { type: "partial", provider: named, estimate: checked };
      } else if (type === "done") {
        const checked = valid(estimate);
        yield checked ? { type: "done", estimate: checked, ...(named ? { provider: named } : {}) } : UNUSABLE;
        return;
      } else if (type === "error") {
        // Which CLI failed and why is the whole diagnosis, so it is passed on.
        const why = typeof detail === "string" ? detail.slice(0, 300) : "";
        yield {
          type: "error",
          status: 502,
          error: why
            ? `No estimator could answer — ${why}`
            : "No estimator could answer. Try again, or enter the macros by hand.",
        };
        return;
      }
    }
  } catch {
    // Cut off mid-answer: a timeout, or the estimator going away.
  }
  yield UNANSWERED;
}

type Settled = { estimate: MealEstimate; provider?: Estimator };

function failure(text: string, status: number) {
  const error = new Error(text);
  (error as Error & { status?: number }).status = status;
  return error;
}

/**
 * The answer to POST /api/estimate. A stream reports each estimator as it
 * lands; a plain JSON body, from the direct API or an estimator from before
 * streaming, is the answer alone. Either way a failure throws with its status,
 * as api() does.
 */
export async function readEstimate(
  response: Response,
  onPartial?: (partial: PartialEstimate) => void,
): Promise<Settled> {
  if (!response.headers.get("content-type")?.includes(NDJSON) || !response.body) {
    const data = (await response.json().catch(() => null)) as (Settled & { error?: string }) | null;
    if (!response.ok || !data) throw failure(data?.error ?? "Something went wrong. Try again.", response.status);
    return data;
  }
  for await (const line of ndjsonLines(response.body)) {
    let event: EstimateEvent;
    try {
      event = JSON.parse(line) as EstimateEvent;
    } catch {
      continue;
    }
    if (event.type === "partial") onPartial?.(event);
    else if (event.type === "done") return { estimate: event.estimate, ...(event.provider ? { provider: event.provider } : {}) };
    else if (event.type === "error") throw failure(event.error, event.status);
  }
  throw failure(UNANSWERED.error, UNANSWERED.status);
}
