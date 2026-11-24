import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  UNCLAIMED_MS,
  heldPhotos,
  holdPhotos,
  photoSetOf,
  releasePhotos,
  sweepPhotos,
} from "./queued-photos.ts";

const SET = "9b2f6c1e-4d3a-4e8b-9a7c-2f1e0d6b5a01";
const photo = { type: "image/jpeg", data: "/9j/4AAQ" } as const;

/** A journal of its own, built by the same migrations the app runs. */
function journal() {
  const sqlite = new Database(":memory:");
  migrate(drizzle(sqlite), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  return sqlite;
}

function save(sqlite: Database.Database, id: string, meal: Record<string, unknown>) {
  const record = { id, kind: "meal", athlete: "gators", day: "2026-11-24", ...meal };
  sqlite
    .prepare(
      "INSERT INTO records (id, kind, athlete, day, payload, created_at) VALUES (?, 'meal', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
    )
    .run(id, record.athlete, record.day, JSON.stringify(record), "2026-11-24T12:00:00.000Z");
}

test("photos held come back as sent, and sent again under the same id replace them", () => {
  const sqlite = journal();
  assert.equal(heldPhotos(sqlite, SET), null);
  holdPhotos(sqlite, SET, [photo]);
  assert.deepEqual(heldPhotos(sqlite, SET), [photo]);
  holdPhotos(sqlite, SET, [photo, photo]);
  assert.deepEqual(heldPhotos(sqlite, SET), [photo, photo]);
});

test("photos stay while either half of a meal for both waits on them, and go after", () => {
  const sqlite = journal();
  holdPhotos(sqlite, SET, [photo]);
  save(sqlite, "a", { source: "queued", photoSet: SET });
  save(sqlite, "b", { source: "queued", photoSet: SET });
  releasePhotos(sqlite, SET);
  assert.ok(heldPhotos(sqlite, SET), "both still waiting");
  sqlite.prepare("DELETE FROM records WHERE id = 'a'").run();
  releasePhotos(sqlite, SET);
  assert.ok(heldPhotos(sqlite, SET), "one still waiting");
  save(sqlite, "b", { source: "grok" });
  releasePhotos(sqlite, SET);
  assert.equal(heldPhotos(sqlite, SET), null, "filled, so nobody waits on them");
});

test("photos no meal took are cleared after a day, and ones a meal waits on never are", () => {
  const sqlite = journal();
  const now = Date.UTC(2026, 10, 24, 12);
  const OLD_CLAIMED = "9b2f6c1e-4d3a-4e8b-9a7c-2f1e0d6b5a02";
  const FRESH = "9b2f6c1e-4d3a-4e8b-9a7c-2f1e0d6b5a03";
  holdPhotos(sqlite, SET, [photo], now - UNCLAIMED_MS - 1);
  holdPhotos(sqlite, OLD_CLAIMED, [photo], now - 30 * UNCLAIMED_MS);
  holdPhotos(sqlite, FRESH, [photo], now - UNCLAIMED_MS + 60_000);
  save(sqlite, "a", { source: "queued", photoSet: OLD_CLAIMED });
  assert.equal(sweepPhotos(sqlite, now), 1);
  assert.equal(heldPhotos(sqlite, SET), null);
  assert.ok(heldPhotos(sqlite, OLD_CLAIMED), "a meal still waits on these");
  assert.ok(heldPhotos(sqlite, FRESH), "its meal may still be on its way");
});

test("a stored record names its photos only when it is a meal that has them", () => {
  assert.equal(photoSetOf(JSON.stringify({ kind: "meal", photoSet: SET })), SET);
  assert.equal(photoSetOf(JSON.stringify({ kind: "meal" })), undefined);
  assert.equal(photoSetOf(JSON.stringify({ kind: "workout", photoSet: SET })), undefined);
  assert.equal(photoSetOf("not json"), undefined);
});
