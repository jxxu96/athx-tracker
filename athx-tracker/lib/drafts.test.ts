import { test } from "node:test";
import assert from "node:assert/strict";
import type { Meal } from "./domain.ts";
import {
  DRAFTS_KEY,
  changeDrafts,
  draftFor,
  draftsSnapshot,
  dropDraft,
  dropDraftsFor,
  keepDraft,
  latestDraft,
  listedDrafts,
  draftToReopen,
  parseBook,
  setTabDraft,
  tabDraft,
  textOf,
  type Draft,
  type DraftBook,
} from "./drafts.ts";

/** Browser storage as a page sees it, shared with "another tab" that writes it directly. */
class FakeStorage {
  items = new Map<string, string>();
  refuse = false;
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.refuse) throw new Error("QuotaExceededError");
    this.items.set(key, value);
  }
}

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
});

test("a form reopens what its tab had, or in a new tab what any tab had last", () => {
  const book = keepDraft(keepDraft(empty, draft("mine")), draft("last"));
  assert.equal(draftToReopen(book, "meal", undefined)?.id, "last");
  assert.equal(draftToReopen(book, "meal", "mine")?.id, "mine");
  // This tab had a fresh form, or a draft since saved: fresh again.
  assert.equal(draftToReopen(book, "meal", null), null);
  assert.equal(draftToReopen(book, "meal", "saved since"), null);
  assert.equal(draftToReopen(book, "session", undefined), null);
});

test("Drafts lists the others for that form, newest first, leaving out the one on this tab's form", () => {
  let book = keepDraft(empty, draft("old", { updatedAt: 1 }));
  book = keepDraft(book, draft("newer", { updatedAt: 5 }));
  book = keepDraft(book, draft("run", { kind: "session", updatedAt: 9 }));
  book = keepDraft(book, draft("open", { updatedAt: 7 }));
  assert.deepEqual(listedDrafts(book, "meal", "open").map((item) => item.id), ["newer", "old"]);
  assert.deepEqual(listedDrafts(book, "session", "run").map((item) => item.id), []);
  assert.deepEqual(listedDrafts(book, "session", null).map((item) => item.id), ["run"]);
  // Another tab's open draft is still listed here: it is not on this tab's form.
  assert.deepEqual(listedDrafts(book, "meal", "old").map((item) => item.id), ["open", "newer"]);
});

test("a meal set aside while it estimates keeps its draft without taking the form over", () => {
  const book = keepDraft(empty, draft("on screen"));
  const aside = keepDraft(book, draft("estimating", { updatedAt: 2 }), false);
  assert.equal(aside.open.meal, "on screen");
  assert.equal(aside.drafts.find((item) => item.id === "estimating")?.updatedAt, 2);
});

test("each tab keeps which draft it had open, and a tab that had none says so", () => {
  const tab = new FakeStorage();
  Object.assign(globalThis, { sessionStorage: tab });
  try {
    assert.equal(tabDraft("meal"), undefined);
    setTabDraft("meal", "a");
    setTabDraft("session", null);
    assert.equal(tabDraft("meal"), "a");
    assert.equal(tabDraft("session"), null);
    tab.items.set("athx-drafts-tab", "not json");
    assert.equal(tabDraft("meal"), undefined);
  } finally {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
  // No storage at all: every reload is a fresh start.
  setTabDraft("meal", "b");
  assert.equal(tabDraft("meal"), undefined);
});

test("a phone that refuses storage keeps its drafts for as long as the page is open", () => {
  // No storage at all, from the start, as private browsing can be.
  changeDrafts((book) => keepDraft(book, draft("x")));
  changeDrafts((book) => keepDraft(book, draft("y")));
  assert.deepEqual(draftsSnapshot().drafts.map((item) => item.id).sort(), ["x", "y"]);
});

test("a change starts from what another tab last wrote, not from this page's older copy", () => {
  const shared = new FakeStorage();
  Object.assign(globalThis, { localStorage: shared });
  try {
    shared.setItem(DRAFTS_KEY, JSON.stringify(keepDraft(empty, draft("a"))));
    // Read afresh, since storage holds something this page has not seen.
    assert.equal(latestDraft("a")?.id, "a");
    assert.deepEqual(draftsSnapshot().drafts.map((item) => item.id), ["a"]);

    // The other tab types into its own draft, and this one into another.
    shared.setItem(DRAFTS_KEY, JSON.stringify(keepDraft(parseBook(shared.getItem(DRAFTS_KEY)), draft("b"))));
    changeDrafts((book) => keepDraft(book, draft("c")));
    const written = parseBook(shared.getItem(DRAFTS_KEY));
    assert.deepEqual(written.drafts.map((item) => item.id).sort(), ["a", "b", "c"]);
    assert.deepEqual(draftsSnapshot(), written);

    // Storage full: the change lasts as long as the page does, and the next
    // one does not mistake the unchanged storage for another tab's write.
    shared.refuse = true;
    changeDrafts((book) => keepDraft(book, draft("d")));
    changeDrafts((book) => keepDraft(book, draft("e")));
    assert.deepEqual(draftsSnapshot().drafts.map((item) => item.id).sort(), ["a", "b", "c", "d", "e"]);
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
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
