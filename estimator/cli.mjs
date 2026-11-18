/** Running a provider's CLI, and reading whatever it printed. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

export const API_KEY_VARS =
  /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|XAI_API_KEY|GROK_API_KEY|OPENAI_API_KEY)$/;

/**
 * Subscription auth only. Every API key is removed before a CLI runs, so this
 * cannot quietly switch to metered per-token billing: with no key to fall back
 * on, a CLI that is not logged in fails loudly instead of charging you. extra
 * is a provider's own settings, which a real environment variable still wins
 * over.
 */
function childEnv(extra = {}) {
  const env = { ...extra, ...process.env };
  for (const key of Object.keys(env)) if (API_KEY_VARS.test(key)) delete env[key];
  return env;
}

export function run(bin, args, timeoutMs, signal, extraEnv) {
  return new Promise((resolve) => {
    // Grok's own folder when it has one; otherwise a folder just for this
    // run. Either way the CLI is not standing in a folder another estimate
    // is using, and it is removed once the process has gone.
    const asked = args.indexOf("--cwd");
    const folder = asked >= 0 && typeof args[asked + 1] === "string"
      ? args[asked + 1]
      : join(tmpdir(), `athx-estimator-run-${randomBytes(6).toString("hex")}`);
    if (asked < 0) mkdirSync(folder, { recursive: true });
    // stdin ignored: the CLIs otherwise wait three seconds for piped input.
    const child = spawn(bin, args, {
      cwd: folder,
      env: childEnv(extraEnv),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // A Windows npm shim is a .cmd file, which spawn will not start directly.
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(bin),
      signal,
    });
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const name = basename(folder);
      if (name.startsWith("athx-estimator-grok-") || name.startsWith("athx-estimator-run-")) {
        try {
          rmSync(folder, { recursive: true, force: true });
        } catch {
          // The answer is already in hand. A temp folder left behind is not it.
        }
      }
      resolve(result);
    };
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", (error) => finish({ code: -1, out: "", err: String(error), timedOut }));
    child.on("close", (code) => finish({ code, out, err, timedOut }));
  });
}

/**
 * Grok nests the validated object under structuredOutput, Claude under
 * structured_output, and either will print it bare if asked for text output.
 * An envelope without either carries the answer as its final text, in result
 * or text. Grok's plain and json output join every turn's text into that one
 * string, so after a search the answer follows whatever was said on the way.
 * Take whichever is there; clean() decides whether it is usable.
 */
function unwrap(value, nested) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const inner = value.structuredOutput ?? value.structured_output;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner;
  if (!nested)
    for (const text of [inner, value.result, value.text]) {
      const found = typeof text === "string" ? parseCliOutput(text, true) : null;
      if (found) return found;
    }
  return value;
}

export function structured(raw) {
  try {
    return unwrap(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Claude and Grok print one JSON value. Codex prints the same, sometimes after
 * a status line. Take the whole document when it parses, otherwise the last
 * object in the text: the one that ends at its last brace, found by stepping
 * back from brace to brace. The last brace that opens can belong to an object
 * inside it, such as a shared meal's last dish, so that one alone is not it.
 * nested is the text inside an envelope, which is not opened a second time.
 */
export function parseCliOutput(raw, nested = false) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const whole = (value) => value && typeof value === "object" && !Array.isArray(value);
  let direct = null;
  try {
    direct = JSON.parse(raw);
  } catch {
    // Text around it; looked for below.
  }
  if (whole(direct)) return unwrap(direct, nested);
  const end = raw.lastIndexOf("}");
  for (let start = raw.lastIndexOf("{", end); start >= 0; start = raw.lastIndexOf("{", start - 1)) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return whole(parsed) ? unwrap(parsed, nested) : null;
    } catch {
      // Not a whole object from here; an earlier brace may open it.
    }
    if (start === 0) break;
  }
  return null;
}

const schemaPaths = new Map();
export function schemaFile(task) {
  if (!schemaPaths.has(task.name)) {
    const schemaPath = join(tmpdir(), `athx-estimator-${task.name}-schema.json`);
    writeFileSync(schemaPath, JSON.stringify(task.schema));
    schemaPaths.set(task.name, schemaPath);
  }
  return schemaPaths.get(task.name);
}
