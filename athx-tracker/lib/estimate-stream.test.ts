import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NDJSON,
  UNANSWERED,
  UNUSABLE,
  ndjsonLines,
  readEstimate,
  relayEstimate,
  type EstimateEvent,
  type PartialEstimate,
} from "./estimate-stream.ts";
import { estimateSchema } from "./validation.ts";

const bowl = {
  name: "Rice bowl", calories: 600, protein: 30, carbs: 70, fat: 20, fiber: 4, alcohol: 0,
  assumptions: "One bowl.", confidence: "medium" as const,
};
const usable = (value: unknown) => {
  const parsed = estimateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** A byte stream cut exactly where given, to test chunk boundaries. */
function bytes(...chunks: (string | Uint8Array)[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function all<T>(items: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

async function* lines(...items: string[]) {
  yield* items;
}

test("lines survive any chunk boundary, a multi-byte character included", async () => {
  const kcal = new TextEncoder().encode('{"a":"crème"}\n');
  const cut = kcal.indexOf(0xc3) + 1;
  assert.deepEqual(
    await all(ndjsonLines(bytes('{"x":', '1}\n\n{"y"', ":2}\n", kcal.slice(0, cut), kcal.slice(cut), '{"z":3}'))),
    ['{"x":1}', '{"y":2}', '{"a":"crème"}', '{"z":3}'],
  );
});

test("each estimator's answer is passed on as it lands, then the settled one", async () => {
  const events = await all(relayEstimate(lines(
    JSON.stringify({ type: "partial", provider: "codex", estimate: bowl }),
    JSON.stringify({ type: "partial", provider: "grok", estimate: { ...bowl, calories: 700 } }),
    JSON.stringify({ type: "done", provider: "average", estimate: { ...bowl, calories: 650 } }),
    JSON.stringify({ type: "partial", provider: "claude", estimate: bowl }),
  ), usable));
  assert.deepEqual(events, [
    { type: "partial", provider: "codex", estimate: bowl },
    { type: "partial", provider: "grok", estimate: { ...bowl, calories: 700 } },
    { type: "done", provider: "average", estimate: { ...bowl, calories: 650 } },
  ]);
});

test("a partial that is not a usable estimate, or from nobody known, is dropped", async () => {
  const events = await all(relayEstimate(lines(
    "not json",
    "null",
    JSON.stringify({ type: "partial", provider: "codex", estimate: { ...bowl, fiber: 90 } }),
    JSON.stringify({ type: "partial", provider: "gemini", estimate: bowl }),
    JSON.stringify({ type: "partial", provider: "average", estimate: bowl }),
    JSON.stringify({ type: "partial", estimate: bowl }),
    JSON.stringify({ type: "done", estimate: bowl }),
  ), usable));
  assert.deepEqual(events, [{ type: "done", estimate: bowl }]);
});

test("a settled answer that is unusable is the estimator's fault", async () => {
  const events = await all(relayEstimate(lines(
    JSON.stringify({ type: "done", provider: "codex", estimate: { name: "x" } }),
  ), usable));
  assert.deepEqual(events, [UNUSABLE]);
});

test("a failure names what the estimator said went wrong", async () => {
  const [event] = await all(relayEstimate(lines(
    JSON.stringify({ type: "error", error: "No estimate available.", detail: "codex: timed out after 90000ms" }),
  ), usable));
  assert.deepEqual(event, {
    type: "error", status: 502, error: "No estimator could answer — codex: timed out after 90000ms",
  });
  const [bare] = await all(relayEstimate(lines(JSON.stringify({ type: "error" })), usable));
  assert.equal((bare as Extract<EstimateEvent, { type: "error" }>).status, 502);
});

test("a stream that stops, or breaks, before an answer ends as unanswered", async () => {
  const partial = JSON.stringify({ type: "partial", provider: "claude", estimate: bowl });
  assert.deepEqual((await all(relayEstimate(lines(partial), usable))).at(-1), UNANSWERED);
  async function* broken() {
    yield partial;
    throw new Error("socket hang up");
  }
  const events = await all(relayEstimate(broken(), usable));
  assert.deepEqual(events.map((event) => event.type), ["partial", "error"]);
  assert.deepEqual(events.at(-1), UNANSWERED);
});

const stream = (...events: unknown[]) => new Response(
  bytes(...events.map((event) => `${JSON.stringify(event)}\n`)),
  { headers: { "Content-Type": NDJSON } },
);

test("the form hears each partial, then gets the settled answer", async () => {
  const heard: PartialEstimate[] = [];
  const settled = await readEstimate(stream(
    { type: "partial", provider: "codex", estimate: bowl },
    { type: "done", provider: "average", estimate: { ...bowl, calories: 650 } },
  ), (partial) => heard.push(partial));
  assert.deepEqual(heard, [{ type: "partial", provider: "codex", estimate: bowl }]);
  assert.deepEqual(settled, { estimate: { ...bowl, calories: 650 }, provider: "average" });
});

test("a streamed failure throws with its status, as api() does", async () => {
  await assert.rejects(
    readEstimate(stream({ type: "partial", provider: "codex", estimate: bowl }, UNANSWERED)),
    (error: Error & { status?: number }) => error.status === 503 && error.message === UNANSWERED.error,
  );
  await assert.rejects(
    readEstimate(stream({ type: "partial", provider: "codex", estimate: bowl })),
    (error: Error & { status?: number }) => error.status === 503,
  );
});

test("a plain JSON answer, from the direct API or an older estimator, still reads", async () => {
  assert.deepEqual(
    await readEstimate(Response.json({ estimate: bowl, provider: "grok" })),
    { estimate: bowl, provider: "grok" },
  );
  await assert.rejects(
    readEstimate(Response.json({ error: "The team's 60 daily estimates have been used." }, { status: 429 })),
    (error: Error & { status?: number }) => error.status === 429 && error.message.includes("60 daily"),
  );
  await assert.rejects(
    readEstimate(new Response("<html>", { status: 502 })),
    (error: Error & { status?: number }) => error.status === 502,
  );
});
