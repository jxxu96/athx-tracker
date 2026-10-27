import type { RecordItem } from "./domain.ts";

/**
 * Saves and deletes the server has not had yet, kept on the phone until it
 * answers. Records carry ids made on the phone and the endpoint upserts on
 * them, so sending one twice is harmless: a save that did land before the
 * connection dropped is only written again.
 *
 * Browser storage, because this is one phone's unsent work and nobody
 * else's. It can be refused, in a private window or with site data blocked,
 * and then nothing waits: the save fails as it did before, and says so.
 */
export type OutboxEntry =
  | { seq: number; op: "save"; record: RecordItem; error?: string }
  | { seq: number; op: "delete"; id: string; error?: string };

export const OUTBOX_KEY = "athx-outbox";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readOutbox(store: Storage | null = storage()): OutboxEntry[] {
  try {
    const parsed = JSON.parse(store?.getItem(OUTBOX_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

/** False when the phone would not keep it, so the caller knows nothing is waiting. */
export function writeOutbox(entries: OutboxEntry[], store: Storage | null = storage()) {
  try {
    if (!store) return false;
    store.setItem(OUTBOX_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

const idOf = (entry: OutboxEntry) => (entry.op === "save" ? entry.record.id : entry.id);
const next = (entries: OutboxEntry[]) => entries.reduce((n, entry) => Math.max(n, entry.seq), 0) + 1;

/** The latest version of a record replaces anything already waiting for it. */
export function enqueueSave(entries: OutboxEntry[], record: RecordItem): OutboxEntry[] {
  return [
    ...entries.filter((entry) => idOf(entry) !== record.id),
    { seq: next(entries), op: "save", record },
  ];
}

/**
 * A delete replaces a waiting save. The server may hold an earlier version
 * of the record or may never have seen it; deleting an id it does not have
 * is harmless, so the delete is sent either way.
 */
export function enqueueDelete(entries: OutboxEntry[], id: string): OutboxEntry[] {
  return [...entries.filter((entry) => idOf(entry) !== id), { seq: next(entries), op: "delete", id }];
}

/** Once the server has it, unless it has been replaced in the meantime. */
export function settle(entries: OutboxEntry[], seq: number) {
  return entries.filter((entry) => entry.seq !== seq);
}

/** Refused for good, so it waits for an edit or a delete instead of retrying. */
export function refuse(entries: OutboxEntry[], seq: number, error: string): OutboxEntry[] {
  return entries.map((entry) => (entry.seq === seq ? { ...entry, error } : entry));
}

/** The journal as this phone should show it: the server's, with what is still waiting. */
export function applyOutbox(records: readonly RecordItem[], entries: readonly OutboxEntry[]) {
  let out = [...records];
  for (const entry of entries) {
    if (entry.op === "delete") out = out.filter((record) => record.id !== entry.id);
    else out = [entry.record, ...out.filter((record) => record.id !== entry.record.id)];
  }
  return out;
}

/**
 * Worth trying again later: no answer at all, a timeout, the server or the
 * proxy in front of it failing, or a session that ended, which signing in
 * again cures. Anything else is the entry itself, and repeating it would be
 * refused the same way.
 */
export function retryable(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  return status === undefined || status === 401 || status === 408 || status === 429 || status >= 500;
}

/*
 * The outbox as this page holds it, for useSyncExternalStore. Memory is the
 * truth while the page is open, so a phone that refuses storage still keeps
 * what waits until the page closes; storage is the copy that outlives it, and
 * another tab's change arrives through its storage event.
 */
const NONE: OutboxEntry[] = [];
let held: OutboxEntry[] | null = null;
const listeners = new Set<() => void>();

export function outboxSnapshot() {
  if (held === null) held = readOutbox();
  return held;
}

/** The server has no outbox, so the page renders first with nothing waiting. */
export const serverOutbox = () => NONE;

export function subscribeOutbox(listener: () => void) {
  listeners.add(listener);
  const shared = (event: StorageEvent) => {
    if (event.key !== OUTBOX_KEY) return;
    held = null;
    listener();
  };
  window.addEventListener("storage", shared);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", shared);
  };
}

export function changeOutbox(change: (entries: OutboxEntry[]) => OutboxEntry[]) {
  held = change(outboxSnapshot());
  writeOutbox(held);
  for (const listener of listeners) listener();
}
