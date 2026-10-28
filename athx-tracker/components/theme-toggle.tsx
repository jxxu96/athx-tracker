"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Preference = "system" | "light" | "dark";

const STORAGE_KEY = "athx-theme";
const OPTIONS = [
  { value: "system", label: "Device", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const satisfies readonly {
  value: Preference;
  label: string;
  Icon: typeof Monitor;
}[];

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
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    // No choice yet. Dark is the default, so a first visit does not follow a light device.
    return "dark";
  } catch {
    // Private browsing can refuse storage. Dark is still the default.
    return "dark";
  }
}

/** The server cannot know a stored choice. Dark is what a first visit gets. */
const serverPreference = (): Preference => "dark";

/** What the device is asking for right now, when told to follow it. */
function resolve(preference: Preference) {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Writes the resolved theme where the stylesheet can see it. */
function applyTheme(preference: Preference) {
  document.documentElement.dataset.theme = resolve(preference);
}

/**
 * Outside the component: it touches the document and localStorage and nothing
 * in React's world, and a component is the wrong place to own either.
 */
function choose(next: Preference) {
  applyTheme(next);
  try {
    // Device has to be stored. Removing the key would look like "never chosen",
    // which is dark, and the device choice could not be told apart from it.
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembering it is survivable; the page is still themed.
  }
  listeners.forEach((listener) => listener());
}

export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribe,
    storedPreference,
    serverPreference,
  );

  // The subscription moves the button when another tab changes the choice, but
  // nothing applied it here, so the control claimed dark while the page stayed
  // light. Read storage rather than the hook value: the server snapshot is
  // dark, and applying that would paint over a stored light or device choice
  // for a frame. choose has already applied a click, so this is a no-op then.
  useEffect(() => {
    applyTheme(storedPreference());
  }, [preference]);

  // Only while following the device. A deliberate choice should not move
  // because the phone switched itself over at sunset.
  useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme("system");
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [preference]);

  // Three buttons rather than one that cycles: all the choices are visible, and
  // which one is on does not have to be read off an icon.
  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex shrink-0 rounded-full bg-muted p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          aria-pressed={preference === value}
          aria-label={label}
          title={label}
          className="rounded-full p-1.5 text-muted-foreground transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
