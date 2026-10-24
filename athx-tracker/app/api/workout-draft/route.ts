import { z } from "zod";
import { BodyTooLarge, database, guard, json, readBody, runtime, tooLarge } from "@/lib/server";
import { gatewayAllowed } from "@/lib/gateway";
import { workoutDraftSchema } from "@/lib/workout-draft";

const requestSchema = z.object({
  description: z.string().trim().min(3).max(4000),
  athletes: z.array(z.enum(["hippos", "gators"])).min(1).max(2)
    .refine(sides => new Set(sides).size === sides.length),
  weightUnit: z.enum(["kg", "lb"]),
}).strict();
const BUDGET_MS = 61_600;

export async function POST(request: Request) {
  const rejected = await guard(request, true);
  if (rejected) return rejected;
  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await readBody(request));
  } catch (error) {
    if (error instanceof BodyTooLarge) return tooLarge();
    return json({ error: "Describe the workout (3–4000 characters) and choose who it is for." }, 400);
  }
  const config = runtime();
  // Reuse subscription-authenticated CLIs. Never fall back to a metered API.
  if (!config.GROK_GATEWAY_URL || !config.GROK_GATEWAY_TOKEN)
    return json({ error: "Connect the subscription-backed estimator in Setup to fill workouts with AI. You can still fill the form by hand." }, 503);
  if (!gatewayAllowed(config.GROK_GATEWAY_URL))
    return json({ error: "The estimator address must be HTTPS, or on your private network." }, 503);

  const bucket = `workout:${new Date().toISOString().slice(0, 10)}`;
  const sqlite = database();
  const claimed = sqlite.transaction(() => {
    const row = sqlite.prepare("SELECT count FROM estimate_limits WHERE id = ?").get(bucket) as { count: number } | undefined;
    if ((row?.count ?? 0) >= 60) return false;
    sqlite.prepare("INSERT INTO estimate_limits (id, count) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET count = count + 1").run(bucket);
    return true;
  })();
  if (!claimed) return json({ error: "The team's 60 daily workout drafts have been used. Fill the form by hand or try tomorrow." }, 429);
  let success = false;
  try {
    const response = await fetch(config.GROK_GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.GROK_GATEWAY_TOKEN}` },
      body: JSON.stringify({ ...input, task: "workout", budgetMs: BUDGET_MS }),
      signal: AbortSignal.timeout(BUDGET_MS + 5000),
    });
    if (!response.ok) {
      const detail = await response.json().then((body: { detail?: unknown }) =>
        typeof body.detail === "string" ? body.detail.slice(0, 300) : "").catch(() => "");
      return json({ error: response.status === 401
        ? "The estimator rejected our token. Check both sides match."
        : `The AI could not fill this workout. Try again or fill it by hand.${detail ? ` ${detail}` : ""}` }, 502);
    }
    const parsed = workoutDraftSchema.safeParse(await response.json());
    if (!parsed.success)
      return json({ error: "The AI returned an unusable workout. Your form is unchanged. Try again with more detail." }, 502);
    const provider = ["codex", "claude", "grok"].find(name => name === response.headers.get("x-athx-provider"));
    success = true;
    return json({ draft: parsed.data, ...(provider ? { provider } : {}) });
  } catch {
    return json({ error: "The estimator did not answer with a workout. Your description is kept; try again or fill the form by hand." }, 503);
  } finally {
    if (!success) sqlite.prepare("UPDATE estimate_limits SET count = MAX(0, count - 1) WHERE id = ?").run(bucket);
  }
}
