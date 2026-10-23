import { database, runtime } from "./server";
import { reconciledEstimateSchema } from "./validation";
import type { Meal } from "./domain";
import {
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  fillQueuedMeal,
  nextRetryDelay,
} from "./queue-rules";

/**
 * Meals saved while the estimator could not answer are stored with source
 * "queued" and the description kept in assumptions. No separate table: the
 * queue is just those meals, so nothing can drift out of step with the journal.
 *
 * This is the reliable half of estimating. Nobody is waiting on it, so it can
 * afford a budget the interactive path cannot, and it holds the description
 * until an estimate actually arrives rather than asking anyone to retype it.
 */
/** No browser deadline here, so a slow CLI is merely slow, not a failure. */
const QUEUE_BUDGET_MS = 150_000;

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
  return reconciledEstimateSchema.parse(await response.json());
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

    const updated = fillQueuedMeal(meal, result);
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

// Next reloads modules in development, so register can run again and leave a
// second loop behind, each draining the same queue and spending estimates
// twice. Held on globalThis for the same reason the database handle is.
const cache = globalThis as unknown as { athxQueueStarted?: boolean };

/** One loop per container, started from instrumentation. */
export function startQueueWorker() {
  if (cache.athxQueueStarted) return;
  cache.athxQueueStarted = true;

  let wait = RETRY_MIN_MS;
  const run = async () => {
    try {
      wait = nextRetryDelay(wait, await drainQueue());
    } catch (error) {
      console.error(`[queue] drain failed: ${(error as Error).message}`);
      wait = nextRetryDelay(wait, "failed");
    }
    setTimeout(run, wait).unref?.();
  };
  setTimeout(run, 20_000).unref?.();
  console.log(
    `[queue] retrying queued meals every ${RETRY_MIN_MS / 60000}m, backing off to ${RETRY_MAX_MS / 60000}m while one keeps failing`,
  );
}
