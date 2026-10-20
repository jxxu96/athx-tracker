"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { newId } from "@/lib/client";
import {
  ATHLETES,
  METCON,
  formatTime,
  parseTime,
  projectWorkout,
  type Athlete,
  type Segment,
  type Workout,
} from "@/lib/domain";

type SegmentDraft = {
  name: string;
  unit: Segment["unit"];
  completed: string;
  target: string;
  time: string;
};

type LiftDraft = { name: string; kg: string; reps: string };

const CATEGORIES = ["MetCon", "Strength", "Endurance", "Other"] as const;
const UNITS = ["reps", "m", "cal", "rounds"] as const;

const emptySegment = (): SegmentDraft => ({
  name: "",
  unit: "reps",
  completed: "",
  target: "",
  time: "",
});

const metconDrafts = (): SegmentDraft[] =>
  METCON.map((station) => ({
    name: station.name,
    unit: station.unit,
    completed: "",
    target: String(station.target),
    time: "",
  }));

/** Blank means zero, so an untouched station reads as work not performed. */
const num = (value: string) => (value.trim() === "" ? 0 : Number(value));
const seconds = (value: string) => (value.trim() === "" ? 0 : parseTime(value));

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="[&>div]:w-full">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function WorkoutForm({
  athlete,
  today,
  onSave,
}: {
  athlete: Athlete;
  today: string;
  onSave: (record: Workout) => Promise<void>;
}) {
  const [who, setWho] = useState<Athlete>(athlete);
  const [day, setDay] = useState(today);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Workout["category"]>("MetCon");
  const [context, setContext] = useState<Workout["context"]>("pairs");
  const [elapsed, setElapsed] = useState("");
  const [goal, setGoal] = useState("");
  const [fatigue, setFatigue] = useState(10);
  const [transition, setTransition] = useState("");
  const [notes, setNotes] = useState("");
  const [segments, setSegments] = useState<SegmentDraft[]>([]);
  const [lifts, setLifts] = useState<LiftDraft[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const parsedSegments = useMemo<Segment[]>(
    () =>
      segments
        .filter((s) => s.name.trim() !== "")
        .map((s) => ({
          name: s.name.trim(),
          unit: s.unit,
          completed: num(s.completed),
          target: num(s.target),
          seconds: seconds(s.time),
        })),
    [segments],
  );

  const elapsedSeconds = seconds(elapsed);
  const projection = useMemo(
    () =>
      projectWorkout(
        parsedSegments,
        elapsedSeconds,
        fatigue,
        num(transition),
      ),
    [parsedSegments, elapsedSeconds, fatigue, transition],
  );

  const stationTotal = parsedSegments.reduce((total, s) => total + s.seconds, 0);
  const overrun =
    Number.isFinite(elapsedSeconds) &&
    elapsedSeconds > 0 &&
    stationTotal > elapsedSeconds + 1;

  function updateSegment(index: number, patch: Partial<SegmentDraft>) {
    setSegments((current) =>
      current.map((segment, i) => (i === index ? { ...segment, ...patch } : segment)),
    );
  }

  function validate() {
    if (!title.trim()) return "Give the session a title.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Pick a valid date.";
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0)
      return "Enter the elapsed time as mm:ss, for example 24:30.";
    if (elapsedSeconds > 86400) return "That elapsed time is too long.";
    for (const segment of parsedSegments) {
      if (!Number.isFinite(segment.seconds))
        return `Station "${segment.name}": write the split as mm:ss.`;
      if (!(segment.target > 0))
        return `Station "${segment.name}": set a target above zero.`;
      if (segment.completed > segment.target)
        return `Station "${segment.name}": completed work is above the target.`;
      if (segment.completed === 0 && segment.seconds > 0)
        return `Station "${segment.name}": a split needs completed work to go with it.`;
      if (segment.completed > 0 && segment.seconds <= 0)
        return `Station "${segment.name}": measured work needs a split time.`;
    }
    if (overrun) return "Station splits add up to more than the elapsed time.";
    const goalSeconds = goal.trim() === "" ? null : parseTime(goal);
    if (goalSeconds !== null && (!Number.isFinite(goalSeconds) || goalSeconds <= 0))
      return "Write the goal time as mm:ss, or leave it empty.";
    for (const lift of lifts) {
      if (!lift.name.trim()) continue;
      if (!(Number(lift.kg) > 0)) return `Lift "${lift.name}": add the load in kg.`;
      if (!Number.isInteger(Number(lift.reps)) || Number(lift.reps) < 1)
        return `Lift "${lift.name}": add whole reps.`;
    }
    return "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;

    const record: Workout = {
      id: newId(),
      kind: "workout",
      athlete: who,
      day,
      title: title.trim(),
      category,
      seconds: elapsedSeconds,
      notes: notes.trim(),
      segments: parsedSegments,
      fatigue,
      transition: num(transition),
      goal: goal.trim() === "" ? null : parseTime(goal),
      context,
      lifts: lifts
        .filter((lift) => lift.name.trim() !== "")
        .map((lift) => ({
          name: lift.name.trim(),
          kg: Number(lift.kg),
          reps: Number(lift.reps),
        })),
    };

    setSaving(true);
    try {
      await onSave(record);
      setTitle("");
      setElapsed("");
      setGoal("");
      setTransition("");
      setNotes("");
      setSegments([]);
      setLifts([]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Athlete">
            <NativeSelect
              value={who}
              onChange={(event) => setWho(event.target.value as Athlete)}
            >
              {(["hippos", "gators", "team"] as const).map((key) => (
                <NativeSelectOption key={key} value={key}>
                  {ATHLETES[key].name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={day}
              max={today}
              onChange={(event) => setDay(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Session">
          <Input
            value={title}
            maxLength={120}
            placeholder="Full ATHX Lite simulation"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <NativeSelect
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as Workout["category"])
              }
            >
              {CATEGORIES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Format">
            <NativeSelect
              value={context}
              onChange={(event) =>
                setContext(event.target.value as Workout["context"])
              }
            >
              <NativeSelectOption value="pairs">Pairs</NativeSelectOption>
              <NativeSelectOption value="solo">Solo</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Elapsed time" hint="mm:ss">
            <Input
              value={elapsed}
              inputMode="numeric"
              placeholder="24:30"
              onChange={(event) => setElapsed(event.target.value)}
            />
          </Field>
          <Field label="Goal time" hint="Optional">
            <Input
              value={goal}
              inputMode="numeric"
              placeholder="22:00"
              onChange={(event) => setGoal(event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Stations</h3>
            <p className="text-[11px] text-muted-foreground">
              Optional. Add splits to see a full-workout scenario.
            </p>
          </div>
          <div className="flex gap-2">
            {segments.length === 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSegments(metconDrafts())}
              >
                ATHX stations
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSegments((current) => [...current, emptySegment()])}
            >
              <Plus /> Station
            </Button>
          </div>
        </div>

        {segments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No stations yet — the session saves with its elapsed time alone.
          </p>
        ) : (
          <ul className="space-y-3">
            {segments.map((segment, index) => (
              <li key={index} className="rounded-xl border bg-background p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Input
                    value={segment.name}
                    maxLength={100}
                    placeholder="Station name"
                    className="h-8"
                    onChange={(event) =>
                      updateSegment(index, { name: event.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove station ${index + 1}`}
                    onClick={() =>
                      setSegments((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    <X />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field label="Done">
                    <Input
                      value={segment.completed}
                      inputMode="decimal"
                      className="h-8"
                      onChange={(event) =>
                        updateSegment(index, { completed: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Target">
                    <Input
                      value={segment.target}
                      inputMode="decimal"
                      className="h-8"
                      onChange={(event) =>
                        updateSegment(index, { target: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Unit">
                    <NativeSelect
                      size="sm"
                      value={segment.unit}
                      onChange={(event) =>
                        updateSegment(index, {
                          unit: event.target.value as Segment["unit"],
                        })
                      }
                    >
                      {UNITS.map((unit) => (
                        <NativeSelectOption key={unit} value={unit}>
                          {unit}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Split">
                    <Input
                      value={segment.time}
                      inputMode="numeric"
                      placeholder="3:20"
                      className="h-8"
                      onChange={(event) =>
                        updateSegment(index, { time: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              Fatigue allowance on unperformed work
            </Label>
            <span className="text-xs font-medium tabular-nums">{fatigue}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={fatigue}
            onChange={(event) => setFatigue(Number(event.target.value))}
            className="h-6 w-full accent-foreground"
            aria-label="Fatigue allowance percent"
          />
        </div>
        <Field label="Rest still to come" hint="Seconds of transition left in the workout">
          <Input
            value={transition}
            inputMode="numeric"
            placeholder="0"
            onChange={(event) => setTransition(event.target.value)}
          />
        </Field>

        {projection ? (
          <div className="rounded-xl bg-muted/60 p-3 text-xs">
            <p className="font-medium">
              {projection.partial ? "Full-workout scenario" : "Workout time"}{" "}
              {formatTime(projection.estimate)}
              {projection.partial ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  (range {formatTime(projection.linear)}–
                  {formatTime(projection.upper)})
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-muted-foreground">
              {projection.coverage}% of the target work was performed.
              {projection.partial
                ? " Unperformed work is carried at your own station pace plus the allowance above — a scenario, not a prediction."
                : " Every station was completed, so this is the measured time."}
            </p>
          </div>
        ) : parsedSegments.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            A scenario appears once every station has some completed work with a
            split time, and the splits fit inside the elapsed time. An unperformed
            station cannot borrow another movement&apos;s pace.
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Lifts</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setLifts((current) => [...current, { name: "", kg: "", reps: "" }])
            }
          >
            <Plus /> Lift
          </Button>
        </div>
        {lifts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add working sets if this was a strength day.
          </p>
        ) : (
          <ul className="space-y-2">
            {lifts.map((lift, index) => (
              <li key={index} className="flex items-end gap-2">
                <Field label="Lift" className="flex-1">
                  <Input
                    value={lift.name}
                    maxLength={80}
                    placeholder="Back squat"
                    className="h-8"
                    onChange={(event) =>
                      setLifts((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="kg" className="w-20">
                  <Input
                    value={lift.kg}
                    inputMode="decimal"
                    className="h-8"
                    onChange={(event) =>
                      setLifts((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, kg: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Reps" className="w-16">
                  <Input
                    value={lift.reps}
                    inputMode="numeric"
                    className="h-8"
                    onChange={(event) =>
                      setLifts((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, reps: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove lift ${index + 1}`}
                  onClick={() =>
                    setLifts((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-4 sm:p-5">
        <Field label="Notes">
          <Textarea
            value={notes}
            maxLength={2000}
            rows={3}
            placeholder="How it felt, what to change next time"
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? "Saving…" : "Save session"}
      </Button>
    </form>
  );
}
