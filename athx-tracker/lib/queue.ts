import { z } from "zod";
import { database, runtime } from "./server";
import { macroSchema } from "./validation";
import type { Meal } from "./domain";

/**
 * Meals saved while the estimator could not answer are stored with source
 * "queued" and the description kept in assumptions. No separate table: the
 * queue is just those meals, so nothing can drift out of step with the journal.
 *
 * This is the reliable half of estimating. Nobody is waiting on it, so it can
 * afford a budget the interactive path cannot, and it holds the description
 * until an estimate actually arrives rather than asking anyone to retype it.
 */
const estimateSchema = macroSchema.extend({
  name: z.string().min(1).max(300),
  assumptions: z.string().max(3000),
  confidence: z.enum(["low", "medium", "high"]),
});

/** No browser deadline here, so a slow CLI is merely slow, not a failure. */
const QUEUE_BUDGET_MS = 150_000;
const RETRY_MIN_MS = 2 * 60 * 1000;
const RETRY_MAX_MS = 30 * 60 * 1000;

async function estimate(description: string) {
  const config = runtime();
  if (!config.GROK_GATEWAY_URL || !config.GROK_GATEWAY_TOKEN) return null;
  const response = await fetch(config.GROK_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.GROK_GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({ description, budgetMs: QUEUE_BUDGET_MS }),
    signal: AbortSignal.timeout(QUEUE_BUDGET_MS + 15_000),
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
  if (pending.length === 0) return { filled: 0, waiting: 0 };

  let filled = 0;
  for (const meal of pending) {
    const result = await estimate(meal.assumptions).catch(() => null);
    // Still failing: stop rather than burn through the rest and fail each.
    if (!result) break;

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

  const waiting = pending.length - filled;
  if (filled) console.log(`[queue] filled ${filled} queued meal(s)`);
  if (waiting) console.log(`[queue] ${waiting} meal(s) still waiting`);
  return { filled, waiting };
}

/** One loop per container, started from instrumentation. */
export function startQueueWorker() {
  let wait = RETRY_MIN_MS;
  const run = async () => {
    try {
      const { filled, waiting } = await drainQueue();
      // Back off only while there is work that is not getting done. Nothing
      // queued is not a failure, and one success means the estimator is back,
      // so a long outage does not leave a long wait behind it.
      wait =
        waiting > 0 && filled === 0
          ? Math.min(RETRY_MAX_MS, wait * 2)
          : RETRY_MIN_MS;
    } catch (error) {
      console.error(`[queue] drain failed: ${(error as Error).message}`);
      wait = Math.min(RETRY_MAX_MS, wait * 2);
    }
    setTimeout(run, wait).unref?.();
  };
  setTimeout(run, 20_000).unref?.();
  console.log(
    `[queue] retrying queued meals every ${RETRY_MIN_MS / 60000}m, backing off to ${RETRY_MAX_MS / 60000}m while one keeps failing`,
  );
}
