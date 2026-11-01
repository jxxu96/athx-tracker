import {
  BodyTooLarge, database, guard, json, readBody, runtime, storedFoodNotes, tooLarge,
} from "@/lib/server";
import { grokRequest, extractEstimate } from "@/lib/grok";
import { gatewayAllowed } from "@/lib/gateway";
import { estimateRequestSchema, estimateSchema } from "@/lib/validation";
import { estimatePrompt } from "@/lib/estimate-conversation";
import { NDJSON, namedEstimator, ndjsonLines, relayEstimate } from "@/lib/estimate-stream";

const DAILY_LIMIT = 60;

/**
 * Long enough for the first model to look a named product up, plus the reserve
 * the estimator holds so a simple meal's fallback can search too. These are
 * MEAL_PROVIDER_MS and MEAL_RESERVE_MS in estimator/server.mjs. A complex meal
 * asks everyone at once and needs only the first. The queue remains the path
 * with no one waiting.
 */
const INTERACTIVE_BUDGET_MS = 90_000 + 40_000;


/** Counts in the database, not in memory, so a restart cannot reset the budget. */
function claimEstimate(bucket: string) {
  const sqlite = database();
  return sqlite.transaction((day: string) => {
    const row = sqlite
      .prepare("SELECT count FROM estimate_limits WHERE id = ?")
      .get(day) as { count: number } | undefined;
    const next = (row?.count ?? 0) + 1;
    if (next > DAILY_LIMIT) return null;
    sqlite
      .prepare(
        "INSERT INTO estimate_limits (id, count) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET count = excluded.count",
      )
      .run(day, next);
    return next;
  })(bucket);
}

/**
 * Is an estimator actually reachable? The Setup screen asks this, because
 * "configured" and "answering" are different things when the estimator is a
 * service on a laptop that may be asleep.
 */
