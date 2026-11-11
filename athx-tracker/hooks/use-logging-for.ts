"use client";

import { useCallback, useSyncExternalStore } from "react";

export type LoggingFor = "hippos" | "gators" | "both";

const STORAGE_KEY = "athx-logging-for";
const CHOICES: readonly LoggingFor[] = ["hippos", "gators", "both"];

/**
 * This tab's choice, read from storage once and held here after that. It
 * used to follow every switch made in another tab, which moved a meal typed
 * here for Hippos over to Gators when a second tab started a meal for Gators.
 */
let current: LoggingFor | null = null;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function snapshot(): LoggingFor {
  if (current === null) {
    current = "hippos";
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (CHOICES.includes(stored as LoggingFor)) current = stored as LoggingFor;
    } catch {
      // Private browsing can refuse storage; the choice still holds this visit.
    }
  }
  return current;
}

/** The server cannot know a phone's choice. The journal has always opened on Hippos. */
const serverSnapshot = (): LoggingFor => "hippos";

/**
 * Who this tab logs for: Hippos, Gators, or both. Each of you carries your
 * own phone, so it is kept on the phone rather than in the shared settings.
 * The phone opens on whoever it last logged for, and each tab then keeps its
 * own choice, so two tabs can log for two athletes at once.
 */
export function useLoggingFor() {
  const who = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const setWho = useCallback((next: LoggingFor) => {
    current = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Kept in memory above instead.
    }
    for (const listener of listeners) listener();
  }, []);
  return [who, setWho] as const;
}
