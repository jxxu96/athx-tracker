"use client";

import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { CLAIM_WAIT_MS, claimDraft, releaseDraft } from "@/lib/draft-locks";
import { latestDraft, type Draft } from "@/lib/drafts";

/**
 * Holds a form's draft for this tab while the form is mounted, so no other
 * tab opens it meanwhile. A draft from Drafts opens only once it is held,
 * and as storage has it by then: the tab that had it may have written to it
 * while this one waited. When another tab keeps it, or it is gone, onRefused
 * says so and the form never draws. A new form's draft is a fresh id nobody
 * else can have, so that form draws at once.
 */
export function HeldDraft({
  id,
  draft,
  onOpened,
  onRefused,
  children,
}: {
  id: string;
  /** The draft the form opens with, if it opens with one. */
  draft: Draft | null;
  /** The draft as it opens, just before the form draws. */
  onOpened?: (draft: Draft) => void;
  /** It did not open: held true when this tab got it, but it was gone by then. */
  onRefused: (held: boolean) => void;
  children: (draft: Draft | null) => ReactNode;
}) {
  const [opened, setOpened] = useState<{ draft: Draft | null } | null>(draft ? null : { draft: null });
  const opening = useEffectEvent((held: boolean) => {
    if (!draft) return;
    const latest = held ? latestDraft(id) : null;
    if (!latest) return onRefused(held);
    onOpened?.(latest);
    setOpened({ draft: latest });
  });

  useEffect(() => {
    let mounted = true;
    // Waited for even when new: a form remounted in place gets back the
    // draft it let go of a moment ago.
    void claimDraft(id, CLAIM_WAIT_MS).then((held) => {
      if (mounted) opening(held);
    });
    return () => {
      mounted = false;
      releaseDraft(id);
    };
  }, [id]);

  return opened ? children(opened.draft) : null;
}
