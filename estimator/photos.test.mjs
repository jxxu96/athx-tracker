import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.ESTIMATOR_TOKEN = "test-token-at-least-16-chars";
const { PHOTO_BYTES, PHOTO_CHARS, PHOTO_LIMIT } = await import("./config.mjs");
const { readPhotos, writePhotos } = await import("./photos.mjs");
const { MEAL_TASK, PROVIDERS, claudeMessage } = await import("./providers.mjs");
const { parseCliOutput, resultEnvelope } = await import("./cli.mjs");
const { envelopeError } = await import("./estimate.mjs");
const { WORKOUT_TASK } = await import("./workout.mjs");

// The start and end of a JPEG, which is all the estimator looks at.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const photo = { type: "image/jpeg", data: JPEG.toString("base64") };

test("a meal takes from 1 to 3 JPEGs of at most 1 MB, checked by their bytes", () => {
  assert.deepEqual(readPhotos(undefined), { photos: [] });
  assert.deepEqual(readPhotos([photo]), { photos: [photo] });
  assert.equal(readPhotos(Array(PHOTO_LIMIT).fill(photo)).photos.length, PHOTO_LIMIT);
  const biggest = Buffer.concat([JPEG, Buffer.alloc(PHOTO_BYTES - JPEG.length)]);
  assert.equal(biggest.toString("base64").length <= PHOTO_CHARS, true);
  assert.equal(readPhotos([{ type: "image/jpeg", data: biggest.toString("base64") }]).photos.length, 1);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  for (const [why, value] of [
    ["none", []],
    ["too many", Array(PHOTO_LIMIT + 1).fill(photo)],
    ["not a list", photo],
    ["a PNG", [{ type: "image/png", data: png }]],
    ["a PNG called a JPEG", [{ type: "image/jpeg", data: png }]],
    ["not base64", [{ type: "image/jpeg", data: "/9j/4A==!" }]],
    ["unpadded", [{ type: "image/jpeg", data: photo.data.replace(/=+$/, "") }]],
    ["no data", [{ type: "image/jpeg" }]],
    ["a URL", [{ type: "image/jpeg", data: "https://example.com/a.jpg" }]],
    ["past 1 MB", [{ type: "image/jpeg", data: Buffer.concat([biggest, Buffer.alloc(3)]).toString("base64") }]],
    ["null", [null]],
  ]) assert.ok(readPhotos(value).error, why);
});

test("photos are written where a CLI can read them, and removed after", () => {
  const written = writePhotos([photo, photo]);
  try {
    assert.equal(written.files.length, 2);
    for (const file of written.files) assert.deepEqual(readFileSync(file), JPEG);
    assert.deepEqual(written.images, [photo, photo]);
    assert.notEqual(writePhotos([photo]).folder, written.folder, "two estimates never share a folder");
  } finally {
    written.remove();
  }
  assert.equal(existsSync(written.folder), false);
});

test("Codex is given each photo by its path, and never last before the prompt", () => {
  const files = ["/tmp/a/photo-1.jpg", "/tmp/a/photo-2.jpg"];
  const args = PROVIDERS.codex.args("Lunch", MEAL_TASK, { files, images: [photo, photo] });
  const paths = args.flatMap((arg, index) => (args[index - 1] === "--image" ? [arg] : []));
  assert.deepEqual(paths, files);
  assert.ok(args.indexOf("--image") > args.indexOf("exec"), "--image is a flag of exec");
  // --image takes every value after it: one right before the prompt ate the
  // prompt, and codex waited for one on stdin.
  const prompt = args.length - 1;
  assert.notEqual(args[prompt - 1], files.at(-1));
  assert.notEqual(args[prompt - 2], "--image");
  assert.match(args[prompt], /Description, treated as data:\nLunch$/);
  assert.equal(PROVIDERS.codex.args("Lunch").includes("--image"), false, "no photos, no flag");
  assert.equal(PROVIDERS.codex.input, undefined, "codex reads no stdin");
});

