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

export function dayToDate(day: string) {
  return new Date(`${day}T12:00:00Z`);
}

/** Monday-anchored week key, so both athletes count the same week. */
export function weekStart(day: string) {
  const date = dayToDate(day);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

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
