/**
 * Which drafts are on a form, across this phone's tabs. Two tabs writing one
 * draft overwrite each other's typing, and a draft carries the ids its meal
 * or session is saved under, so the second save would replace the first
 * entry in the journal. A form holds its draft for as long as it is mounted,
 * and a tab opens a draft only once it holds it.
 *
 * Web Locks, because the browser lets go of a tab's locks when the tab is
 * closed, crashes, or is dropped from memory, so a tab that is gone holds
 * nothing. They exist only over HTTPS and on localhost. Without them every
 * claim succeeds and tabs are not kept apart, as before there were locks.
 */

const PREFIX = "athx-draft:";

/**
 * How long opening a draft waits for another tab to let go of it. A reload
 * is the reason to wait at all: the page being replaced can let go a moment
 * after the new one asks. A tab that still has the draft open does not.
 */
export const CLAIM_WAIT_MS = 1000;

type Hold = {
  /** False once released: a claim granted after that lets go at once. */
  wanted: boolean;
  /** Set once granted. Calling it lets go. */
  release?: () => void;
  claim: Promise<boolean>;
};

const holds = new Map<string, Hold>();
const NONE: ReadonlySet<string> = new Set();
let elsewhere: ReadonlySet<string> = NONE;
const listeners = new Set<() => void>();

function lockManager(): LockManager | null {
  try {
    return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
  } catch {
    return null;
  }
}

/**
 * Holds a draft for this tab until releaseDraft. Resolves false when another
 * tab has it and does not let go within `wait` milliseconds. Claiming one
 * this tab already holds, or is already asking for, joins that claim.
 */
export function claimDraft(id: string, wait = 0): Promise<boolean> {
  const held = holds.get(id);
  if (held) {
    held.wanted = true;
    return held.claim;
  }
  const hold: Hold = { wanted: true, claim: Promise.resolve(true) };
  holds.set(id, hold);
  const manager = lockManager();
  if (!manager) return hold.claim;
  hold.claim = new Promise<boolean>((resolve) => {
    const giveUp = wait > 0 ? new AbortController() : null;
    const timer = giveUp ? setTimeout(() => giveUp.abort(), wait) : undefined;
    const lost = () => {
      if (holds.get(id) === hold) holds.delete(id);
      resolve(false);
    };
    manager
      .request(PREFIX + id, giveUp ? { signal: giveUp.signal } : { ifAvailable: true }, (lock) => {
        clearTimeout(timer);
        if (!lock || !hold.wanted) return lost();
        const kept = new Promise<void>((done) => {
          hold.release = done;
        });
        resolve(true);
        void refreshElsewhere();
        return kept;
      })
      // Settles once the lock is let go, or the wait ran out. Locks that
      // refuse for any other reason are as good as none: the draft opens.
      .catch((error: unknown) => {
        clearTimeout(timer);
        if ((error as { name?: string } | null)?.name === "AbortError") lost();
        else resolve(true);
      })
      .finally(() => void refreshElsewhere());
  });
  return hold.claim;
}

/** Lets go of a draft this tab holds or is asking for. */
export function releaseDraft(id: string) {
  const hold = holds.get(id);
  if (!hold) return;
  holds.delete(id);
  hold.wanted = false;
  hold.release?.();
}

/** Drafts a form in another tab has open, as of the last look. */
export const draftsElsewhere = () => elsewhere;
export const noDraftsElsewhere = () => NONE;

/** Looks again at which drafts other tabs hold. */
export async function refreshElsewhere() {
  const manager = lockManager();
  if (!manager) return;
  let names: string[];
  try {
    names = ((await manager.query()).held ?? []).map((lock) => lock.name ?? "");
  } catch {
    return;
  }
  const next = new Set(
    names
      .filter((name) => name.startsWith(PREFIX))
      .map((name) => name.slice(PREFIX.length))
      // Held by this tab, which is not elsewhere.
      .filter((id) => !holds.get(id)?.release),
  );
  if (next.size === elsewhere.size && [...next].every((id) => elsewhere.has(id))) return;
  elsewhere = next.size ? next : NONE;
  for (const listener of listeners) listener();
}

const lookAgain = () => void refreshElsewhere();
const lookIfShown = () => {
  if (document.visibilityState === "visible") lookAgain();
};

/**
 * For useSyncExternalStore. Locks say nothing when they change hands, so it
 * looks again whenever another tab may have opened or closed a form: when it
 * writes its drafts, and when this tab comes back into view.
 */
export function subscribeElsewhere(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", lookAgain);
    window.addEventListener("focus", lookAgain);
    document.addEventListener("visibilitychange", lookIfShown);
  }
  lookAgain();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    window.removeEventListener("storage", lookAgain);
    window.removeEventListener("focus", lookAgain);
    document.removeEventListener("visibilitychange", lookIfShown);
  };
}

/**
 * A page kept in the back/forward cache would go on holding its drafts while
 * nobody can see it, so it lets go of them on the way in, and reloads on the
 * way back, to open them again only once it holds them.
 */
export function releaseWhenCached() {
  const hide = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    for (const id of [...holds.keys()]) releaseDraft(id);
  };
  const show = (event: PageTransitionEvent) => {
    if (event.persisted) window.location.reload();
  };
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  return () => {
    window.removeEventListener("pagehide", hide);
    window.removeEventListener("pageshow", show);
  };
}
