import { z } from "zod";
import { BodyTooLarge, guard, json, readBody, runtime, tooLarge } from "@/lib/server";
import { gatewayAllowed } from "@/lib/gateway";
import { workoutSchema } from "@/lib/validation";
import { burnAnswerSchema, burnPayload } from "@/lib/workout-burn";
import { claimWorkoutCall, releaseWorkoutCall, WORKOUT_CALLS_A_DAY } from "@/lib/workout-limit";

const bodyweight = z.number().finite().positive().max(500).optional();
// Each athlete's record as it is about to be saved, checked as the records API checks it.
const requestSchema = z.object({
  workouts: z.object({ hippos: workoutSchema.optional(), gators: workoutSchema.optional() }).strict()
    .refine((workouts) => Boolean(workouts.hippos || workouts.gators)),
  description: z.string().trim().max(4000).optional(),
  bodyweightKg: z.object({ hippos: bodyweight, gators: bodyweight }).strict(),
}).strict();
// As long as a draft is given, since the estimator is asked the same way.
const BUDGET_MS = 61_600;

/**
 * A session's burn worked out again, for a save whose edits left AI's figure
 * out of date. Answers each athlete's burn and its working, and saves nothing.
 */
export async function POST(request: Request) {
  const rejected = await guard(request, true);
  if (rejected) return rejected;
  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await readBody(request));
  } catch (error) {
    if (error instanceof BodyTooLarge) return tooLarge();
    return json({ error: "Send each athlete's workout and weight to work the burn out." }, 400);
  }
  const config = runtime();
  // Reuse subscription-authenticated CLIs. Never fall back to a metered API.
  if (!config.GROK_GATEWAY_URL || !config.GROK_GATEWAY_TOKEN)
    return json({ error: "Connect the subscription-backed estimator in Setup to work a burn out with AI." }, 503);
  if (!gatewayAllowed(config.GROK_GATEWAY_URL))
    return json({ error: "The estimator address must be HTTPS, or on your private network." }, 503);

  const bucket = claimWorkoutCall();
  if (!bucket) return json({ error: `The team's ${WORKOUT_CALLS_A_DAY} daily workout AI calls have been used.` }, 429);
  let success = false;
  try {
    const response = await fetch(config.GROK_GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.GROK_GATEWAY_TOKEN}` },
      body: JSON.stringify({ ...burnPayload(input), budgetMs: BUDGET_MS }),
      signal: AbortSignal.timeout(BUDGET_MS + 5000),
    });
    if (!response.ok) {
      const detail = await response.json().then((body: { detail?: unknown; error?: unknown }) =>
        typeof body.detail === "string" ? body.detail.slice(0, 300)
          // An estimator from before this task refuses it by name.
          : body.error === "Unknown task." ? "The estimator needs updating to work a burn out again." : "")
        .catch(() => "");
      return json({ error: response.status === 401
        ? "The estimator rejected our token. Check both sides match."
        : `The AI could not work the burn out.${detail ? ` ${detail}` : ""}` }, 502);
    }
    const parsed = burnAnswerSchema.safeParse(await response.json());
    if (!parsed.success) return json({ error: "The AI returned an unusable burn." }, 502);
    const provider = ["codex", "claude", "grok"].find(name => name === response.headers.get("x-athx-provider"));
    success = true;
    return json({ ...parsed.data, ...(provider ? { provider } : {}) });
  } catch {
    return json({ error: "The estimator did not answer with a burn." }, 503);
  } finally {
    if (!success) releaseWorkoutCall(bucket);
  }
}
