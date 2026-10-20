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
