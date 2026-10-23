"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  ATHLETES,
  categoryName,
  estimateBurn,
  formatTimeOrDash,
  formatWeight,
  type Athlete,
  type RecordItem,
  type Settings,
  type WeightUnit,
  type Workout,
} from "@/lib/domain";
import { formatDay, isWorkout } from "@/lib/client";

/** Entries drawn at once. More arrive on request, rather than all at once. */
const PAGE = 100;

export function History({
  records,
  today,
  athlete,
  weightUnit,
  bodyweight,
  total,
  loadingAll,
  onLoadAll,
  onEdit,
  onDelete,
}: {
  records: RecordItem[];
  today: string;
  athlete: Athlete | "all";
  weightUnit: WeightUnit;
  bodyweight: Settings["bodyweight"];
  /** Entries in the journal, which is not always how many are loaded. */
  total: number;
  loadingAll: boolean;
  /** Undefined once everything is in hand, so the offer disappears. */
  onLoadAll?: () => void;
  onEdit: (record: RecordItem) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  /** Null when the session has no time, or that athlete has no bodyweight. */
  const burnedFor = (workout: Workout) =>
    workout.athlete === "team"
      ? null
      : estimateBurn(workout, bodyweight[workout.athlete]);

  const [kind, setKind] = useState<"all" | "workout" | "meal">("all");
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState("");
  const [shown, setShown] = useState(PAGE);

  const matching = records.filter(
    (record) =>
      (athlete === "all" || record.athlete === athlete) &&
      (kind === "all" || record.kind === kind),
  );

  // Each entry is about twenty elements, so the whole journal on screen at once
  // is tens of thousands of them: enough to make a phone stutter now and to
  // stop it responding by the time there are years of them. What is loaded and
  // what is drawn are separate questions, and this answers the second.
  const visible = matching.slice(0, shown);
  const days = [...new Set(visible.map((record) => record.day))];

  async function remove(id: string) {
    setBusy(id);
    try {
      await onDelete(id);
      setPending("");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4 pb-4">
      {onLoadAll && total > records.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 p-3">
          <p className="text-xs text-muted-foreground">
            Showing the most recent {records.length} of {total} entries.
          </p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={loadingAll}
            onClick={onLoadAll}
          >
            {loadingAll ? "Loading…" : "Load all"}
          </Button>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {matching.length} entr{matching.length === 1 ? "y" : "ies"}
        </p>
        <div className="[&>div]:w-auto">
          <NativeSelect
            size="sm"
            value={kind}
            aria-label="Filter by entry type"
            onChange={(event) => {
              setKind(event.target.value as "all" | "workout" | "meal");
              // A new filter is a new list; starting it part-scrolled would be
              // showing the middle of something nobody has seen the top of.
              setShown(PAGE);
            }}
          >
            <NativeSelectOption value="all">Everything</NativeSelectOption>
            <NativeSelectOption value="workout">Sessions</NativeSelectOption>
            <NativeSelectOption value="meal">Meals</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>

      {days.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Nothing logged here yet.
        </p>
      ) : (
        days.map((day) => (
          <section key={day} className="rounded-2xl border bg-card">
            <h3 className="border-b px-4 py-2.5 text-xs font-semibold text-muted-foreground">
              {formatDay(day, today)}
            </h3>
            <ul className="divide-y">
              {visible
                .filter((record) => record.day === day)
                .map((record) => (
                  <li key={record.id} className="flex items-start gap-3 p-4">
                    <span
                      className="mt-1.5 size-2.5 shrink-0 rounded-full"
                      style={{ background: ATHLETES[record.athlete].color }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      {isWorkout(record) ? (
                        <>
                          <p className="truncate text-sm font-medium">
                            {record.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {ATHLETES[record.athlete].name} · {categoryName(record)} ·{" "}
                            {formatTimeOrDash(record.seconds)}
                            {record.goal
                              ? ` · goal ${formatTimeOrDash(record.goal)}`
                              : ""}
                            {burnedFor(record) !== null
                              ? ` · ~${burnedFor(record)} kcal`
                              : ""}
                          </p>
                          {record.segments.length > 0 ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {record.segments.length} station
                              {record.segments.length === 1 ? "" : "s"} ·{" "}
                              {record.context === "pairs" ? "Pairs" : "Solo"}
                            </p>
                          ) : null}
                          {record.lifts.length > 0 ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {record.lifts
                                .map(
                                  (lift) =>
                                    `${lift.name} ${formatWeight(lift.kg, weightUnit)} ${lift.sets ?? 1}×${lift.reps}`,
                                )
                                .join(" · ")}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <p className="truncate text-sm font-medium">
                            {record.name}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {ATHLETES[record.athlete].name} · {record.meal} ·{" "}
                            {Math.round(record.macros.calories)} kcal
                          </p>
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            P {Math.round(record.macros.protein)} · C{" "}
                            {Math.round(record.macros.carbs)} · F{" "}
                            {Math.round(record.macros.fat)}
                            {record.source === "grok" ? " · estimated" : ""}
                            {record.source === "queued"
                              ? " · estimate pending"
                              : ""}
                          </p>
                        </>
                      )}
                    </div>
                    {pending === record.id ? (
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          size="xs"
                          variant="destructive"
                          disabled={busy === record.id}
                          onClick={() => remove(record.id)}
                        >
                          {busy === record.id ? "…" : "Delete"}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setPending("")}
                        >
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <div className="flex shrink-0">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          aria-label="Edit entry"
                          onClick={() => onEdit(record)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          aria-label="Delete entry"
                          onClick={() => setPending(record.id)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}

      {matching.length > shown ? (
        <div className="flex flex-col items-center gap-1 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShown((current) => current + PAGE)}
          >
            Show more
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Showing {shown} of {matching.length}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
