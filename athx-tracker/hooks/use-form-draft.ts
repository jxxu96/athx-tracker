import { useCallback, useEffect, useRef, useState } from "react";
import { newId } from "@/lib/client";
import { changeDrafts, dropDraft, keepDraft, type Draft, type DraftKind, type DraftWho } from "@/lib/drafts";

/**
 * Keeps a form's fields as a draft on this phone as they change. snapshot is
 * the form's fields as JSON, and the form passes it every render.
 *
 * A new form keeps nothing until something is typed, and keeps no draft once
 * it is back to how it opened, so an untouched form never clutters Drafts.
 * A form opened from a draft writes it again only once it is changed, or the
 * athlete it is for is. finish stops the writing for good, and drops the
 * draft when the work is saved or thrown away; a form set aside leaves its
 * draft in Drafts.
 *
 * A meal set aside while it estimates stays mounted, out of sight, and keeps
 * writing: shown false leaves the form on screen as the one open, and its
 * draft is kept even untouched, as an edit nobody has typed in yet would
 * not be, so that Drafts can list it while it estimates.
 */
export function useFormDraft({
  kind,
  draftId: assigned,
  draft,
  editing,
  who,
  snapshot,
  summary,
  detail,
  shown = true,
}: {
  kind: DraftKind;
  /** The draft this form writes, when whoever opened the form chose it. */
  draftId?: string;
  draft: Draft | null | undefined;
  editing: Draft["editing"];
  who: DraftWho;
  snapshot: string;
  summary: string;
  detail: string;
  shown?: boolean;
}) {
  const [draftId] = useState(() => assigned ?? draft?.id ?? newId());
  const [opened] = useState(snapshot);
  const touched = useRef(false);
  const finished = useRef(false);

  useEffect(() => {
    if (finished.current) return;
    if (snapshot !== opened) touched.current = true;
    // Who it is for lives outside the fields, and a draft opened here follows
    // a change of it too. A new form does not: switching athlete is not typing.
    if (draft && who !== draft.who) touched.current = true;
    const aside = !shown && Boolean(draft || editing);
    if (!touched.current && !aside) return;
    if (snapshot === opened && !draft && !aside) {
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
      }, shown),
    );
  }, [detail, draft, draftId, editing, kind, opened, shown, snapshot, summary, who]);

  const finish = useCallback(
    (discard: boolean) => {
      finished.current = true;
      if (discard) changeDrafts((book) => dropDraft(book, draftId));
    },
    [draftId],
  );

  return { dirty: snapshot !== opened, finish };
}
