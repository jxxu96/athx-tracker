import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Stand-ins for the three CLIs, so the order runs without a model or any
// allowance. Codex answers at once and the others take a moment, long enough
// to tell asking them together from asking them in turn. Each logs when it
// starts and when it finishes.
const FAKE = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const name = require("node:path").basename(process.argv[1]);
const description = process.argv.at(-1);
const calories = { codex: 600, claude: 700, grok: 1100 }[name];
const confidence =
  name === "codex" && description.includes("zzsure") ? "medium"
  : name === "claude" && description.includes("zzlabel") ? "high"
  : "low";
appendFileSync(process.env.FAKE_LOG, "start " + name + "\\n");
setTimeout(() => {
  appendFileSync(process.env.FAKE_LOG, "end " + name + "\\n");
  process.stdout.write(JSON.stringify({
    name: "Bowl", calories, protein: calories / 20, carbs: calories / 10, fat: calories / 40,
    fiber: 0, alcohol: 0, assumptions: name + " guessed.", confidence,
  }));
}, name === "codex" ? 0 : 500);
`;

test("an unsure meal asks the rest at once and keeps the best-sourced answer", async (t) => {
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
      // What a click sends, so Codex is not skipped for want of time.
      body: JSON.stringify({ description, budgetMs: 130000 }),
    });
    return {
      provider: response.headers.get("x-athx-provider"),
      body: await response.json(),
      log: readFileSync(log, "utf8").trim().split("\n"),
    };
  };

  const guessed = await post("zz bowl");
  assert.equal(guessed.provider, "average");
  assert.equal(guessed.body.calories, 800);
  assert.equal(guessed.body.confidence, "low");
  assert.deepEqual(guessed.log.slice(0, 2), ["start codex", "end codex"]);
  assert.deepEqual(guessed.log.slice(2, 4).sort(), ["start claude", "start grok"], "asked together");

  const labelled = await post("zzlabel bowl");
  assert.equal(labelled.provider, "claude");
  assert.equal(labelled.body.calories, 700);

  const sure = await post("zzsure bowl");
  assert.equal(sure.provider, "codex");
  assert.deepEqual(sure.log, ["start codex", "end codex"]);
});