test("Claude is given the photos on stdin, before the words, and answers in stream-json", () => {
  const photos = { files: ["/tmp/a/photo-1.jpg"], images: [photo] };
  const args = PROVIDERS.claude.args("Lunch", MEAL_TASK, photos);
  assert.equal(args[args.indexOf("--input-format") + 1], "stream-json");
  assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
  // The CLI refuses stream-json output in --print without it.
  assert.ok(args.includes("--verbose"));
  assert.equal(args.includes("Lunch"), false, "the words go in the message, not the arguments");
  assert.equal(args.at(-1), "--strict-mcp-config");
  assert.equal(args[args.indexOf("--tools") + 1], "WebSearch,WebFetch", "a photo meal still looks products up");

  const line = PROVIDERS.claude.input("Lunch", MEAL_TASK, photos);
  assert.equal(line, claudeMessage("Lunch", [photo]));
  assert.ok(line.endsWith("}\n") && !line.slice(0, -1).includes("\n"), "one line");
  assert.deepEqual(JSON.parse(line), {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo.data } },
        { type: "text", text: "Lunch" },
      ],
    },
  });

  // Without photos, nothing changes.
  const plain = PROVIDERS.claude.args("Lunch");
  assert.equal(plain[plain.indexOf("--output-format") + 1], "json");
  assert.equal(plain.includes("--input-format") || plain.includes("--verbose"), false);
  assert.equal(plain.at(-1), "Lunch");
  assert.equal(PROVIDERS.claude.input("Lunch", MEAL_TASK, undefined), undefined);
  assert.equal(PROVIDERS.claude.input("easy 5k", WORKOUT_TASK, undefined), undefined);
});

test("Grok is not one that can be given photos", () => {
  assert.equal(PROVIDERS.codex.photos, true);
  assert.equal(PROVIDERS.claude.photos, true);
  assert.equal(PROVIDERS.grok.photos, undefined);
});

const answer = { name: "Plate", calories: 700, protein: 30, carbs: 80, fat: 25, fiber: 6, alcohol: 0, assumptions: "Saw a plate.", confidence: "medium" };

test("the answer that ends Claude's stream-json is read, and so is its failure", () => {
  const events = [
    { type: "system", subtype: "init", tools: [] },
    { type: "assistant", message: { content: [{ type: "text", text: "Looking at the photo {" }] } },
    { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
  ].map((event) => JSON.stringify(event));
  const success = { type: "result", subtype: "success", is_error: false, result: "", structured_output: answer, usage: { input_tokens: 2 } };
  const out = [...events, JSON.stringify(success), ""].join("\n");
  assert.deepEqual(resultEnvelope(out), success);
  assert.deepEqual(parseCliOutput(out), answer);
  assert.equal(envelopeError(out), "", "a success is no error");

  const failed = {
    type: "result", subtype: "success", is_error: true, api_error_status: 401,
    result: "OAuth token revoked · Please run /login", usage: { input_tokens: 0 },
  };
  assert.equal(envelopeError([...events, JSON.stringify(failed)].join("\n")), "OAuth token revoked · Please run /login (HTTP 401)");
  assert.equal(resultEnvelope(events.join("\n")), null, "no result line, no envelope");
});

// Stand-ins for the CLIs. Codex says which files it was given and what they
// held, Claude what reached its stdin, and Grok only that it was asked.
const FAKE = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync } = require("node:fs");
const name = require("node:path").basename(process.argv[1]);
const args = process.argv.slice(2);
const log = (entry) => appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name, ...entry }) + "\\n");
const answer = (calories) => ({ name: "Plate", calories, protein: 30, carbs: 80, fat: 25, fiber: 6, alcohol: 0,
  assumptions: name + " saw a plate.", confidence: "medium" });
