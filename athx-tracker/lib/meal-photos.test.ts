import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PHOTO_BODY_BYTES,
  PHOTO_BYTES,
  PHOTO_CHARS,
  PHOTO_EDGE,
  PHOTO_LIMIT,
  base64Bytes,
  fitWithin,
  isJpegData,
} from "./meal-photos.ts";
import { FOOD_NOTES_LIMIT, estimatePrompt } from "./estimate-conversation.ts";
import { estimateRequestSchema } from "./validation.ts";
import { grokRequest } from "./grok.ts";

// The start and end of a JPEG, which is all a check of its bytes reads.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const photo = { type: "image/jpeg", data: JPEG.toString("base64") } as const;
/** The largest photo either side accepts. */
const biggest = {
  type: "image/jpeg",
  data: Buffer.concat([JPEG, Buffer.alloc(PHOTO_BYTES - JPEG.length)]).toString("base64"),
} as const;

test("a photo is shrunk to 1536 px on its long side, its shape kept, and never enlarged", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: PHOTO_EDGE, height: 1152 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1152, height: PHOTO_EDGE });
  assert.deepEqual(fitWithin(8000, 100), { width: PHOTO_EDGE, height: 19 });
  assert.deepEqual(fitWithin(100000, 1), { width: PHOTO_EDGE, height: 1 }, "never a side of 0");
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  for (const [width, height] of [[0, 10], [10, 0], [Number.NaN, 10], [Infinity, 10], [-1, 10]])
    assert.equal(fitWithin(width, height), null, `${width} x ${height}`);
});

test("a JPEG is known by its first bytes, as padded base64 within 1 MB", () => {
  assert.equal(base64Bytes(photo.data), JPEG.length);
  assert.equal(base64Bytes(biggest.data), PHOTO_BYTES);
  assert.ok(biggest.data.length <= PHOTO_CHARS);
  assert.ok(isJpegData(photo.data));
  assert.ok(isJpegData(biggest.data));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  for (const data of [
    png, "", photo.data.replace(/=+$/, ""), `${photo.data.slice(0, -4)}!!!!`,
    Buffer.concat([JPEG, Buffer.alloc(PHOTO_BYTES)]).toString("base64"),
    "data:image/jpeg;base64,/9j/4A==",
  ]) assert.equal(isJpegData(data), false, data.slice(0, 40));
});

test("the phone and the estimator hold a meal's photos to the same limits", async () => {
  // Not a literal specifier, so the type checker does not follow it out of
  // the image, which is built from athx-tracker/ alone.
  const estimatorModule = "../../estimator/server.mjs";
  const estimator = (await import(estimatorModule)) as { PHOTO_LIMIT: number; PHOTO_BYTES: number };
  assert.equal(estimator.PHOTO_LIMIT, PHOTO_LIMIT);
  assert.equal(estimator.PHOTO_BYTES, PHOTO_BYTES);
});

test("photos can be all there is, up to three JPEGs", () => {
  const parse = (body: object) => estimateRequestSchema.safeParse(body);
  assert.ok(parse({ description: "", images: [photo] }).success, "a photo with no words");
  assert.ok(parse({ description: "ok", images: [photo] }).success, "a photo with a word");
  assert.ok(parse({ description: "Lunch, large", images: Array(PHOTO_LIMIT).fill(photo) }).success);
  assert.ok(parse({ description: "", images: [biggest] }).success, "the largest photo");
  assert.equal(parse({ description: "  ", images: [photo] }).success, true);
  assert.equal(parse({ description: "" }).success, false, "no words and no photo");
  assert.equal(parse({ description: "ok" }).success, false, "too few words without a photo");
  for (const [why, images] of [
    ["none in the list", []],
    ["too many", Array(PHOTO_LIMIT + 1).fill(photo)],
    ["a PNG", [{ type: "image/png", data: photo.data }]],
    ["a PNG called a JPEG", [{ type: "image/jpeg", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64") }]],
    ["a data URL", [{ type: "image/jpeg", data: `data:image/jpeg;base64,${photo.data}` }]],
    ["past 1 MB", [{ type: "image/jpeg", data: Buffer.concat([JPEG, Buffer.alloc(PHOTO_BYTES)]).toString("base64") }]],
    ["anything else on it", [{ ...photo, name: "IMG_0001.HEIC" }]],
  ] as const) assert.equal(parse({ description: "Lunch", images }).success, false, why);
});

test("a shared meal's photos ask for dishes with no words to cut", () => {
  const parse = (body: object) => estimateRequestSchema.safeParse(body);
  assert.ok(parse({ description: "", dishes: [], images: [photo] }).success);
  assert.ok(parse({ description: "pizza, salad", dishes: ["pizza", "salad"], images: [photo] }).success);
  assert.equal(parse({ description: "pizza, salad", dishes: [] }).success, false, "an empty cut needs photos");
});

test("the largest request with photos fits what the route reads and what the estimator takes", async () => {
  const previous = {
    name: "\\".repeat(300), calories: 600, protein: 40, carbs: 65, fat: 20, fiber: 2, alcohol: 0,
    assumptions: "\\".repeat(3000), confidence: "medium" as const,
  };
  const body = {
    description: "\\".repeat(4000),
    refinement: {
      previous, replies: Array(6).fill("\\".repeat(1000)),
      byEstimator: { codex: previous, claude: previous, grok: previous },
    },
    images: Array(PHOTO_LIMIT).fill(biggest),
  };
  const input = estimateRequestSchema.parse(body);
  // What the phone sends the route, held to what the route reads: readBody's
  // cap in lib/server.ts, which this cannot import, plus room for photos.
  const MAX_BODY_BYTES = 96_000;
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < MAX_BODY_BYTES + PHOTO_BODY_BYTES);
  // What the route sends the estimator, held to what the estimator reads.
  const estimatorModule = "../../estimator/server.mjs";
  const { BODY_LIMIT } = (await import(estimatorModule)) as { BODY_LIMIT: number };
  const forwarded = JSON.stringify({
    description: estimatePrompt(input.description, input.refinement, "\\".repeat(FOOD_NOTES_LIMIT)),
    budgetMs: 130000, stream: true, previousEstimates: input.refinement!.byEstimator, images: input.images,
  });
  assert.ok(forwarded.length < BODY_LIMIT, `${forwarded.length} >= ${BODY_LIMIT}`);
});

test("the x.ai API is sent each photo as a data URL ahead of the words", () => {
  const body = grokRequest("The meal in the attached photos.", "grok-4.7", { images: [photo, photo] });
  assert.deepEqual(body.input, [{
    role: "user",
    content: [
      { type: "input_image", image_url: `data:image/jpeg;base64,${photo.data}` },
      { type: "input_image", image_url: `data:image/jpeg;base64,${photo.data}` },
      { type: "input_text", text: "The meal in the attached photos." },
    ],
  }]);
  assert.match(body.instructions, /When photos are attached, they show the meal/);
  assert.equal(grokRequest("one banana", "grok-4.7").input, "one banana", "without photos, the words as before");
  assert.equal(grokRequest("pizza", "grok-4.7", { dishes: true, images: [photo] }).text.format.name, "shared_meal_estimate");
});
