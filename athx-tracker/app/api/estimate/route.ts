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

    if (!claimEstimate(new Date().toISOString().slice(0, 10)))
      return json(
        {
          error:
            "The team's 60 daily estimates have been used. Enter this meal manually or try tomorrow.",
        },
        429,
      );

    const gateway = Boolean(config.GROK_GATEWAY_URL && config.GROK_GATEWAY_TOKEN);
    if (gateway && !config.GROK_GATEWAY_URL?.startsWith("https://"))
      return json({ error: "The food connection needs HTTPS." }, 503);

    const response = await fetch(
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
    if (!response.ok)
      return json(
        {
          error:
            "Grok could not estimate this meal. Try again shortly or enter the macros manually.",
        },
        502,
      );
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
