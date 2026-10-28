import { useCallback, useEffect, useRef, useState } from "react";
import { newId } from "@/lib/client";
import { changeDrafts, dropDraft, keepDraft, type Draft, type DraftKind, type DraftWho } from "@/lib/drafts";

/**
 * Keeps a form's fields as a draft on this phone as they change. snapshot is
 * the form's fields as JSON, and the form passes it every render.
 *
 * A new form keeps nothing until something is typed, and keeps no draft once
 * it is back to how it opened, so an untouched form never clutters Drafts.
 * A form opened from a draft writes it again only once it is changed. finish
 * stops the writing for good, and drops the draft when the work is saved or
 * thrown away; a form set aside leaves its draft in Drafts.
 */
export function useFormDraft({
  kind,
  draft,
  editing,
  who,
  snapshot,
  summary,
  detail,
}: {
  kind: DraftKind;
  draft: Draft | null | undefined;
  editing: Draft["editing"];
  who: DraftWho;
  snapshot: string;
  summary: string;
  detail: string;
}) {
  const [draftId] = useState(() => draft?.id ?? newId());
  const [opened] = useState(snapshot);
  const touched = useRef(false);
  const finished = useRef(false);

  useEffect(() => {
    if (finished.current) return;
    if (snapshot !== opened) touched.current = true;
    if (!touched.current) return;
    if (snapshot === opened && !draft) {
      changeDrafts((book) => dropDraft(book, draftId));
      return;
    }
    changeDrafts((book) =>
      keepDraft(book, {
        id: draftId,
        kind,
        editing,
        who,
        summary,
        detail,
        updatedAt: Date.now(),
        state: JSON.parse(snapshot) as Record<string, unknown>,
      }),
    );
  }, [detail, draft, draftId, editing, kind, opened, snapshot, summary, who]);

  const finish = useCallback(
    (discard: boolean) => {
      finished.current = true;
      if (discard) changeDrafts((book) => dropDraft(book, draftId));
    },
    [draftId],
  );

  return { dirty: snapshot !== opened, finish };
}
