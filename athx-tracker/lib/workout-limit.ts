import { database } from "./server.ts";

/**
 * The team's workout calls to the estimator a day, drafts and burns worked out
 * again alike. Each spends the same subscription allowance.
 */
export const WORKOUT_CALLS_A_DAY = 60;

const bucketFor = (now: Date) => `workout:${now.toISOString().slice(0, 10)}`;

/** Counts one call against today, or says no once the day's are spent. Null means refused. */
export function claimWorkoutCall(now = new Date()): string | null {
  const bucket = bucketFor(now);
  const sqlite = database();
  return sqlite.transaction(() => {
    const row = sqlite.prepare("SELECT count FROM estimate_limits WHERE id = ?").get(bucket) as { count: number } | undefined;
    if ((row?.count ?? 0) >= WORKOUT_CALLS_A_DAY) return null;
    sqlite.prepare("INSERT INTO estimate_limits (id, count) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET count = count + 1").run(bucket);
    return bucket;
  })();
}

/** Gives back a call that came to nothing usable. */
export function releaseWorkoutCall(bucket: string) {
  database().prepare("UPDATE estimate_limits SET count = MAX(0, count - 1) WHERE id = ?").run(bucket);
}
