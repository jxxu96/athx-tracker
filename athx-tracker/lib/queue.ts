import { database, runtime, storedFoodNotes } from "./server";
import { estimatePrompt } from "./estimate-conversation";
import { estimateSchema } from "./validation";
import { type Estimator, type Meal } from "./domain";
import { namedEstimator } from "./estimate-stream";
import {
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  byDescription,
  fillQueuedMeal,
  nextRetryDelay,
  type DrainOutcome,
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
const QUEUE_BUDGET_MS = 210_000;

async function estimate(description: string) {
  const config = runtime();
  if (!config.GROK_GATEWAY_URL || !config.GROK_GATEWAY_TOKEN) return null;
  const response = await fetch(config.GROK_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.GROK_GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      description: estimatePrompt(description, undefined, storedFoodNotes()),
      budgetMs: QUEUE_BUDGET_MS,
    }),
    signal: AbortSignal.timeout(QUEUE_BUDGET_MS + 15_000),
  });
  if (!response.ok) return null;
  const estimate = estimateSchema.parse(await response.json());
  const provider = namedEstimator(response.headers.get("x-athx-provider"));
  return provider ? { ...estimate, estimator: provider satisfies Estimator } : estimate;
}

function queuedMeals(): Meal[] {
  const rows = database()
    .prepare("SELECT payload FROM records WHERE kind = 'meal'")
    .all() as { payload: string }[];
  return rows
    .map((row) => JSON.parse(row.payload) as Meal)
    .filter((meal) => meal.source === "queued");
}

async function drainOnce() {
  const pending = queuedMeals();
  if (pending.length === 0) return { filled: 0, waiting: 0 };

  let filled = 0;
  for (const meals of byDescription(pending)) {
    const result = await estimate(meals[0].assumptions).catch(() => null);
    // Still failing: stop rather than burn through the rest and fail each.
    if (!result) break;

    const write = database().prepare("UPDATE records SET payload = ? WHERE id = ?");
    for (const meal of meals) write.run(JSON.stringify(fillQueuedMeal(meal, result)), meal.id);
    filled += meals.length;
  }

  const waiting = pending.length - filled;
  if (filled) console.log(`[queue] filled ${filled} queued meal(s)`);
  if (waiting) console.log(`[queue] ${waiting} meal(s) still waiting`);
  return { filled, waiting };
}

// Next reloads modules in development, so register can run again and leave a
// second loop behind, each draining the same queue and spending estimates
// twice. Held on globalThis for the same reason the database handle is. The
// drain in progress is held there too: the timer and a meal just queued must
// not both estimate the same meal.
const cache = globalThis as unknown as {
  athxQueueStarted?: boolean;
  athxQueueDrain?: Promise<Exclude<DrainOutcome, "failed">>;
  athxQueueAgain?: boolean;
  athxQueueKick?: ReturnType<typeof setTimeout>;
};

/**
 * One drain at a time. Asked while one runs, it runs once more after, so a
 * meal queued mid-drain is not left for the timer.
 */
export function drainQueue() {
  if (cache.athxQueueDrain) {
    cache.athxQueueAgain = true;
    return cache.athxQueueDrain;
  }
  cache.athxQueueDrain = (async () => {
    try {
      let outcome;
      do {
        cache.athxQueueAgain = false;
        outcome = await drainOnce();
      } while (cache.athxQueueAgain);
      return outcome;
    } finally {
      cache.athxQueueDrain = undefined;
    }
  })();
  return cache.athxQueueDrain;
}

/**
 * Long enough for a meal saved for both athletes to land both records, which
 * are sent one after the other, so the drain sees them together.
 */
const KICK_DELAY_MS = 5000;

/**
 * A meal was just queued: estimate it now rather than at the timer's next
 * turn, which can be minutes away. Kicks close together are one drain.
 */
export function kickQueue() {
  if (cache.athxQueueKick) return;
  cache.athxQueueKick = setTimeout(() => {
    cache.athxQueueKick = undefined;
    drainQueue().catch((error) => console.error(`[queue] drain failed: ${(error as Error).message}`));
  }, KICK_DELAY_MS);
  cache.athxQueueKick.unref?.();
}

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
