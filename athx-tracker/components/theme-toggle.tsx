"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Preference = "light" | "dark";

const STORAGE_KEY = "athx-theme";
const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const satisfies readonly {
  value: Preference;
  label: string;
  Icon: typeof Sun;
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
    // An older "system" choice followed the device. That option is gone, so it
    // is dark, the same as never having chosen.
    return stored === "light" ? "light" : "dark";
  } catch {
    // Private browsing can refuse storage. Dark is still the default.
    return "dark";
  }
}

/** The server cannot know a stored choice. Dark is what a first visit gets. */
const serverPreference = (): Preference => "dark";

/**
 * The page background of each theme, which the browser's own bar and the
 * phone's status bar take too. Kept in step with --background in globals.css
 * and with the script in the layout that sets it before anything paints.
 */
const THEME_COLOR: Record<Preference, string> = { light: "#ffffff", dark: "#0a0a0a" };

/** Writes the theme where the stylesheet and the browser's bar can see it. */
function applyTheme(preference: Preference) {
  document.documentElement.dataset.theme = preference;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[preference]);
}

/**
 * Outside the component: it touches the document and localStorage and nothing
 * in React's world, and a component is the wrong place to own either.
 */
function choose(next: Preference) {
  applyTheme(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembering it is survivable; the page is still themed.
  }
  listeners.forEach((listener) => listener());
}

/**
 * The stored choice, applied to the page whenever it changes, here or in
 * another tab. Mounted for the whole app by ThemeSync, not only where the
 * buttons are: the buttons live in Setup now, and a second tab that had never
 * opened Setup kept its old theme while the first one switched.
 */
function useThemePreference() {
  const preference = useSyncExternalStore(
    subscribe,
    storedPreference,
    serverPreference,
  );

  // The subscription moves the button when another tab changes the choice, but
  // nothing applied it here, so the control claimed dark while the page stayed
  // light. Read storage rather than the hook value: the server snapshot is
  // dark, and applying that would paint over a stored light choice for a frame.
  // choose has already applied a click, so this is a no-op then.
  useEffect(() => {
    applyTheme(storedPreference());
  }, [preference]);

  return preference;
}

/** Keeps the page in the chosen theme from anywhere in the app. Draws nothing. */
export function ThemeSync() {
  useThemePreference();
  return null;
}

export function ThemeToggle() {
  const preference = useThemePreference();

  // Both choices are visible and named, so which one is on does not have to
  // be read off an icon. It lives in Setup now, where there is room for words.
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
          // Words, unlike the icons these used to be, have to hold 4.5:1 on the
          // grey track; the muted ink managed 4.35 in the light theme.
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
