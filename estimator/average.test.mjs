import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Stand-ins for the three CLIs, so a meal runs without a model or any
// allowance. Each takes a second, long enough to tell asking them together
// from asking them in turn, except Claude finding a label, which is quick.
// Each logs when it starts and when it finishes.
const FAKE = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const name = require("node:path").basename(process.argv[1]);
const description = process.argv.at(-1);
const calories = { codex: 600, claude: 700, grok: 1100 }[name];
const label = name === "claude" && description.includes("zzlabel");
const confidence = name === "codex" && description.includes("zzsure") ? "medium" : label ? "high" : "low";
appendFileSync(process.env.FAKE_LOG, "start " + name + "\\n");
setTimeout(() => {
  appendFileSync(process.env.FAKE_LOG, "end " + name + "\\n");
  process.stdout.write(JSON.stringify({
    name: "Bowl", calories, protein: calories / 20, carbs: calories / 10, fat: calories / 40,
    fiber: 0, alcohol: 0, assumptions: name + " guessed.", confidence,
  }));
}, label ? 200 : 1000);
`;

test("a complex meal asks every estimator at once, and a simple one goes in order", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "athx-fake-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = (name) => {
    const path = join(dir, name);
    writeFileSync(path, FAKE);
    chmodSync(path, 0o755);
    return path;
  };
  const log = join(dir, "log");

  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const token = "average-test-token-at-least-16";
  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: {
      ...process.env, ESTIMATOR_TOKEN: token, ESTIMATOR_PORT: String(port),
      ESTIMATOR_HOST: "127.0.0.1", ESTIMATOR_ORDER: "codex,claude,grok",
      CODEX_BIN: bin("codex"), CLAUDE_BIN: bin("claude"), GROK_BIN: bin("grok"), FAKE_LOG: log,
      BACKUP_URL: "", BACKUP_PASSPHRASE: "", DEPLOY_WEBHOOK: "",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Estimator did not start")), 10000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Estimator exited ${code}`)); });
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening on")) { clearTimeout(timer); resolve(); }
    });
  });

  const post = async (description) => {
    writeFileSync(log, "");
    const response = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // What a click sends.
      body: JSON.stringify({ description, budgetMs: 130000 }),
    });
    return {
      provider: response.headers.get("x-athx-provider"),
      body: await response.json(),
      log: readFileSync(log, "utf8").trim().split("\n"),
    };
  };

  // Complex: three items. Everyone starts before anyone finishes.
  const guessed = await post("zz rice, beans, cheese");
  assert.equal(guessed.provider, "average");
  // 600 x 40% + 700 x 35% + 1100 x 25%.
  assert.equal(guessed.body.calories, 760);
  assert.equal(guessed.body.confidence, "low");
  assert.deepEqual(guessed.log.slice(0, 3).sort(), ["start claude", "start codex", "start grok"], "asked together");

  const labelled = await post("zzlabel rice, beans, cheese");
  assert.equal(labelled.provider, "claude");
  assert.equal(labelled.body.calories, 700);
  assert.deepEqual(labelled.log.filter((line) => line.startsWith("end")), ["end claude"], "the rest were stopped");

  // Simple, and Codex is sure: nobody else is asked.
  const sure = await post("zzsure bowl");
  assert.equal(sure.provider, "codex");
  assert.equal(sure.body.calories, 600);
  assert.deepEqual(sure.log, ["start codex", "end codex"]);

  // Simple, but Codex is unsure: the rest are asked together after it.
  const unsure = await post("zz bowl");
  assert.equal(unsure.provider, "average");
  assert.equal(unsure.body.calories, 760);
  assert.deepEqual(unsure.log.slice(0, 2), ["start codex", "end codex"]);
  assert.deepEqual(unsure.log.slice(2, 4).sort(), ["start claude", "start grok"], "then the rest together");

  // Streamed: each answer as it lands, then the settled one.
  writeFileSync(log, "");
  const streamed = await fetch(`http://127.0.0.1:${port}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ description: "zz rice, beans, cheese", budgetMs: 130000, stream: true }),
  });
  assert.equal(streamed.headers.get("content-type"), "application/x-ndjson");
  const lines = (await streamed.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.slice(0, 3).map(({ type, provider, estimate }) => [type, provider, estimate.calories]).sort(),
    [["partial", "claude", 700], ["partial", "codex", 600], ["partial", "grok", 1100]],
  );
  assert.deepEqual(lines.slice(3).map(({ type, provider }) => [type, provider]), [["done", "average"]]);
  assert.equal(lines[3].estimate.calories, 760);

  // Hanging up stops every CLI still running: none of them finishes.
  writeFileSync(log, "");
  const stop = new AbortController();
  const abandoned = await fetch(`http://127.0.0.1:${port}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ description: "zz rice, beans, cheese", budgetMs: 130000, stream: true }),
    signal: stop.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  stop.abort();
  await abandoned.text().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const after = readFileSync(log, "utf8").trim().split("\n");
  assert.deepEqual(after.sort(), ["start claude", "start codex", "start grok"], "stopped before answering");
});
