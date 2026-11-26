import { test } from "node:test";
import assert from "node:assert/strict";
import { picturesIn } from "./pasted-photos.ts";

const png = { type: "image/png", name: "image.png" };
const jpeg = { type: "image/jpeg", name: "IMG_0001.jpg" };
const pdf = { type: "application/pdf", name: "menu.pdf" };

test("a screenshot or a copied picture is pasted, wherever the cursor is", () => {
  assert.deepEqual(picturesIn({ types: ["Files"], files: [png] }, false), [png]);
  assert.deepEqual(picturesIn({ types: ["Files"], files: [png] }, true), [png], "nothing to type in its place");
  // Copy image in a browser: the picture and the tag that showed it, no plain text.
  assert.deepEqual(picturesIn({ types: ["text/html", "Files"], files: [png] }, true), [png]);
});

test("picture files copied in a folder come in, and anything else stays out", () => {
  assert.deepEqual(picturesIn({ types: ["Files"], files: [jpeg, pdf, png] }, false), [jpeg, png]);
  assert.deepEqual(picturesIn({ types: ["Files"], files: [pdf] }, false), []);
  assert.deepEqual(picturesIn({ types: ["text/plain"], files: [] }, false), [], "text alone");
});

test("text pasted into a box stays text, though Office puts a picture of it beside it", () => {
  const office = { types: ["text/plain", "text/html", "Files"], files: [png] };
  assert.deepEqual(picturesIn(office, true), []);
  assert.deepEqual(picturesIn(office, false), [png], "with no box to type in, the picture is all it can be");
});
