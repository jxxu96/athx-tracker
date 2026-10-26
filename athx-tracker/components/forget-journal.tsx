"use client";

import { useEffect } from "react";

/**
 * Signed out, the copy of the journal kept for opening it offline is a
 * journal left on a phone, so it goes. Entries still waiting to send stay,
 * and send after the next sign-in.
 */
export function ForgetJournal() {
  useEffect(() => {
    if (typeof caches === "undefined") return;
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("athx-")).map((key) => caches.delete(key))),
      )
      .catch(() => {});
  }, []);
  return null;
}
