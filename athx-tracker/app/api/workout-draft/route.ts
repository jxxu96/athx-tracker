import { z } from "zod";
import { BodyTooLarge, guard, json, readBody, runtime, tooLarge } from "@/lib/server";
import { gatewayAllowed } from "@/lib/gateway";
import { claimWorkoutCall, releaseWorkoutCall, WORKOUT_CALLS_A_DAY } from "@/lib/workout-limit";
import { workoutDraftSchema } from "@/lib/workout-draft";

const requestSchema = z.object({
  description: z.string().trim().min(3).max(4000),
  athletes: z.array(z.enum(["hippos", "gators"])).min(1).max(2)
    .refine(sides => new Set(sides).size === sides.length),
  weightUnit: z.enum(["kg", "lb"]),
  // Each athlete's weight on the session's day, which asks for a burn as well.
  bodyweightKg: z.object({
    hippos: z.number().finite().positive().max(500).optional(),
    gators: z.number().finite().positive().max(500).optional(),
  }).strict().optional(),
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

  const bucket = claimWorkoutCall();
  if (!bucket) return json({ error: `The team's ${WORKOUT_CALLS_A_DAY} daily workout drafts have been used. Fill the form by hand or try tomorrow.` }, 429);
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
    if (!success) releaseWorkoutCall(bucket);
  }
}
