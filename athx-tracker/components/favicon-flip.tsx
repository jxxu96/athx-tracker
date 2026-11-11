"use client";

import { useEffect } from "react";

/**
 * The browser tab's icon: the hippo, then the gator, five seconds each. Both
 * are drawn by scripts/make-icons.mjs. A home screen icon is fixed once it is
 * installed, so that one stays the hippo.
 */
export const FAVICONS = ["/favicon.svg", "/favicon-gator.svg"] as const;
export const FAVICON_EVERY_MS = 5_000;

export function FaviconFlip() {
  useEffect(() => {
    let shown = 0;
    const timer = window.setInterval(() => {
      shown = (shown + 1) % FAVICONS.length;
      // Looked up every time, not once: a navigation can put fresh tags in
      // the head, and those would otherwise keep the hippo.
      for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')) {
        link.href = FAVICONS[shown];
      }
    }, FAVICON_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}
