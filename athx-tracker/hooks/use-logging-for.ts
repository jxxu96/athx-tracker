"use client";

import { useCallback, useSyncExternalStore } from "react";

export type LoggingFor = "hippos" | "gators" | "both";

const STORAGE_KEY = "athx-logging-for";
const CHOICES: readonly LoggingFor[] = ["hippos", "gators", "both"];

/** What a phone that refuses storage remembers, for as long as the app is open. */
let memory: LoggingFor | null = null;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  // Another tab on this phone switching should move this one too.
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function snapshot(): LoggingFor {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (CHOICES.includes(stored as LoggingFor)) return stored as LoggingFor;
  } catch {
    // Private browsing can refuse storage; the choice still holds this visit.
  }
  return memory ?? "hippos";
}

/** The server cannot know a phone's choice. The journal has always opened on Hippos. */
const serverSnapshot = (): LoggingFor => "hippos";

/**
 * Who this phone logs for: Hippos, Gators, or both. Each of you carries your
 * own phone, so it is kept on the phone rather than in the shared settings,
 * and a phone opens on whoever it last logged for.
 */
export function useLoggingFor() {
  const who = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setWho = useCallback((next: LoggingFor) => {
    memory = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Kept in memory above instead.
    }
    for (const listener of listeners) listener();
  }, []);
  return [who, setWho] as const;
}
