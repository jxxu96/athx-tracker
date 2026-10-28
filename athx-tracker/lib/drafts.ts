import type { Meal, Workout } from "./domain.ts";

/**
 * What has been typed into the Meal or Session form and not saved yet, kept
 * on this phone as it is typed. Closing the app, the phone dropping it from
 * memory, or a reload loses nothing: the form that was open comes back as it
 * was, and anything set aside waits in Drafts.
 *
 * Browser storage, because half a meal on one phone is that phone's business
 * and works without a connection. A phone that refuses storage keeps drafts
 * only while the page stays open.
 */
export type DraftKind = "meal" | "session";
export type DraftWho = "hippos" | "gators" | "both";

export type Draft = {
  id: string;
  kind: DraftKind;
  /** The entry being edited, as it was when the edit began. Null for a new one. */
  editing: Meal | Workout | null;
  /** Who it was for: the header's choice for a new entry, the entry's athlete for an edit. */
  who: DraftWho;
  /** One line to know it by, and what kind of meal or session it is. */
  summary: string;
  detail: string;
  /** When it was last typed into, by this phone's clock. */
  updatedAt: number;
  /** The form's own fields, which only that form reads back. */
  state: Record<string, unknown>;
};

export type DraftBook = {
  drafts: Draft[];
  /** The draft each form had open, which it opens with again. */
  open: Record<DraftKind, string | null>;
};

export const DRAFTS_KEY = "athx-drafts";

const EMPTY: DraftBook = { drafts: [], open: { meal: null, session: null } };

/** Whatever storage holds, as a book; anything unreadable is no drafts rather than a broken app. */
export function parseBook(text: string | null): DraftBook {
  try {
    const parsed = JSON.parse(text ?? "null") as Partial<DraftBook> | null;
    if (!parsed || !Array.isArray(parsed.drafts)) return EMPTY;
    const drafts = parsed.drafts.filter(
      (draft): draft is Draft =>
        Boolean(draft) &&
        typeof draft.id === "string" &&
        (draft.kind === "meal" || draft.kind === "session") &&
        typeof draft.state === "object" &&
        draft.state !== null,
    );
    const open = (kind: DraftKind) => {
      const id = parsed.open?.[kind];
      return typeof id === "string" && drafts.some((draft) => draft.id === id) ? id : null;
    };
    return { drafts, open: { meal: open("meal"), session: open("session") } };
  } catch {
    return EMPTY;
  }
}

/** The latest of a draft replaces the earlier, and the form typing into it has it open. */
export function keepDraft(book: DraftBook, draft: Draft): DraftBook {
  return {
    drafts: [draft, ...book.drafts.filter((held) => held.id !== draft.id)],
    open: { ...book.open, [draft.kind]: draft.id },
  };
}

export function dropDraft(book: DraftBook, id: string): DraftBook {
  if (!book.drafts.some((draft) => draft.id === id)) return book;
  return {
    drafts: book.drafts.filter((draft) => draft.id !== id),
    open: {
      meal: book.open.meal === id ? null : book.open.meal,
      session: book.open.session === id ? null : book.open.session,
    },
  };
}

/** A deleted entry takes any unsaved edit of it along. */
export function dropDraftsFor(book: DraftBook, recordId: string): DraftBook {
  return book.drafts
    .filter((draft) => draft.editing?.id === recordId)
    .reduce((next, draft) => dropDraft(next, draft.id), book);
}

export function openDraft(book: DraftBook, kind: DraftKind, id: string | null): DraftBook {
  return { ...book, open: { ...book.open, [kind]: id } };
}

/** The draft a form had open, if it is still there. */
export function openedDraft(book: DraftBook, kind: DraftKind) {
  return book.drafts.find((draft) => draft.id === book.open[kind] && draft.kind === kind) ?? null;
}

/** An unsaved edit of an entry, so editing it again picks up where it was left. */
export function draftFor(book: DraftBook, recordId: string) {
  return book.drafts.find((draft) => draft.editing?.id === recordId) ?? null;
}

/** What Drafts lists for a form: the others, newest first. The open one is on the form. */
export function listedDrafts(book: DraftBook, kind: DraftKind) {
  return book.drafts
    .filter((draft) => draft.kind === kind && draft.id !== book.open[kind])
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/*
 * Reading a draft back. A draft saved by an older form, or damaged in
 * storage, falls back field by field rather than filling a form with
 * something it cannot show.
 */

/** A text field, or the fallback when it holds something else. */
export function textOf(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

/** A value when it is one of the choices. */
export function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.includes(value as T) ? (value as T) : undefined;
}

/** A field held for each athlete, when both are there and of the right kind. */
export function bothOf<T>(value: unknown, isValue: (item: unknown) => item is T) {
  if (!value || typeof value !== "object") return undefined;
  const held = value as Record<string, unknown>;
  return isValue(held.hippos) && isValue(held.gators) ? { hippos: held.hippos, gators: held.gators } : undefined;
}

export const isText = (item: unknown): item is string => typeof item === "string";

/*
 * The book as this page holds it, for useSyncExternalStore. Memory is the
 * truth while the page is open; storage is the copy that outlives it, and
 * another tab's change arrives through its storage event.
 */
let held: DraftBook | null = null;
const listeners = new Set<() => void>();

function storage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function draftsSnapshot() {
  if (held === null) held = parseBook(storage()?.getItem(DRAFTS_KEY) ?? null);
  return held;
}

/** The server has no drafts, so the page renders first with none. */
export const serverDrafts = () => EMPTY;

export function subscribeDrafts(listener: () => void) {
  listeners.add(listener);
  const shared = (event: StorageEvent) => {
    if (event.key !== DRAFTS_KEY) return;
    held = null;
    listener();
  };
  window.addEventListener("storage", shared);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", shared);
  };
}

export function changeDrafts(change: (book: DraftBook) => DraftBook) {
  const next = change(draftsSnapshot());
  if (next === held) return;
  held = next;
  try {
    storage()?.setItem(DRAFTS_KEY, JSON.stringify(next));
  } catch {
    // Full or refused: the drafts still last as long as the page does.
  }
  for (const listener of listeners) listener();
}
