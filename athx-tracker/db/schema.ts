import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const records = sqliteTable("records", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  athlete: text("athlete").notNull(),
  day: text("day").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
});
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const limits = sqliteTable("estimate_limits", {
  id: text("id").primaryKey(),
  count: integer("count").notNull().default(0),
});

/** Failed sign-in attempts per client, so a public deployment cannot be brute forced. */
export const loginAttempts = sqliteTable("login_attempts", {
  id: text("id").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: integer("window_start").notNull().default(0),
  lockedUntil: integer("locked_until").notNull().default(0),
});
