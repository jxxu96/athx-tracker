#!/usr/bin/env node
/**
 * Meal macro estimator, backed by the CLIs you already pay a monthly fee for.
 *
 * The tracker runs in a container on Linux; these CLIs live on your own machine
 * and are signed in as you. So the app does not call them directly. It POSTs the
 * meal description here over the tailnet, and this answers with the macros — the
 * exact shape the app already accepts from GROK_GATEWAY_URL.
 *
 * Nothing about your CLI credentials leaves this machine.
 */
import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
// First, so estimator/.env is loaded before any other module reads a setting.
import {
  BODY_LIMIT,
  BUDGET_MS,
  CLAUDE_BIN,
  CLAUDE_MODEL,
  CODEX_BIN,
  GROK_BIN,
  HOST,
  MEAL_PROVIDER_MS,
  MEAL_RESERVE_MS,
  ORDER,
  PER_PROVIDER_MS,
  PORT,
  RESERVE_MS,
  TOKEN,
  usedEnvFile,
} from "./config.mjs";
import { startBackups } from "./backup.mjs";
import { API_KEY_VARS, parseCliOutput, structured } from "./cli.mjs";
import { startDeployWatch } from "./deploy-watch.mjs";
import {
  budgetSlice,
  describedFor,
  estimate,
  failure,
  providerSlice,
} from "./estimate.mjs";
import { DISH_INSTRUCTIONS, DISH_SCHEMA, INSTRUCTIONS, SCHEMA } from "./prompts.mjs";
import { DISH_TASK, MEAL_TASK, PROVIDERS, configured } from "./providers.mjs";
import { clean, cleanDishes, complex, settle, settleDishes } from "./settle.mjs";
import { WORKOUT_TASK } from "./workout.mjs";

function send(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

/**
 * Constant time, by comparing digests rather than the strings themselves: ===
 * returns as soon as two bytes differ, which times how much of a guess was
 * right. The app compares its passphrase the same way.
 */
const digestOf = (value) => createHash("sha256").update(value).digest();

const authorised = (request) => {
  const offered = digestOf(request.headers.authorization ?? "");
  return timingSafeEqual(offered, digestOf(`Bearer ${TOKEN}`));
};

const server = createServer((request, response) => {
  const path = (request.url ?? "/").split("?")[0];

  if (!authorised(request)) return send(response, 401, { error: "Unauthorized" });

  if (request.method === "GET" && path === "/health")
    return send(response, 200, {
      ok: true,
      order: configured(),
      model: CLAUDE_MODEL,
      budgetMs: BUDGET_MS,
    });

  if (request.method !== "POST") return send(response, 405, { error: "POST only" });

  // A caller that hangs up before the answer, because someone pressed Stop or
  // gave up waiting, stops every CLI still running for it. Left alone they ran
  // to their own deadline and spent allowance on an answer nobody would read.
  const gone = new AbortController();
  response.on("close", () => {
    if (!response.writableFinished) gone.abort();
  });

  // Meal follow-ups include the previous estimate and earlier corrections,
  // and each provider's own last answer as well. Decode across chunk
  // boundaries so longer descriptions preserve Unicode too.
  request.setEncoding("utf8");
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > BODY_LIMIT) request.destroy();
  });
  request.on("end", async () => {
    let description = "";
    let budget = BUDGET_MS;
    let task = MEAL_TASK;
    let context = "";
    let streaming = false;
    let previousEstimates;
    try {
      const parsed = JSON.parse(body);
      description = String(parsed.description ?? "").trim();
      streaming = parsed.stream === true;
      if (parsed.task !== undefined && !["meal", "workout"].includes(parsed.task))
        return send(response, 400, { error: "Unknown task." });
      if (parsed.task === "workout") {
        if (!Array.isArray(parsed.athletes) || !parsed.athletes.length || parsed.athletes.length > 2
          || !parsed.athletes.every(side => ["hippos", "gators"].includes(side))
          || !["kg", "lb"].includes(parsed.weightUnit))
          return send(response, 400, { error: "Choose athletes and a weight unit." });
        task = WORKOUT_TASK;
        context = `Selected athletes: ${parsed.athletes.join(", ")}. Default weight unit: ${parsed.weightUnit}.\n\n`;
      }
      // A meal for both of them, dish by dish. An older app never asks, and an
      // older estimator ignores the ask and answers for the whole meal, which
      // the app takes as one dish.
      if (task === MEAL_TASK && parsed.dishes === true) task = DISH_TASK;
      // A reply's own last answer for each provider, by name. Only a meal
      // continues one, and only an object of objects is taken.
      const own = parsed.previousEstimates;
      if (task.meal && own && typeof own === "object" && !Array.isArray(own))
        previousEstimates = Object.fromEntries(
          Object.entries(own).filter(([name, value]) =>
            Object.hasOwn(PROVIDERS, name) && value && typeof value === "object" && !Array.isArray(value)),
        );
      // Clamped, so a caller cannot pin a CLI open or starve one at birth.
      const requested = Number(parsed.budgetMs);
      if (Number.isFinite(requested))
        budget = Math.min(252000, Math.max(8000, requested));
    } catch {
      return send(response, 400, { error: "Expected JSON with a description." });
    }
    if (description.length < 3 || description.length > 40000)
      return send(response, 400, { error: "Describe the meal or workout in a little more detail." });

    // A streamed meal sends one JSON line per estimator as each answers, then
    // the settled answer or the failure. The status is sent before anyone has
    // answered, so a failure travels in the last line, not the status. Only a
    // caller that asks gets this; an older app still gets one JSON body.
    if (streaming && task.meal) {
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      });
      response.flushHeaders();
      const line = (value) => {
        if (!gone.signal.aborted) response.write(`${JSON.stringify(value)}\n`);
      };
      const result = await estimate(description, budget, task, {
        signal: gone.signal,
        shareSources: true,
        previousEstimates,
        onAnswer: ({ estimate: answer, provider }) =>
          line({ type: "partial", provider, estimate: answer }),
        // One that was asked and gave nothing says why, even when the others
        // answered. An app from before this line skips a type it does not know.
        onMiss: ({ provider, detail }) =>
          line({ type: "missed", provider, detail: String(detail).slice(0, 300) }),
      });
      if (gone.signal.aborted) return response.end();
      if (result.error) {
        console.error(`[estimator] all providers failed: ${result.error}`);
        line({ type: "error", error: "No estimate available.", detail: String(result.error).slice(0, 300) });
      } else line({ type: "done", provider: result.provider, estimate: result.estimate });
      return response.end();
    }

    const result = await estimate(context + description, budget, task, { signal: gone.signal, previousEstimates, shareSources: true });
    if (gone.signal.aborted) return response.end();
    if (result.error) {
      console.error(`[estimator] all providers failed: ${result.error}`);
      // Passed to the caller, not just the log. Which CLI failed and why is the
      // whole diagnosis, and docker logs is not reachable from the phone that
      // just saw the error.
      return send(response, 502, {
        error: "No estimate available.",
        detail: String(result.error).slice(0, 300),
      });
    }
    // Header, not a body field: the body is the estimate, and an extra key
    // there would be rejected by the app. An older app ignores the header.
    send(response, 200, result.estimate, { "X-Athx-Provider": result.provider });
  });
});

