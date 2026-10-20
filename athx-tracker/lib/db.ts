import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const file =
  process.env.DATABASE_FILE ?? join(process.cwd(), "data", "athx.db");
const migrations = join(process.cwd(), "drizzle");

// Next reloads modules in development; keep one handle per process.
const cache = globalThis as unknown as { athxDb?: Database.Database };

/**
 * The journal lives in a single SQLite file on a mounted volume. Migrations run
 * once on first use, so a fresh container comes up with its tables already there.
 */
export function db() {
  if (cache.athxDb) return cache.athxDb;

  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  migrate(drizzle(sqlite), { migrationsFolder: migrations });

  cache.athxDb = sqlite;
  return sqlite;
}
