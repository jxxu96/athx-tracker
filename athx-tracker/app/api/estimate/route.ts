import { database, guard, json, readBody, runtime } from "@/lib/server";
import { grokRequest, extractEstimate } from "@/lib/grok";
import { macroSchema } from "@/lib/validation";
import { z } from "zod";

const DAILY_LIMIT = 60;

const estimateSchema = macroSchema.extend({
  name: z.string().min(1).max(300),
  assumptions: z.string().max(3000),
  confidence: z.enum(["low", "medium", "high"]),
});

/**
 * A gateway must be HTTPS on the open internet, but plain HTTP is fine when the
 * host is on a private network or a tailnet, where the transport is already
 * encrypted and the estimator is not publicly reachable.
 */
function gatewayAllowed(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    // Tailscale hands out 100.64.0.0/10.
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    host.endsWith(".ts.net")
  );
}

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

  try {
    const response = await fetch(new URL("/health", config.GROK_GATEWAY_URL!), {
      headers: { Authorization: `Bearer ${config.GROK_GATEWAY_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401)
      return json({
        status: "error",
        detail: "The estimator rejected the token. Check both sides match.",
      });
    if (!response.ok)
      return json({ status: "error", detail: `Estimator replied ${response.status}.` });
    const body = (await response.json()) as { order?: unknown };
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    return json(
      order.length
        ? { status: "ready", detail: `Reachable, trying ${order.join(" then ")}.` }
        : {
            status: "error",
            detail: "Reachable, but it has no CLI configured to ask.",
          },
    );
  } catch {
    return json({
      status: "unreachable",
      detail: "No answer. Is that machine awake with the estimator running?",
    });
  }
}

/** Give back a slot when the estimator, not the description, was the problem. */
function releaseEstimate(bucket: string) {
  database()
    .prepare("UPDATE estimate_limits SET count = MAX(0, count - 1) WHERE id = ?")
    .run(bucket);
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
    const { description } = z
      .object({ description: z.string().trim().min(3).max(4000) })
      .parse(await readBody(request));

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
              ? { description }
              : grokRequest(description, config.XAI_MODEL || "grok-4.7"),
          ),
          signal: AbortSignal.timeout(45000),
        },
      );
    } catch {
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
      return json(
        {
          error:
            response.status === 401
              ? "The estimator rejected our token. Check both sides match."
              : "The estimator could not read this meal. Try again, or enter the macros by hand.",
        },
        502,
      );
    }
    const result = await response.json();
    const estimate = estimateSchema.parse(
      gateway ? result : extractEstimate(result),
    );
    return json({ estimate });
  } catch {
    return json(
      {
        error:
          "Could not read a valid estimate. Add portions and try again, or enter macros manually.",
      },
      400,
    );
  }
}