/**
 * Only when this file is the thing being run. Importing it — to test the parts
 * that read whatever a CLI printed — used to start a listener, a backup timer
 * and a deploy watcher, which is why none of those parts had a test.
 */
const runDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export {
  BODY_LIMIT,
  DISH_INSTRUCTIONS,
  DISH_SCHEMA,
  DISH_TASK,
  INSTRUCTIONS,
  MEAL_PROVIDER_MS,
  MEAL_RESERVE_MS,
  SCHEMA,
  PROVIDERS,
  budgetSlice,
  clean,
  cleanDishes,
  complex,
  describedFor,
  estimate,
  failure,
  parseCliOutput,
  providerSlice,
  settle,
  settleDishes,
  structured,
};

if (runDirectly) {
  // Refusing to listen without a token. The check used to run on import, and
  // the app's tests import this file to compare schemas. On a machine with no
  // estimator/.env that exit failed the whole suite, so the image was never
  // published and the site stayed on the previous build.
  if (!TOKEN || TOKEN.length < 16) {
    console.error(
      "ESTIMATOR_TOKEN must be set to at least 16 characters (environment or estimator/.env).",
    );
    process.exit(1);
  }
  server.listen(PORT, HOST, () => {
  console.log(`[estimator] listening on http://${HOST}:${PORT}`);
  if (usedEnvFile) console.log("[estimator] config: estimator/.env");
  console.log(`[estimator] provider order: ${ORDER.join(" then ")}`);
  console.log(`[estimator] codex: ${CODEX_BIN || "not found"}`);
  console.log(`[estimator] claude: ${CLAUDE_BIN || "not found"} (${CLAUDE_MODEL})`);
  console.log(`[estimator] grok: ${GROK_BIN || "not found"}`);
  console.log(
    `[estimator] budget ${BUDGET_MS}ms total, ${PER_PROVIDER_MS}ms per provider, ${RESERVE_MS}ms held for the fallback`,
  );

  const keys = Object.keys(process.env).filter((key) => API_KEY_VARS.test(key));
  console.log(
    keys.length
      ? `[estimator] auth: subscription login only; stripping ${keys.join(", ")} before each call`
      : "[estimator] auth: subscription login only; no API key present to strip",
  );
  console.log(
    "[estimator] any cost a CLI reports is a list-price equivalent, not a charge on a subscription",
  );
  startBackups();
  startDeployWatch();

  if (!configured().length)
    console.error("[estimator] WARNING: no CLI found. Set CODEX_BIN, CLAUDE_BIN, or GROK_BIN.");
});
}