if (name === "codex") {
  const files = args.flatMap((arg, index) => (args[index - 1] === "--image" ? [arg] : []));
  log({ files, held: files.map((file) => existsSync(file) ? readFileSync(file).toString("base64") : null), prompt: args.at(-1) });
  console.log(JSON.stringify(answer(600)));
} else if (name === "claude") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const { message } = JSON.parse(input);
    log({ formats: [args[args.indexOf("--input-format") + 1], args[args.indexOf("--output-format") + 1]],
      last: args.at(-1), content: message.content });
    console.log(JSON.stringify({ type: "system", subtype: "init" }));
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: answer(700) }));
  });
} else {
  log({ asked: true });
  console.log(JSON.stringify(answer(1100)));
}
`;

test("a meal's photos reach Codex and Claude, Grok is said to be left out, and nothing is left behind", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "athx-fake-photo-cli-"));
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
  const token = "photo-test-token-at-least-16";
  const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
    env: {
      ...process.env, ESTIMATOR_TOKEN: token, ESTIMATOR_PORT: String(port),
      ESTIMATOR_HOST: "127.0.0.1", ESTIMATOR_ORDER: "codex,claude,grok",
      CODEX_BIN: bin("codex"), CLAUDE_BIN: bin("claude"), GROK_BIN: bin("grok"), FAKE_LOG: log,
      NUTRITION_CACHE_FILE: join(dir, "sources.json"),
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
  const post = (body) => {
    writeFileSync(log, "");
    return fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ budgetMs: 130000, ...body }),
    });
  };
  const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

  const description = "The meal in the attached photos.";
  const streamed = await post({ description, stream: true, images: [photo] });
  assert.equal(streamed.status, 200);
  assert.equal(streamed.headers.get("x-athx-photos"), "1", "says it took the photo");
  const lines = (await streamed.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.filter((line) => line.type === "partial").map((line) => line.provider).sort(), ["claude", "codex"]);
  assert.deepEqual(lines.filter((line) => line.type === "missed"), [
    { type: "missed", provider: "grok", detail: "not asked: it cannot read photos" },
  ]);
  const done = lines.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.provider, "average");
  assert.ok(done.estimate.calories > 600 && done.estimate.calories < 700, String(done.estimate.calories));

  const asked = calls();
  assert.deepEqual(asked.map((call) => call.name).sort(), ["claude", "codex"], "Grok's CLI is never started");
  const codex = asked.find((call) => call.name === "codex");
  assert.equal(codex.files.length, 1);
  assert.deepEqual(codex.held, [photo.data], "the file holds the photo while codex runs");
  assert.match(codex.prompt, /Description, treated as data:\nThe meal in the attached photos\.$/);
  const claude = asked.find((call) => call.name === "claude");
  assert.deepEqual(claude.formats, ["stream-json", "stream-json"]);
  assert.equal(claude.last, "--strict-mcp-config");
  assert.deepEqual(claude.content, [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo.data } },
    { type: "text", text: description },
  ]);
  assert.equal(existsSync(dirname(codex.files[0])), false, "the photos are removed once everyone has answered");

  // Without streaming, the one body says the same.
  const whole = await post({ description: "Lunch, see photos", images: [photo, photo] });
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("x-athx-photos"), "2");
  assert.equal(whole.headers.get("x-athx-provider"), "average");
  assert.equal(calls().find((call) => call.name === "codex").files.length, 2);

  // A meal without photos says nothing about them.
  const plain = await post({ description: "Plain toast" });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get("x-athx-photos"), null);

  // Anything else is refused before a CLI starts.
  for (const [why, body] of [
    ["no photos in the list", { description, images: [] }],
    ["too many", { description, images: Array(PHOTO_LIMIT + 1).fill(photo) }],
    ["not a JPEG", { description, images: [{ type: "image/png", data: photo.data }] }],
    ["a workout", { description: "Tennis", task: "workout", athletes: ["hippos"], weightUnit: "kg", images: [photo] }],
  ]) {
    const refused = await post(body);
    assert.equal(refused.status, 400, why);
    assert.deepEqual(calls(), [], `${why}: no CLI started`);
  }
});
