/**
 * Settings, read once at start: estimator/.env, then the environment, which
 * wins. Every module that reads process.env when it loads imports this first,
 * so a value set only in .env still reaches it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const here = dirname(fileURLToPath(import.meta.url));

/** A .env beside this file, so autostart does not need a wall of variables. */
function loadEnvFile() {
  const path = join(here, ".env");
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    const [, key, raw] = match;
    // A real environment variable always wins over the file.
    if (process.env[key] !== undefined) continue;
    let value = raw.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    process.env[key] = value;
  }
  return true;
}
export const usedEnvFile = loadEnvFile();

/** Look where each CLI installs itself before giving up. */
function findBinary(explicit, candidates) {
  if (explicit) return explicit;
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return "";
}

const home = homedir();
export const GROK_BIN = findBinary(process.env.GROK_BIN, [
  join(home, ".grok", "bin", "grok.exe"),
  join(home, ".grok", "bin", "grok"),
  join(home, ".local", "bin", "grok"),
]);
export const CLAUDE_BIN = findBinary(process.env.CLAUDE_BIN, [
  join(home, ".local", "bin", "claude.exe"),
  join(home, ".local", "bin", "claude"),
  join(home, ".claude", "local", "claude"),
]);
const roaming = process.env.APPDATA ?? "";
export const CODEX_BIN = findBinary(process.env.CODEX_BIN, [
  "/usr/local/bin/codex",
  join(home, ".local", "bin", "codex"),
  join(home, ".local", "bin", "codex.exe"),
  ...(roaming
    ? [join(
        roaming,
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        "@openai",
        "codex-win32-x64",
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe",
      )]
    : []),
]);

export const PORT = Number(process.env.ESTIMATOR_PORT ?? 8787);
export const HOST = process.env.ESTIMATOR_HOST ?? "127.0.0.1";
export const TOKEN = process.env.ESTIMATOR_TOKEN ?? "";
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";

// 40% above the old 40s / 35s / 9s. The click path sends its own budget, large
// enough for one provider to use this cap and still leave the reserve.
export const BUDGET_MS = Number(process.env.ESTIMATOR_BUDGET_MS ?? 56000);
export const PER_PROVIDER_MS = Number(process.env.ESTIMATOR_TIMEOUT_MS ?? 49000);
// Time held back so a fallback still gets a turn after a slow first provider.
export const RESERVE_MS = Number(process.env.ESTIMATOR_RESERVE_MS ?? 12600);
// A named product is looked up, which does not fit in the recall cap. The click
// path sends this cap plus the reserve, so a simple meal's fallback can search
// too. Workouts stay on the shorter cap.
export const MEAL_PROVIDER_MS = 90_000;
export const MEAL_RESERVE_MS = 40_000;
// A meal that links a page or lists this many items is complex: every provider
// is asked at once. Anything less goes in order.
export const COMPLEX_ITEMS = 3;
// Writing the answer takes a turn as well. Four ran out whenever the first page
// opened showed no nutrition: search, open another, search again, and no turn
// was left to answer in. The time cap above still bounds a long lookup.
export const MEAL_MAX_TURNS = "10";
// The most a request may carry, in characters. A reply's description holds
// the meal, the previous estimate, every correction and the food notes, and
// a reply also sends each provider's own last answer. The app's test of its
// largest valid reply holds it to this.
export const BODY_LIMIT = 128_000;

// Codex, then Claude, then Grok. A missing binary or a login that is not there
// fails quickly and the next provider answers. Whoever is not last still leaves
// the reserve, so a slow leader cannot spend the whole budget. A complex meal
// asks all of them at once and waits for them: Grok's search is the slow part.
// ESTIMATOR_ORDER overrides this.
export const ORDER = (process.env.ESTIMATOR_ORDER ?? "codex,claude,grok")
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
// How much each answer counts when answers on the same footing are averaged,
// shared out again over whoever answered.
export const WEIGHTS = { codex: 0.4, claude: 0.35, grok: 0.25 };
