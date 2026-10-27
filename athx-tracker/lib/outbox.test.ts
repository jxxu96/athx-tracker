import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bodyweight, RecordItem } from "./domain.ts";
import {
  OUTBOX_KEY,
  applyOutbox,
  enqueueDelete,
  enqueueSave,
  readOutbox,
  refuse,
  retryable,
  settle,
  writeOutbox,
} from "./outbox.ts";

const weigh = (id: string, kg: number, day = "2026-03-01"): Bodyweight => ({
  id, kind: "bodyweight", athlete: "gators", day, kg,
});

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}

test("the latest version of a record replaces what was waiting for it, in order", () => {
  let entries = enqueueSave([], weigh("a", 80));
  entries = enqueueSave(entries, weigh("b", 70));
  entries = enqueueSave(entries, weigh("a", 81));
  assert.deepEqual(entries.map((entry) => entry.seq), [2, 3]);
  assert.equal(entries[1].op === "save" && (entries[1].record as Bodyweight).kg, 81);
  entries = enqueueDelete(entries, "b");
  assert.deepEqual(entries.map((entry) => entry.op), ["save", "delete"]);
});

test("the phone shows the server's journal with what is still waiting", () => {
  const server: RecordItem[] = [weigh("a", 80), weigh("b", 70)];
  const entries = enqueueDelete(enqueueSave(enqueueSave([], weigh("a", 82)), weigh("c", 60)), "b");
  const shown = applyOutbox(server, entries) as Bodyweight[];
  assert.deepEqual(shown.map((record) => [record.id, record.kg]).sort(), [["a", 82], ["c", 60]]);
});

test("a sent entry is settled by its own number, so a newer edit keeps waiting", () => {
  const first = enqueueSave([], weigh("a", 80));
  const edited = enqueueSave(first, weigh("a", 81));
  // The first send answers after the edit arrived: the edit is still to send.
  assert.equal(settle(edited, first[0].seq).length, 1);
  assert.equal(settle(edited, edited[0].seq).length, 0);
  assert.equal(refuse(edited, edited[0].seq, "Check the entry")[0].error, "Check the entry");
});

test("the outbox survives a reload, and a phone that will not store it says so", () => {
  const store = memory();
  assert.equal(writeOutbox(enqueueSave([], weigh("a", 80)), store), true);
  assert.equal(readOutbox(store).length, 1);
  store.data.set(OUTBOX_KEY, "not json");
  assert.deepEqual(readOutbox(store), []);
  assert.equal(writeOutbox([], null), false);
  const refusing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.equal(writeOutbox([], refusing), false);
});

test("no answer, the server failing or a lapsed sign-in is worth retrying; a refusal is not", () => {
  assert.equal(retryable(new TypeError("Failed to fetch")), true);
  assert.equal(retryable(Object.assign(new Error("x"), { status: 502 })), true);
  assert.equal(retryable(Object.assign(new Error("x"), { status: 401 })), true);
  assert.equal(retryable(Object.assign(new Error("x"), { status: 400 })), false);
  assert.equal(retryable(Object.assign(new Error("x"), { status: 413 })), false);
});
