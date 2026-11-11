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
  /**
   * The draft each form last had on screen, in whichever tab. A tab with
   * nothing open of its own yet, as one the app was just opened in, opens
   * with it, unless another tab still has it on a form.
   */
  open: Record<DraftKind, string | null>;
};

export const DRAFTS_KEY = "athx-drafts";
/** The draft each form in this tab had open, which a reload of this tab opens with. */
export const TAB_DRAFTS_KEY = "athx-drafts-tab";

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

/**
 * The latest of a draft replaces the earlier. The form on screen has it open;
 * a meal set aside while it estimates keeps writing its draft without taking
 * the form over.
 */
export function keepDraft(book: DraftBook, draft: Draft, shown = true): DraftBook {
  return {
    drafts: [draft, ...book.drafts.filter((held) => held.id !== draft.id)],
    open: shown ? { ...book.open, [draft.kind]: draft.id } : book.open,
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

/**
 * What a form opens with the first time it opens in a tab: the draft this
 * tab had open, given as mine; or, in a tab with nothing of its own yet
 * (mine undefined), the one any tab had on screen last. Null is a fresh form.
 */
export function draftToReopen(book: DraftBook, kind: DraftKind, mine: string | null | undefined) {
  const id = mine === undefined ? book.open[kind] : mine;
  return book.drafts.find((draft) => draft.id === id && draft.kind === kind) ?? null;
}

/** An unsaved edit of an entry, so editing it again picks up where it was left. */
export function draftFor(book: DraftBook, recordId: string) {
  return book.drafts.find((draft) => draft.editing?.id === recordId) ?? null;
}

/**
 * What Drafts lists for a form: the others, newest first. The one on this
 * tab's form is not listed. Each tab has its own on screen, so it is named
 * here rather than read from the book, which every tab shares.
 */
export function listedDrafts(book: DraftBook, kind: DraftKind, shown: string | null) {
  return book.drafts
    .filter((draft) => draft.kind === kind && draft.id !== shown)
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
/** What storage held when this page last read or wrote it, to tell when another tab has written since. */
let heldText: string | null = null;
const listeners = new Set<() => void>();

function storage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function stored() {
  try {
    return storage()?.getItem(DRAFTS_KEY) ?? null;
  } catch {
    return null;
  }
}

export function draftsSnapshot() {
  if (held === null) {
    heldText = stored();
    held = parseBook(heldText);
  }
  return held;
}

function tabStorage() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function tabOpen(): Partial<Record<DraftKind, unknown>> {
  try {
    const parsed = JSON.parse(tabStorage()?.getItem(TAB_DRAFTS_KEY) ?? "null") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Partial<Record<DraftKind, unknown>>) : {};
  } catch {
    return {};
  }
}

/**
 * The draft this tab's form had open, kept per tab so that two tabs never
 * reopen the same one: a reload opens what this tab had, null being a fresh
 * form. Undefined when this tab has had no form open yet, as when the app
 * has just been opened, which opens with the book's instead.
 */
export function tabDraft(kind: DraftKind): string | null | undefined {
  const open = tabOpen();
  if (!(kind in open)) return undefined;
  const id = open[kind];
  return typeof id === "string" ? id : null;
}

export function setTabDraft(kind: DraftKind, id: string | null) {
  try {
    tabStorage()?.setItem(TAB_DRAFTS_KEY, JSON.stringify({ ...tabOpen(), [kind]: id }));
  } catch {
    // Refused: a reload of this tab opens with the book's, as a new tab does.
  }
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

/**
 * A draft as storage has it now. Another tab may have written to it since
 * this page last read, without its storage event having arrived yet.
 */
export function latestDraft(id: string) {
  const now = stored();
  if (held !== null && now !== heldText) {
    held = parseBook(now);
    heldText = now;
    for (const listener of listeners) listener();
  }
  return draftsSnapshot().drafts.find((draft) => draft.id === id) ?? null;
}

export function changeDrafts(change: (book: DraftBook) => DraftBook) {
  // Another tab may have written since this one read, and its storage event
  // may not have arrived yet. Changing what storage holds now keeps that
  // tab's latest typing, where changing this page's copy would write an
  // older one back over it.
  const now = stored();
  const reread = held !== null && now !== heldText;
  if (reread) {
    held = parseBook(now);
    heldText = now;
  }
  const current = draftsSnapshot();
  const next = change(current);
  if (next !== current) {
    held = next;
    try {
      const store = storage();
      if (store) {
        const text = JSON.stringify(next);
        store.setItem(DRAFTS_KEY, text);
        // Only once it is there: storage that is full, or refused, still
        // holds what it did, which is no sign of another tab writing.
        heldText = text;
      }
    } catch {
      // Full or refused: the drafts still last as long as the page does.
    }
  } else if (!reread) return;
  for (const listener of listeners) listener();
}
