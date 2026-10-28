import { test } from "node:test";
import assert from "node:assert/strict";
import type { Meal } from "./domain.ts";
import {
  draftFor,
  dropDraft,
  dropDraftsFor,
  keepDraft,
  listedDrafts,
  openDraft,
  openedDraft,
  parseBook,
  textOf,
  type Draft,
  type DraftBook,
} from "./drafts.ts";

const empty: DraftBook = { drafts: [], open: { meal: null, session: null } };

const draft = (id: string, over: Partial<Draft> = {}): Draft => ({
  id, kind: "meal", editing: null, who: "hippos", summary: id, detail: "Lunch",
  updatedAt: 1, state: { name: id }, ...over,
});

const meal = { id: "m1", kind: "meal", athlete: "gators", day: "2026-10-28", name: "Oats" } as Meal;

test("keeping a draft replaces its earlier version and leaves it open on its form", () => {
  let book = keepDraft(empty, draft("a", { updatedAt: 1 }));
  book = keepDraft(book, draft("b", { updatedAt: 2 }));
  book = keepDraft(book, draft("a", { updatedAt: 3, summary: "a again" }));
  assert.equal(book.drafts.length, 2);
  assert.equal(book.drafts.find((item) => item.id === "a")?.summary, "a again");
  assert.equal(book.open.meal, "a");
  assert.equal(openedDraft(book, "meal")?.id, "a");
  assert.equal(openedDraft(book, "session"), null);
});

test("Drafts lists the others for that form, newest first", () => {
  let book = keepDraft(empty, draft("old", { updatedAt: 1 }));
  book = keepDraft(book, draft("newer", { updatedAt: 5 }));
  book = keepDraft(book, draft("run", { kind: "session", updatedAt: 9 }));
  book = keepDraft(book, draft("open", { updatedAt: 7 }));
  assert.deepEqual(listedDrafts(book, "meal").map((item) => item.id), ["newer", "old"]);
  assert.deepEqual(listedDrafts(book, "session").map((item) => item.id), []);
  assert.deepEqual(listedDrafts(openDraft(book, "session", null), "session").map((item) => item.id), ["run"]);
});

test("dropping the open draft leaves its form with none open", () => {
  const book = keepDraft(keepDraft(empty, draft("a")), draft("b"));
  const dropped = dropDraft(book, "b");
  assert.deepEqual(dropped.drafts.map((item) => item.id), ["a"]);
  assert.equal(dropped.open.meal, null);
  // Dropping what is not there changes nothing, so nothing is written.
  assert.equal(dropDraft(dropped, "zzz"), dropped);
});

test("an unsaved edit is found by its entry, and goes when the entry is deleted", () => {
  const book = keepDraft(keepDraft(empty, draft("new")), draft("edit", { editing: meal, who: "gators" }));
  assert.equal(draftFor(book, "m1")?.id, "edit");
  assert.equal(draftFor(book, "nope"), null);
  assert.deepEqual(dropDraftsFor(book, "m1").drafts.map((item) => item.id), ["new"]);
});

test("whatever storage holds reads as a book, and nothing readable is no drafts", () => {
  const book = keepDraft(empty, draft("a"));
  assert.deepEqual(parseBook(JSON.stringify(book)), book);
  assert.deepEqual(parseBook(null), empty);
  assert.deepEqual(parseBook("not json"), empty);
  assert.deepEqual(parseBook(JSON.stringify({ drafts: "no" })), empty);
  // A draft missing its state or kind is left out, and an open id with no draft is no open draft.
  const damaged = parseBook(JSON.stringify({
    drafts: [{ id: "x", kind: "meal" }, { id: "y", kind: "lunch", state: {} }, draft("ok")],
    open: { meal: "x", session: "gone" },
  }));
  assert.deepEqual(damaged.drafts.map((item) => item.id), ["ok"]);
  assert.deepEqual(damaged.open, { meal: null, session: null });
});

test("a draft's text field falls back when it holds anything else", () => {
  assert.equal(textOf("oats", ""), "oats");
  assert.equal(textOf(3, "fallback"), "fallback");
  assert.equal(textOf(undefined, ""), "");
});
