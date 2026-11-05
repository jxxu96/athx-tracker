import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

const DESKTOP = "(any-hover: hover) and (any-pointer: fine)";
const STORAGE_KEY = "athx-keyboard-shortcuts";
const SETTING_CHANGED = "athx-keyboard-shortcuts-changed";
const EDITABLE = 'input, textarea, select, [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"]';
const OPEN_MENU = 'dialog[open], :is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])[data-state="open"]';

type ShortcutSetting = "on" | "off" | "unavailable";
let fallbackEnabled = true;

function readSetting(): ShortcutSetting {
  if (!window.matchMedia(DESKTOP).matches) return "unavailable";
  try {
    return localStorage.getItem(STORAGE_KEY) === "off" ? "off" : "on";
  } catch {
    return fallbackEnabled ? "on" : "off";
  }
}

function subscribe(onChange: () => void) {
  const desktop = window.matchMedia(DESKTOP);
  desktop.addEventListener("change", onChange);
  window.addEventListener(SETTING_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    desktop.removeEventListener("change", onChange);
    window.removeEventListener(SETTING_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const serverSetting = (): ShortcutSetting => "unavailable";

export function useKeyboardShortcutSetting() {
  return useSyncExternalStore(subscribe, readSetting, serverSetting);
}

export function setKeyboardShortcutsEnabled(enabled: boolean) {
  fallbackEnabled = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // The toggle still works for this visit if storage is unavailable.
  }
  window.dispatchEvent(new Event(SETTING_CHANGED));
}

export function useKeyboardShortcuts<T>(
  enabled: boolean,
  shortcuts: Partial<Record<string, T>>,
  activate: (shortcut: T) => void,
) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented || event.repeat || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.key.length !== 1
    ) return;

    const shortcut = shortcuts[event.key.toLowerCase()];
    if (shortcut === undefined) return;

    const target = event.target;
    if (target instanceof Element && target.closest(EDITABLE)) return;
    if (target instanceof HTMLElement && target.isContentEditable) return;
    if (document.querySelector(OPEN_MENU)) return;

    event.preventDefault();
    activate(shortcut);
  });

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [enabled]);
}
