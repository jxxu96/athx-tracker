/** When Claude's stored sign-in runs out, as `claude auth status` reports it. */
import { run } from "./cli.mjs";
import { CLAUDE_BIN } from "./config.mjs";

// Each check starts the whole CLI binary, so an answer is kept this long. It
// reads the stored login and asks no model, so it spends no allowance.
const FRESH_MS = 15 * 60_000;
const TIMEOUT_MS = 4000;

/**
 * loginExpiresAt from `claude auth status --json`: an ISO time, or null when
 * the CLI reports none. It has none for a login with no renewal deadline on
 * record, a CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, or no login.
 * The CLI treats it as the latest the sign-in lasts and says it can end up to
 * three days sooner.
 */
export function loginExpiresAt(out) {
  let value;
  try {
    value = JSON.parse(out);
  } catch {
    return null;
  }
  const at = value && typeof value === "object" ? value.loginExpiresAt : undefined;
  if (typeof at !== "string") return null;
  const time = Date.parse(at);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Asks at most once per FRESH_MS, and callers that arrive while it is asking
 * share that one run. A failed check counts as an answer of null, so a CLI
 * that will not start is not started on every request.
 */
export function loginWatch({ bin = CLAUDE_BIN, runner = run, freshMs = FRESH_MS, clock = Date.now } = {}) {
  let checkedAt = -Infinity;
  let value = null;
  let pending = null;
  return () => {
    if (!bin) return Promise.resolve(null);
    if (clock() - checkedAt < freshMs) return Promise.resolve(value);
    pending ??= Promise.resolve(runner(bin, ["auth", "status", "--json"], TIMEOUT_MS))
      .then(({ out }) => loginExpiresAt(out), () => null)
      .then((found) => {
        value = found;
        checkedAt = clock();
        pending = null;
        return found;
      });
    return pending;
  };
}

export const claudeLoginExpiresAt = loginWatch();
