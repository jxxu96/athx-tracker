/**
 * Warning ahead of the estimator's Claude sign-in running out. The CLI cannot
 * renew a login past its time limit, and from then every Claude estimate
 * fails until someone signs in again where the estimator runs.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long before the end each warning comes, earliest first. */
export const LOGIN_WARNINGS = [7 * DAY, 3 * DAY, 2 * DAY, DAY, 12 * HOUR] as const;

/**
 * The CLI reports the latest the sign-in lasts and says it can end up to this
 * much sooner, so the alert names that earliest day as well.
 */
export const LOGIN_EARLY_BY = 3 * DAY;

/** A warning sent away on this phone: which end it was for, and how far in. */
export type LoginDismissal = { expiresAt: string; warning: number };

/** An ISO time from the server, or null for anything that is not one. */
export function readExpiry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Which warning is due: the index of the last one whose time has come, or -1
 * before the first. A phone not opened for a while skips straight to the one
 * now due, and past the end the last one stays due.
 */
export function dueWarning(expiresAt: string, now: number) {
  const left = Date.parse(expiresAt) - now;
  if (!Number.isFinite(left)) return -1;
  let due = -1;
  LOGIN_WARNINGS.forEach((ahead, index) => {
    if (left <= ahead) due = index;
  });
  return due;
}

/**
 * Shown until sent away, and back at the next warning. A new sign-in has a new
 * end, so sending away the old one's warnings does not hide the new one's.
 */
export function showWarning(expiresAt: string | null, now: number, dismissed: LoginDismissal | null) {
  if (!expiresAt) return false;
  const due = dueWarning(expiresAt, now);
  if (due < 0) return false;
  return !(dismissed && dismissed.expiresAt === expiresAt && dismissed.warning >= due);
}

/** "in 5 days", "in 20 hours", "in 40 minutes", or null once it has ended. */
export function timeLeft(expiresAt: string, now: number) {
  const left = Date.parse(expiresAt) - now;
  if (!(left > 0)) return null;
  const count = (amount: number, unit: string) => `in ${amount} ${unit}${amount === 1 ? "" : "s"}`;
  // From a day and a half, days: the two-day warning reads "in 2 days", not 47 hours.
  if (left >= 36 * HOUR) return count(Math.round(left / DAY), "day");
  if (left >= HOUR) return count(Math.round(left / HOUR), "hour");
  return count(Math.max(1, Math.round(left / MINUTE)), "minute");
}

const STORAGE_KEY = "athx.claude-login-warning";

function storage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The warning last sent away on this phone, if any. */
export function readDismissal(): LoginDismissal | null {
  try {
    const parsed = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { expiresAt, warning } = parsed as Record<string, unknown>;
    const at = readExpiry(expiresAt);
    return at && Number.isInteger(warning) ? { expiresAt: at, warning: warning as number } : null;
  } catch {
    return null;
  }
}

export function writeDismissal(dismissal: LoginDismissal) {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(dismissal));
  } catch {
    // Private mode or a full store: it shows again next time, which is safe.
  }
}

export const LOGIN_STORAGE_KEY = STORAGE_KEY;
