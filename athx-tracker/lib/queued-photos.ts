import type Database from "better-sqlite3";
import type { MealPhoto } from "./meal-photos.ts";

/*
 * The photos of a meal saved to be estimated in the background. The phone
 * sends them first, under an id of its own making, then saves the meal
 * pointing to that id as its photoSet. The worker reads them for the
 * estimate, and once no meal waiting for one points to them they are
 * deleted: when it is filled, edited or deleted.
 *
 * Each function takes the database, so a test can hand it one of its own.
 */

type Sqlite = Pick<Database.Database, "prepare">;

/**
 * How long photos no meal points to are kept. They were sent and the meal
 * never followed, or has not yet: a save that waits on the phone for the
 * server is sent within the day, as long as the app is opened.
 */
export const UNCLAIMED_MS = 24 * 60 * 60 * 1000;

/** Ids of the photos the meals waiting for an estimate point to. */
const CLAIMED = `SELECT json_extract(payload, '$.photoSet') FROM records
  WHERE kind = 'meal' AND json_extract(payload, '$.source') = 'queued'
  AND json_extract(payload, '$.photoSet') IS NOT NULL`;

/** Sent again under the same id, the photos are replaced. */
export function holdPhotos(sqlite: Sqlite, id: string, photos: MealPhoto[], now = Date.now()) {
  sqlite
    .prepare(
      "INSERT INTO queued_photos (id, photos, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET photos = excluded.photos, created_at = excluded.created_at",
    )
    .run(id, JSON.stringify(photos), now);
}

/** The photos held under an id, or null when there are none. */
export function heldPhotos(sqlite: Sqlite, id: string): MealPhoto[] | null {
  const row = sqlite.prepare("SELECT photos FROM queued_photos WHERE id = ?").get(id) as
    | { photos: string }
    | undefined;
  return row ? (JSON.parse(row.photos) as MealPhoto[]) : null;
}

/** Deleted unless a meal still waiting for its estimate points to them. */
export function releasePhotos(sqlite: Sqlite, id: string) {
  sqlite.prepare(`DELETE FROM queued_photos WHERE id = ? AND id NOT IN (${CLAIMED})`).run(id);
}

/** Photos no meal took within UNCLAIMED_MS of being sent. How many went. */
export function sweepPhotos(sqlite: Sqlite, now = Date.now()) {
  return sqlite
    .prepare(`DELETE FROM queued_photos WHERE created_at < ? AND id NOT IN (${CLAIMED})`)
    .run(now - UNCLAIMED_MS).changes;
}

/** The photos a stored record points to, if it is a meal that does. */
export function photoSetOf(payload: string) {
  try {
    const record = JSON.parse(payload) as { kind?: unknown; photoSet?: unknown };
    return record.kind === "meal" && typeof record.photoSet === "string" ? record.photoSet : undefined;
  } catch {
    return undefined;
  }
}
