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
  formatTimeOrDash,
  formatWeight,
  type Athlete,
  type RecordItem,
  type WeightUnit,
} from "@/lib/domain";
import { formatDay, isWorkout } from "@/lib/client";

export function History({
  records,
  today,
  athlete,
  weightUnit,
  onEdit,
  onDelete,
}: {
  records: RecordItem[];
  today: string;
  athlete: Athlete | "all";
  weightUnit: WeightUnit;
  onEdit: (record: RecordItem) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<"all" | "workout" | "meal">("all");
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState("");

  const visible = records.filter(
    (record) =>
      (athlete === "all" || record.athlete === athlete) &&
      (kind === "all" || record.kind === kind),
  );

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
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {visible.length} entr{visible.length === 1 ? "y" : "ies"}
        </p>
        <div className="[&>div]:w-auto">
          <NativeSelect
            size="sm"
            value={kind}
            aria-label="Filter by entry type"
            onChange={(event) =>
              setKind(event.target.value as "all" | "workout" | "meal")
            }
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
                            {ATHLETES[record.athlete].name} · {record.category} ·{" "}
                            {formatTimeOrDash(record.seconds)}
                            {record.goal
                              ? ` · goal ${formatTimeOrDash(record.goal)}`
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
    </div>
  );
}
