"use client";

import { useState } from "react";
import { CloudOff, Pencil, Scale, Soup, Trash2, Weight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DayButtons, Field } from "@/components/workout-form";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  ATHLETES,
  ESTIMATORS,
  categoryName,
  completionLine,
  distanceLine,
  estimateBurn,
  formatLift,
  formatTimeOrDash,
  formatWeight,
  isClockTime,
  parseLoad,
  displayLoad,
  scenarioLine,
  type Athlete,
  type Bodyweight,
  type RecordItem,
  type WeightUnit,
  type Workout,
} from "@/lib/domain";
import { bodyweightOn, type BodyweightHistory } from "@/lib/bodyweight";
import { formatDay, isWeighIn, isWorkout } from "@/lib/client";
import type { OutboxEntry } from "@/lib/outbox";

/** Entries drawn at once. More arrive on request, rather than all at once. */
const PAGE = 100;

/**
 * A weigh-in edited where it stands. The weight, the day and the time are all
 * there is to it, so it needs no form of its own.
 */
function WeighInEditor({
  record,
  today,
  unit,
  onSave,
  onCancel,
}: {
  record: Bodyweight;
  today: string;
  unit: WeightUnit;
  onSave: (record: Bodyweight) => Promise<void>;
  onCancel: () => void;
}) {
  const [weight, setWeight] = useState(displayLoad(record.kg, unit));
  const [day, setDay] = useState(record.day);
  const [time, setTime] = useState(record.time ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const kg = parseLoad(weight, unit, record.kg);
    if (kg === null || kg > 500) return setError(`Write the bodyweight in ${unit}.`);
    if (time !== "" && !isClockTime(time)) return setError("Write the time as HH:MM, or leave it empty.");
    setSaving(true);
    try {
      await onSave({
        id: record.id,
        kind: "bodyweight",
        athlete: record.athlete,
        day,
        ...(time ? { time } : {}),
        kg,
      });
      onCancel();
    } catch {
      setError("That did not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label={`Bodyweight (${unit})`}>
        <Input value={weight} inputMode="decimal" onChange={(event) => setWeight(event.target.value)} />
      </Field>
      <DayButtons today={today} day={day} onChange={setDay} time={time} onTimeChange={setTime} />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-1.5">
        <Button type="button" size="xs" disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving…" : "Save weigh-in"}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The time of day, then the rest of an entry's line. */
const at = (record: RecordItem) => (record.time ? `${record.time} · ` : "");

export function History({
  records,
  today,
  athlete,
  weightUnit,
  history,
  outbox = [],
  total,
  loadingAll,
  onLoadAll,
  onSendNow,
  onEdit,
  onUpdate,
  onDelete,
}: {
  records: RecordItem[];
  today: string;
  athlete: Athlete | "all";
  weightUnit: WeightUnit;
  /** Each session burns at the weight of its own day. */
  history: BodyweightHistory;
  /** What this phone has not sent yet. */
  outbox?: OutboxEntry[];
  /** Entries in the journal, which is not always how many are loaded. */
  total: number;
  loadingAll: boolean;
  /** Undefined once everything is in hand, so the offer disappears. */
  onLoadAll?: () => void;
  onSendNow?: () => void;
  onEdit: (record: RecordItem) => void;
  onUpdate?: (record: Bodyweight) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  /** Null when the session has no time, or no weight is known for its day. */
  const burnedFor = (workout: Workout) =>
    workout.athlete === "team"
      ? null
      : estimateBurn(workout, bodyweightOn(history, workout.athlete, workout.day));
  const waitingFor = (id: string) =>
    outbox.find((entry) => entry.op === "save" && entry.record.id === id);

  const [kind, setKind] = useState<"all" | "workout" | "meal" | "bodyweight">("all");
  const [editing, setEditing] = useState("");
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
      {outbox.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 p-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CloudOff className="size-3.5 shrink-0" aria-hidden="true" />
            {outbox.length} change{outbox.length === 1 ? "" : "s"} on this phone waiting to send.
            {outbox.some((entry) => entry.error) ? " The server turned one down: edit or delete it." : ""}
          </p>
          {onSendNow ? (
            <Button type="button" variant="outline" size="xs" onClick={onSendNow}>
              Send now
            </Button>
          ) : null}
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
              setKind(event.target.value as "all" | "workout" | "meal" | "bodyweight");
              // A new filter is a new list; starting it part-scrolled would be
              // showing the middle of something nobody has seen the top of.
              setShown(PAGE);
            }}
          >
            <NativeSelectOption value="all">Everything</NativeSelectOption>
            <NativeSelectOption value="workout">Sessions</NativeSelectOption>
            <NativeSelectOption value="meal">Meals</NativeSelectOption>
            <NativeSelectOption value="bodyweight">Weigh-ins</NativeSelectOption>
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
                .map((record) => {
                  const finish = isWorkout(record) ? scenarioLine(record) : null;
                  return (
                  <li key={record.id} className="flex items-start gap-3 p-4">
                    {isWorkout(record) ? (
                      <Weight
                        className="mt-0.5 size-4 shrink-0"
                        style={{ color: ATHLETES[record.athlete].color }}
                        aria-hidden="true"
                      />
                    ) : isWeighIn(record) ? (
                      <Scale
                        className="mt-0.5 size-4 shrink-0"
                        style={{ color: ATHLETES[record.athlete].color }}
                        aria-hidden="true"
                      />
                    ) : (
                      <Soup
                        className="mt-0.5 size-4 shrink-0"
                        style={{ color: ATHLETES[record.athlete].color }}
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      {isWeighIn(record) && editing === record.id && onUpdate ? (
                        <WeighInEditor
                          record={record}
                          today={today}
                          unit={weightUnit}
                          onSave={onUpdate}
                          onCancel={() => setEditing("")}
                        />
                      ) : isWeighIn(record) ? (
                        <>
                          <p className="truncate text-sm font-medium">
                            Bodyweight {formatWeight(record.kg, weightUnit)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {at(record)}
                            {ATHLETES[record.athlete].name} · weigh-in
                          </p>
                        </>
                      ) : isWorkout(record) ? (
                        <>
                          <p className="truncate text-sm font-medium">
                            {record.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {at(record)}
                            {ATHLETES[record.athlete].name} · {categoryName(record)} ·{" "}
                            {formatTimeOrDash(record.seconds)}
                            {record.goal
                              ? ` · goal ${formatTimeOrDash(record.goal)}`
                              : ""}
                            {burnedFor(record) !== null
                              ? ` · ~${burnedFor(record)} kcal`
                              : ""}
                          </p>
                          {finish ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {finish}
                            </p>
                          ) : null}
                          {record.segments.length > 0 ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {record.segments.length} station
                              {record.segments.length === 1 ? "" : "s"} ·{" "}
                              {record.context === "pairs" ? "Pairs" : "Solo"}
                            </p>
                          ) : null}
                          {distanceLine(record) ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {distanceLine(record)}
                            </p>
                          ) : null}
                          {completionLine(record) ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {completionLine(record)}
                            </p>
                          ) : null}
                          {record.segments.some((segment) => segment.kg) ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {record.segments
                                .filter((segment) => segment.kg)
                                .map(
                                  (segment) =>
                                    `${segment.name} ${formatWeight(segment.kg ?? 0, weightUnit)}`,
                                )
                                .join(" · ")}
                            </p>
                          ) : null}
                          {record.lifts.length > 0 ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {record.lifts
                                .map((lift) => formatLift(lift, weightUnit))
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
                            {at(record)}
                            {ATHLETES[record.athlete].name} · {record.meal} ·{" "}
                            {Math.round(record.macros.calories)} kcal
                          </p>
                          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                            P {Math.round(record.macros.protein)} · C{" "}
                            {Math.round(record.macros.carbs)} · F{" "}
                            {Math.round(record.macros.fat)}
                            {record.macros.fiber
                              ? ` · Fiber ${Math.round(record.macros.fiber)} g`
                              : ""}
                            {record.meal === "Alcohol"
                              ? ` · Ethanol ${Math.round(record.macros.alcohol ?? 0)} g`
                              : ""}
                            {record.source === "grok"
                              ? record.estimator
                                ? ` · ${ESTIMATORS[record.estimator]}`
                                : " · estimated"
                              : ""}
                            {record.source === "queued"
                              ? " · estimate pending"
                              : ""}
                          </p>
                        </>
                      )}
                      {waitingFor(record.id) ? (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CloudOff className="size-3 shrink-0" aria-hidden="true" />
                          {waitingFor(record.id)?.error
                            ? `Not saved: ${waitingFor(record.id)?.error}`
                            : "Waiting to send"}
                        </p>
                      ) : null}
                    </div>
                    {editing === record.id ? null : pending === record.id ? (
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
                          onClick={() => (isWeighIn(record) ? setEditing(record.id) : onEdit(record))}
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
                  );
                })}
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
