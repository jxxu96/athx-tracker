import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db } from "./db";

export const COOKIE_NAME = "athx_session";
// Ninety days: this is a phone app, and being logged out mid-workout is useless.
export const MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export function configured() {
  return Boolean(process.env.APP_PASSPHRASE);
}

function phrase() {
  const value = process.env.APP_PASSPHRASE;
  if (!value) throw new Error("APP_PASSPHRASE is not set.");
  return value;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * The signing key is derived from the passphrase, so there is only one secret to
 * set, and changing it signs both phones out.
 */
function key() {
  return createHash("sha256").update(`athx-session:${phrase()}`).digest();
}

function sign(expiry: number) {
  return createHmac("sha256", key()).update(String(expiry)).digest("hex");
}

export function issue() {
  const expiry = Date.now() + MAX_AGE_SECONDS * 1000;
  return `${expiry}.${sign(expiry)}`;
}

export function valid(token: string | undefined) {
  if (!token || !configured()) return false;
  const [raw, mac] = token.split(".");
  const expiry = Number(raw);
  if (!Number.isFinite(expiry) || expiry < Date.now() || !mac) return false;
  const expected = sign(expiry);
  if (mac.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

/** Constant-time regardless of length, by comparing digests rather than input. */
export function matches(input: string) {
  if (!configured()) return false;
  return timingSafeEqual(digest(input), digest(phrase()));
}

export async function signedIn() {
  const jar = await cookies();
  return valid(jar.get(COOKIE_NAME)?.value);
}

/** Only mark the cookie secure when the request actually arrived over HTTPS. */
export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    secure,
  };
}

// Brute-force protection, in two tiers. It gates only NEW sign-ins: a phone that
// already holds a session cookie keeps working throughout a lockout, so neither
// tier can shut the two of you out of your own journal.
//
// Per caller, five strikes and that client is out. Site-wide is deliberately
// looser: one hard global lock at five would let any passing bot lock the owners
// out by typing five wrong passwords, so the global tier trips only under real,
// spread-out attack. Both expire on their own.
const CLIENT_MAX_FAILURES = 5;
const GLOBAL_MAX_FAILURES = 20;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const GLOBAL_KEY = "__site__";
const UNKNOWN_KEY = "unknown";

/**
 * Identify the caller as precisely as the proxy in front allows. With no proxy
 * headers every caller shares one bucket, which is why the global tier exists.
 */
export async function clientKey() {
  const requestHeaders = await headers();
  const candidate =
    requestHeaders.get("cf-connecting-ip") ??
    requestHeaders.get("x-real-ip") ??
    requestHeaders.get("x-forwarded-for")?.split(",")[0] ??
    "";
  return candidate.trim() || UNKNOWN_KEY;
}

function lockRemaining(id: string) {
  const row = db()
    .prepare("SELECT locked_until FROM login_attempts WHERE id = ?")
    .get(id) as { locked_until: number } | undefined;
  const remaining = (row?.locked_until ?? 0) - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Seconds left before this caller may try again, counting both tiers. */
export function lockedFor(client: string) {
  return Math.max(lockRemaining(client), lockRemaining(GLOBAL_KEY));
}

/** Records a miss against both tiers; returns seconds of lockout now in force. */
export function recordFailure(client: string) {
  const sqlite = db();
  return sqlite.transaction(() => {
    const now = Date.now();

    // Rows are created per caller and otherwise removed only by a correct
    // passphrase, so without this the table keeps a row for every client that
    // ever failed once. Forwarded headers are caller-supplied, which makes that
    // an unbounded number of rows rather than a slowly growing one.
    sqlite
      .prepare(
        "DELETE FROM login_attempts WHERE locked_until < ? AND window_start < ?",
      )
      .run(now, now - WINDOW_MS);

    const bump = (id: string, limit: number) => {
      const row = sqlite
        .prepare("SELECT count, window_start FROM login_attempts WHERE id = ?")
        .get(id) as { count: number; window_start: number } | undefined;
      const stale = !row || now - row.window_start > WINDOW_MS;
      const count = stale ? 1 : row.count + 1;
      const windowStart = stale ? now : row.window_start;
      const lockedUntil = count >= limit ? now + LOCK_MS : 0;
      sqlite
        .prepare(
          "INSERT INTO login_attempts (id, count, window_start, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET count=excluded.count, window_start=excluded.window_start, locked_until=excluded.locked_until",
        )
        .run(id, count, windowStart, lockedUntil);
      return lockedUntil;
    };

    // When no proxy header identifies the caller, everyone shares one bucket.
    // Applying the strict per-caller limit there would let a single bot lock the
    // owners out, so the shared bucket gets the looser global threshold instead.
    const locked = Math.max(
      bump(
        client,
        client === UNKNOWN_KEY ? GLOBAL_MAX_FAILURES : CLIENT_MAX_FAILURES,
      ),
      bump(GLOBAL_KEY, GLOBAL_MAX_FAILURES),
    );
    return locked ? Math.ceil((locked - now) / 1000) : 0;
  })();
}

/** A correct passphrase is evidence this was not an attack: clear both tiers. */
export function clearFailures(client: string) {
  db()
    .prepare("DELETE FROM login_attempts WHERE id IN (?, ?)")
    .run(client, GLOBAL_KEY);
}
