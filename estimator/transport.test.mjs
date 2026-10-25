import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// Exercise the HTTP boundary without calling a model or using any allowance.
test("the estimator accepts conversation-sized context but still bounds descriptions", async (t) => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const token = "transport-test-token-at-least-16";
  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: {
      ...process.env, ESTIMATOR_TOKEN: token, ESTIMATOR_PORT: String(port),
      ESTIMATOR_HOST: "127.0.0.1", ESTIMATOR_ORDER: "unconfigured",
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
  const post = (description) => fetch(`http://127.0.0.1:${port}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ description }),
  });
  const response = await post(JSON.stringify({
    mealDescription: "米飯 and chicken",
    previousEstimate: { assumptions: "x".repeat(3000) },
    replies: ["x".repeat(6000)],
  }));
  assert.equal(response.status, 502, "context reached provider selection rather than being rejected as too long");
  assert.equal((await response.json()).detail, "no providers configured");
  assert.equal((await post("x".repeat(40001))).status, 400);
});