export async function GET(request: Request) {
  const rejected = await guard(request);
  if (rejected) return rejected;
  const config = runtime();

  const gateway = Boolean(config.GROK_GATEWAY_URL && config.GROK_GATEWAY_TOKEN);
  if (!gateway)
    return json(
      config.XAI_API_KEY
        ? { status: "ready", detail: "Calling the x.ai API directly." }
        : {
            status: "manual",
            detail: "No estimator configured. Macros are entered by hand.",
          },
    );

  if (!gatewayAllowed(config.GROK_GATEWAY_URL!))
    return json({
      status: "error",
      detail: "The estimator address must be HTTPS, or on your private network.",
    });

  // Naming the target turns "unreachable" into something diagnosable: it says
  // whether the app is pointed at the in-stack estimator or one on a laptop.
  const target = (() => {
    try {
      return new URL(config.GROK_GATEWAY_URL!).host;
    } catch (error) {
      if (error instanceof BodyTooLarge) return tooLarge();
      return "the configured address";
    }
  })();

  try {
    const response = await fetch(new URL("/health", config.GROK_GATEWAY_URL!), {
      headers: { Authorization: `Bearer ${config.GROK_GATEWAY_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401)
      return json({
        status: "error",
        detail: `${target} rejected the token. Check both sides match.`,
      });
    if (!response.ok)
      return json({
        status: "error",
        detail: `${target} replied ${response.status}.`,
      });
    const body = (await response.json()) as { order?: unknown };
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    return json(
      order.length
        ? {
            status: "ready",
            detail: `${target} reachable, trying ${order.join(" then ")}.`,
          }
        : {
            status: "error",
            detail: "Reachable, but it has no CLI configured to ask.",
          },
    );
  } catch (error) {
    if (error instanceof BodyTooLarge) return tooLarge();
    return json({
      status: "unreachable",
      detail: `No answer from ${target}. Is it running and reachable from the container?`,
    });
  }
}

/** Give back a slot when the estimator, not the description, was the problem. */
function releaseEstimate(bucket: string) {
  database()
    .prepare("UPDATE estimate_limits SET count = MAX(0, count - 1) WHERE id = ?")
    .run(bucket);
}

/** Checked as any answer is: the stream is untrusted line by line. */
function usable(value: unknown) {
  const parsed = estimateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Each estimator's answer passed on as it lands, then the settled one. The
 * status went out before anyone answered, so a failure is the last line, and
 * the daily estimate is given back for it, or for a Stop, exactly once.
 */
function relay(body: ReadableStream<Uint8Array>, bucket: string, upstream: AbortController) {
  const events = relayEstimate(ndjsonLines(body), usable);
  const encoder = new TextEncoder();
  // Settled once: by the answer, by a failure, or by the caller leaving. A Stop
  // also cuts the estimator off, which ends the stream in a failure of its own,
  // and that must not give the estimate back a second time.
  let settled = false;
  const settle = (failed: boolean) => {
    if (settled) return;
    settled = true;
    if (failed) releaseEstimate(bucket);
  };
  let left = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await events.next();
        if (left) return;
        if (done) return controller.close();
        if (value.type !== "partial") settle(value.type === "error");
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      },
      async cancel() {
        left = true;
        upstream.abort();
        settle(true);
        await events.return(undefined);
      },
    }),
    { headers: { "Content-Type": NDJSON, "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const rejected = await guard(request, true);
  if (rejected) return rejected;
  const config = runtime();
  if (!config.XAI_API_KEY && !(config.GROK_GATEWAY_URL && config.GROK_GATEWAY_TOKEN))
    return json(
      { error: "Grok is not connected yet. You can still enter macros manually." },
      503,
    );
  try {
    const input = estimateRequestSchema.parse(await readBody(request));
    const description = estimatePrompt(input.description, input.refinement, storedFoodNotes());

    const bucket = new Date().toISOString().slice(0, 10);
    if (!claimEstimate(bucket))
      return json(
        {
          error:
            "The team's 60 daily estimates have been used. Enter this meal manually or try tomorrow.",
        },
        429,
      );

    const gateway = Boolean(config.GROK_GATEWAY_URL && config.GROK_GATEWAY_TOKEN);
    if (gateway && !gatewayAllowed(config.GROK_GATEWAY_URL!))
      return json(
        { error: "The food connection must be HTTPS, or on your private network." },
        503,
      );

    // The form asks for each estimator's answer as it lands. An estimator from
    // before streaming ignores the ask and answers once, as it always has.
    const streaming = gateway && (request.headers.get("accept") ?? "").includes(NDJSON);
    // Stop on the form hangs up, and the estimator stops its CLIs when this does.
    const upstream = new AbortController();
    const signals = [AbortSignal.timeout(INTERACTIVE_BUDGET_MS + 5000), upstream.signal, request.signal];

    // A failure to reach the estimator is not the same as a bad description, and
    // must not be reported as one. It also should not spend a daily estimate.
    let response: Response;
    try {
      response = await fetch(
        gateway ? config.GROK_GATEWAY_URL! : "https://api.x.ai/v1/responses",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${gateway ? config.GROK_GATEWAY_TOKEN : config.XAI_API_KEY}`,
          },
          body: JSON.stringify(
            gateway
              ? { description, budgetMs: INTERACTIVE_BUDGET_MS, ...(streaming ? { stream: true } : {}) }
              : grokRequest(description, config.XAI_MODEL || "grok-4.7"),
          ),
          signal: AbortSignal.any(signals),
        },
      );
    } catch (error) {
      if (error instanceof BodyTooLarge) return tooLarge();
      releaseEstimate(bucket);
      return json(
        {
          error:
            "The estimator did not answer. Check it is running, or enter the macros by hand.",
        },
        503,
      );
    }
    if (!response.ok) {
      releaseEstimate(bucket);
      if (response.status === 401)
        return json(
          { error: "The estimator rejected our token. Check both sides match." },
          502,
        );
      // The estimator names the CLI that failed and why. Saying "could not read
      // this meal" instead blames the description for what is usually a login
      // or a timeout, and sends you rewording a meal that was never the problem.
      const detail = await response
        .json()
        .then((body: unknown) =>
          body && typeof body === "object" && "detail" in body
            ? String((body as { detail: unknown }).detail).slice(0, 300)
            : "",
        )
        .catch(() => "");
      return json(
        {
          error: detail
            ? `No estimator could answer — ${detail}`
            : "No estimator could answer. Try again, or enter the macros by hand.",
        },
        502,
      );
    }
    if (streaming && response.body && (response.headers.get("content-type") ?? "").includes(NDJSON))
      return relay(response.body, bucket, upstream);
    // A 200 carrying nonsense is the estimator's fault, not the description's.
    // Left in the outer catch it became a 400, which tells you to reword a meal
    // that was never the problem, keeps the estimate you were charged for, and
    // stops the form offering the queue, since 400 is the one status it reads
    // as "rewording would help".
    let estimate;
    let provider: ReturnType<typeof namedEstimator>;
    try {
      const result = await response.json();
      estimate = estimateSchema.parse(
        gateway ? result : extractEstimate(result),
      );
      // The gateway names who answered in a header, so the body stays an
      // estimate. The direct API is Grok itself.
      provider = gateway ? namedEstimator(response.headers.get("x-athx-provider")) : "grok";
    } catch (error) {
      if (error instanceof BodyTooLarge) return tooLarge();
      releaseEstimate(bucket);
      return json(
        {
          error:
            "The estimator answered with something unusable. Try again, or enter the macros by hand.",
        },
        502,
      );
    }
    return json({ estimate, ...(provider ? { provider } : {}) });
  } catch (error) {
    if (error instanceof BodyTooLarge) return tooLarge();
    return json(
      {
        error:
          "Could not read a valid estimate. Add portions and try again, or enter macros manually.",
      },
      400,
    );
  }
}
