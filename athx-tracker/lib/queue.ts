import { z } from "zod";
import { database, runtime } from "./server";
import { macroSchema } from "./validation";
import type { Meal } from "./domain";

/**
 * Meals saved while the estimator was unreachable are stored with source
 * "queued" and the description kept in assumptions. No separate table: the
 * queue is just those meals, so nothing can drift out of step with the journal.
 */
const estimateSchema = macroSchema.extend({
  name: z.string().min(1).max(300),
  assumptions: z.string().max(3000),
  confidence: z.enum(["low", "medium", "high"]),
});

const RETRY_EVERY_MS = 2 * 60 * 1000;

async function estimate(description: string) {
  const config = runtime();
  if (!config.GROK_GATEWAY_URL || !config.GROK_GATEWAY_TOKEN) return null;
  const response = await fetch(config.GROK_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.GROK_GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({ description }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) return null;
  return estimateSchema.parse(await response.json());
}

function queuedMeals(): Meal[] {
  const rows = database()
    .prepare("SELECT payload FROM records WHERE kind = 'meal'")
    .all() as { payload: string }[];
  return rows
    .map((row) => JSON.parse(row.payload) as Meal)
    .filter((meal) => meal.source === "queued");
}

export async function drainQueue() {
  const pending = queuedMeals();
  if (pending.length === 0) return 0;

  let filled = 0;
  for (const meal of pending) {
    const result = await estimate(meal.assumptions).catch(() => null);
    // Still unavailable: stop rather than burn through the rest and fail each.
    if (!result) {
      console.log(
        `[queue] estimator unavailable; ${pending.length - filled} meal(s) still waiting`,
      );
      break;
    }

    const updated: Meal = {
      ...meal,
      name: meal.name.trim() || result.name,
      macros: {
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
      },
      assumptions: result.assumptions,
      source: "grok",
    };
    database()
      .prepare("UPDATE records SET payload = ? WHERE id = ?")
      .run(JSON.stringify(updated), meal.id);
    filled += 1;
  }
  if (filled) console.log(`[queue] filled ${filled} queued meal(s)`);
  return filled;
}

/** One loop per container, started from instrumentation. */
export function startQueueWorker() {
  const run = () =>
    drainQueue().catch((error) =>
      console.error(`[queue] drain failed: ${(error as Error).message}`),
    );
  setTimeout(run, 20_000).unref?.();
  setInterval(run, RETRY_EVERY_MS).unref?.();
  console.log(`[queue] retrying queued meals every ${RETRY_EVERY_MS / 60000}m`);
}
