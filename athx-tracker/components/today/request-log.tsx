"use client";

import { useId, useState } from "react";
import { Lightbulb, Trash2 } from "lucide-react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REQUEST_TEXT_LIMIT, clockTime, type FeatureRequest, type RecordItem } from "@/lib/domain";
import { formatDay, isRequest, newId, sortRecords } from "@/lib/client";

function RequestList({
  items,
  today,
  busy,
  pending,
  onPending,
  onMark,
  onDelete,
}: {
  items: FeatureRequest[];
  today: string;
  busy: string;
  pending: string;
  onPending: (id: string) => void;
  onMark: (record: FeatureRequest, finished: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <ul className="divide-y">
      {items.map((record) => (
        <li key={record.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className={`whitespace-pre-wrap text-sm ${record.done ? "text-muted-foreground line-through" : ""}`}>
              {record.text}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatDay(record.day, today)}
              {record.time ? ` · ${record.time}` : ""}
            </p>
          </div>
          {pending === record.id ? (
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                size="xs"
                variant="destructive"
                disabled={busy === record.id}
                onClick={() => onDelete(record.id)}
              >
                {busy === record.id ? "…" : "Delete"}
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => onPending("")}>
                Keep
              </Button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy === record.id}
                aria-label={record.done ? `Reopen: ${record.text}` : `Mark done: ${record.text}`}
                onClick={() => onMark(record, !record.done)}
              >
                {record.done ? "Reopen" : "Done"}
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="text-muted-foreground"
                aria-label={`Delete: ${record.text}`}
                onClick={() => onPending(record.id)}
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Features and ideas, at the bottom of Today. Shared, because the journal is,
 * and kept as entries so a phone that only holds the recent slice still has
 * every one of them.
 */
export function RequestLog({
  records,
  today,
  onSave,
  onDelete,
}: {
  records: RecordItem[];
  today: string;
  onSave: (record: FeatureRequest) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState("");
  const requests = sortRecords(records.filter(isRequest));
  const open = requests.filter((record) => !record.done);
  const done = requests.filter((record) => record.done);
  const text = draft.trim();
  const mini = open.length ? `${open.length} open` : done.length ? "All done" : "Nothing yet";

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!text || busy) return;
    setBusy("add");
    try {
      await onSave({
        id: newId(),
        kind: "request",
        athlete: "team",
        day: today,
        time: clockTime(),
        text,
      });
      setDraft("");
    } catch {
      // The tracker has already said why. What was typed stays.
    } finally {
      setBusy("");
    }
  }

  async function mark(record: FeatureRequest, finished: boolean) {
    setBusy(record.id);
    try {
      const next: FeatureRequest = { ...record };
      if (finished) next.done = true;
      else delete next.done;
      await onSave(next);
    } catch {
      // Left as it was.
    } finally {
      setBusy("");
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await onDelete(id);
      setPending("");
    } catch {
      // Still listed.
    } finally {
      setBusy("");
    }
  }

  return (
    <CollapsibleCard
      name="Requests"
      className="p-4 sm:p-5"
      mini={mini}
      heading={
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold group-data-[collapsed]:mb-0">
          <Lightbulb className="size-4 text-muted-foreground" />
          Requests
        </h2>
      }
    >
      <form onSubmit={add} className="space-y-3">
        <div>
          <Label htmlFor={fieldId} className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Request
          </Label>
          <Textarea
            id={fieldId}
            value={draft}
            maxLength={REQUEST_TEXT_LIMIT}
            rows={3}
            placeholder="A feature or an idea"
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {draft.length}/{REQUEST_TEXT_LIMIT}
          </p>
        </div>
        <Button type="submit" size="sm" disabled={busy !== "" || text.length === 0}>
          {busy === "add" ? "Adding…" : "Add request"}
        </Button>
      </form>

      {requests.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">Nothing asked for yet.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {open.length ? (
            <RequestList
              items={open}
              today={today}
              busy={busy}
              pending={pending}
              onPending={setPending}
              onMark={mark}
              onDelete={remove}
            />
          ) : null}
          {done.length ? (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground">Done</h3>
              <RequestList
                items={done}
                today={today}
                busy={busy}
                pending={pending}
                onPending={setPending}
                onMark={mark}
                onDelete={remove}
              />
            </div>
          ) : null}
        </div>
      )}
    </CollapsibleCard>
  );
}
