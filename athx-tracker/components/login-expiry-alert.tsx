"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/client";
import {
  LOGIN_EARLY_BY,
  LOGIN_STORAGE_KEY,
  dueWarning,
  readDismissal,
  readExpiry,
  showWarning,
  timeLeft,
  writeDismissal,
  type LoginDismissal,
} from "@/lib/login-expiry";

// Asked on open, every hour while open, and on coming back to the tab, but
// not more than once in ten minutes: each ask reaches the estimator.
const EVERY_MS = 60 * 60_000;
const AT_MOST_MS = 10 * 60_000;

const when = (time: number) =>
  new Date(time).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * A popup 7 days, 3 days, 2 days, 1 day and 12 hours before the estimator's
 * Claude sign-in runs out. One click sends each one away on this phone; the
 * next comes back on its own.
 */
export function LoginExpiryAlert() {
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [dismissed, setDismissed] = useState<LoginDismissal | null>(() => readDismissal());

  useEffect(() => {
    let alive = true;
    let askedAt = -Infinity;
    const check = async () => {
      if (Date.now() - askedAt < AT_MOST_MS) return;
      askedAt = Date.now();
      try {
        const body = await api<{ claudeLoginExpiresAt?: unknown }>("/api/estimator-login");
        if (!alive) return;
        setExpiresAt(readExpiry(body?.claudeLoginExpiresAt));
        setNow(Date.now());
      } catch {
        // Offline or signed out: no warning now, and the next ask tries again.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), EVERY_MS);
    const back = () => {
      if (document.visibilityState === "visible") void check();
    };
    // Sent away in another tab is sent away here too.
    const synced = (event: StorageEvent) => {
      if (event.key === LOGIN_STORAGE_KEY) setDismissed(readDismissal());
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("storage", synced);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("storage", synced);
    };
  }, []);

  const open = showWarning(expiresAt, now, dismissed);
  if (!expiresAt) return null;
  const end = Date.parse(expiresAt);
  const left = timeLeft(expiresAt, now);
  const dismiss = () => {
    const next = { expiresAt, warning: dueWarning(expiresAt, now) };
    writeDismissal(next);
    setDismissed(next);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="gap-4">
        <DialogHeader className="pr-6 text-left">
          <DialogTitle>
            {left ? `Claude's sign-in ends ${left}` : "Claude's sign-in may have ended"}
          </DialogTitle>
          <DialogDescription>
            By Claude&apos;s own reckoning, the estimator&apos;s login reaches its time limit
            between {when(end - LOGIN_EARLY_BY)} and {when(end)}. It cannot be renewed: from
            then, Claude stops answering estimates until it is signed in again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>Sign in again where the estimator runs. On the server:</p>
          <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
            docker exec -it athx-estimator claude auth login
          </code>
        </div>
        <DialogFooter>
          <Button onClick={dismiss}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
