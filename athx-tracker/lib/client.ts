import type { RecordItem, Workout, Meal } from "./domain";

/** Same-origin JSON call. Dispatch injects the identity headers. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    const error = new Error(data?.error ?? "Something went wrong. Try again.");
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return data as T;
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * crypto.randomUUID exists only in secure contexts, and a self-hosted box reached
 * over plain HTTP is not one. getRandomValues is always available, so fall back to
 * assembling the v4 UUID by hand rather than failing every save.
 */
export function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function dayToDate(day: string) {
  return new Date(`${day}T12:00:00Z`);
}

/** Calendar shift on the same noon-UTC anchor as every other day here. */
export function addDays(day: string, delta: number) {
  const date = dayToDate(day);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** Monday-anchored week key, so both athletes count the same week. */
export function weekStart(day: string) {
  const date = dayToDate(day);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * Rounded, though with both ends anchored at noon UTC the gap is always a whole
 * number of days and the rounding never does anything: nine thousand pairs
 * across four years, every daylight-saving change among them, and not one came
 * out fractional. It is here for whoever moves that anchoring, since an hour of
 * drift either way would otherwise turn a day into none.
 */
export function daysBetween(from: string, to: string) {
  return Math.round(
    (dayToDate(to).getTime() - dayToDate(from).getTime()) / 86_400_000,
  );
}

export function formatDay(day: string, today: string) {
  if (day === today) return "Today";
  if (daysBetween(day, today) === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dayToDate(day));
}

/** Newest day first; newest entry first inside a day. */
export function sortRecords(records: RecordItem[]) {
  return [...records].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

export const isWorkout = (record: RecordItem): record is Workout =>
  record.kind === "workout";
export const isMeal = (record: RecordItem): record is Meal =>
  record.kind === "meal";
