"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Preference = "system" | "light" | "dark";

const STORAGE_KEY = "athx-theme";
const ORDER: Preference[] = ["system", "light", "dark"];
const ICONS = { system: Monitor, light: Sun, dark: Moon };
const NAMES = {
  system: "following your device",
  light: "light",
  dark: "dark",
} as const;

/**
 * The preference lives in localStorage rather than in React, because the script
 * in the document already read it before this component existed. Subscribing to
 * it keeps the button honest without copying it into state.
 */
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  // Another tab changing it should move this one too.
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function storedPreference(): Preference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private browsing can refuse storage. The device setting still applies.
    return "system";
  }
}

/** The server cannot know the choice, so it renders the neutral one. */
const serverPreference = (): Preference => "system";

/** What the device is asking for right now, when told to follow it. */
function resolve(preference: Preference) {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribe,
    storedPreference,
    serverPreference,
  );

  // Only while following the device. A deliberate choice should not move
  // because the phone switched itself over at sunset.
  useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      document.documentElement.dataset.theme = resolve("system");
    };
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [preference]);

  function choose(next: Preference) {
    document.documentElement.dataset.theme = resolve(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembering it is survivable; the page is still themed.
    }
    listeners.forEach((listener) => listener());
  }

  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];
  const Icon = ICONS[preference];
  const label = `Theme: ${NAMES[preference]}. Switch to ${NAMES[next]}.`;

  return (
    <button
      type="button"
      onClick={() => choose(next)}
      aria-label={label}
      title={label}
      className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-4" />
    </button>
  );
}
