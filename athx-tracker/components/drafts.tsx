"use client";

import { useState, useSyncExternalStore } from "react";
import { FilePen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATHLETES, clockTime, localDay } from "@/lib/domain";
import { formatDay } from "@/lib/client";
import {
  changeDrafts,
  draftsSnapshot,
  dropDraft,
  listedDrafts,
  serverDrafts,
  subscribeDrafts,
  type Draft,
  type DraftKind,
} from "@/lib/drafts";
import { draftsElsewhere, noDraftsElsewhere, subscribeElsewhere } from "@/lib/draft-locks";

const whoName = (who: Draft["who"]) => (who === "both" ? "Both" : ATHLETES[who].name);

/** When a draft was last typed into: "Today 12:41", "Mon 26 Oct 07:30". */
function lastTyped(updatedAt: number, today: string) {
  const at = new Date(updatedAt);
  return `${formatDay(localDay(at), today)} ${clockTime(at)}`;
}

/**
 * Meals or sessions typed and set aside, newest first, for the form above.
 * The one on this tab's form is not listed; tapping another opens it there,
 * and the one that was open joins this list. A meal set aside mid-estimate
 * says it is still estimating, and one on a form in another tab says so,
 * since opening it here would have two tabs typing into one draft.
 */
export function Drafts({
  kind,
  today,
  shown,
  estimating,
  onOpen,
}: {
  kind: DraftKind;
  today: string;
  /** The draft on this tab's form. */
  shown: string | null;
  /** Drafts set aside in this tab that are still estimating. */
  estimating?: ReadonlySet<string>;
  onOpen: (draft: Draft) => void;
}) {
  const book = useSyncExternalStore(subscribeDrafts, draftsSnapshot, serverDrafts);
  const elsewhere = useSyncExternalStore(subscribeElsewhere, draftsElsewhere, noDraftsElsewhere);
  const drafts = listedDrafts(book, kind, shown);
  const [confirming, setConfirming] = useState("");
  if (!drafts.length) return null;
  const heading = `${kind}-drafts`;

  return (
    <section aria-labelledby={heading} className="mb-4 rounded-2xl border bg-card p-4 sm:p-5">
      <h2 id={heading} className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <FilePen className="size-4 text-muted-foreground" />
        Drafts
      </h2>
      <ul className="divide-y">
        {drafts.map((draft) => {
          const working = estimating?.has(draft.id) ?? false;
          const away = !working && elsewhere.has(draft.id);
          const status = working ? "Estimating…" : away ? "Open in another tab" : "";
          return (
            <li key={draft.id} className="flex items-center gap-2 py-2.5">
              <button
                type="button"
                onClick={() => onOpen(draft)}
                aria-label={`Open draft: ${draft.editing ? "editing " : ""}${draft.summary}`}
                aria-describedby={status ? `draft-status-${draft.id}` : undefined}
                className="min-w-0 flex-1 rounded-lg text-left transition-colors hover:bg-muted/50"
              >
                <span className="block truncate text-sm font-medium">
                  {draft.editing ? `Editing ${draft.summary}` : draft.summary}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {whoName(draft.who)} · {draft.detail} · {lastTyped(draft.updatedAt, today)}
                </span>
                {status ? (
                  <span id={`draft-status-${draft.id}`} className="block text-xs font-medium">
                    {status}
                  </span>
                ) : null}
              </button>
              {/* Not while it estimates, or while another tab has it open:
                  that form would write it straight back. */}
              {status ? null : confirming === draft.id ? (
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    onClick={() => {
                      changeDrafts((current) => dropDraft(current, draft.id));
                      setConfirming("");
                    }}
                  >
                    Delete
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming("")}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground"
                  aria-label={`Delete draft: ${draft.summary}`}
                  onClick={() => setConfirming(draft.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
