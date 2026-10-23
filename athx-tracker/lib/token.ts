import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/*
 * The session cookie, start to finish. Kept apart from the rest of auth so
 * that it can be tested: next/headers does not resolve outside a Next build,
 * so sitting beside it made the whole mechanism unreachable.
 */

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
