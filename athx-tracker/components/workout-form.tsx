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
  type Segment,
  type Workout,
} from "@/lib/domain";

type Side = "hippos" | "gators";
const SIDES = ["hippos", "gators"] as const;

/** What the session is made of, shared by both athletes. */
type Station = {
  name: string;
  unit: Segment["unit"];
  target: string;
  load?: string;
};

/** What one athlete actually did at one station. */
type Entry = { completed: string; time: string };

type LiftRow = {
  name: string;
  hippos: { kg: string; sets: string; reps: string };
  gators: { kg: string; sets: string; reps: string };
};

const CATEGORIES = ["MetCon", "Strength", "Endurance", "Other"] as const;
const UNITS = ["reps", "m", "cal", "rounds"] as const;

const blankEntry = (): Entry => ({ completed: "", time: "" });
const blankLiftSide = () => ({ kg: "", sets: "", reps: "" });
const blankLift = (): LiftRow => ({
  name: "",
  hippos: blankLiftSide(),
  gators: blankLiftSide(),
});

const metconStations = (): Station[] =>
  METCON.map((s) => ({
    name: s.name,
    unit: s.unit,
    target: String(s.target),
    load: s.load,
  }));

const runStation = (): Station[] => [{ name: "Run", unit: "m", target: "" }];

const stationsFor = (category: Workout["category"]): Station[] =>
  category === "MetCon"
    ? metconStations()
    : category === "Endurance"
      ? runStation()
      : [];

const entriesFor = (stations: Station[]) => stations.map(() => blankEntry());

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

/** A tinted column so it is always obvious whose numbers these are. */
function Column({ side, children }: { side: Side; children: React.ReactNode }) {
  return (
    <div
      className="min-w-0 space-y-2 rounded-lg border p-2.5"
      style={{ borderColor: `${ATHLETES[side].color}44` }}
    >
      <p
        className="flex items-center gap-1.5 text-[11px] font-semibold"
        style={{ color: ATHLETES[side].color }}
      >
        <span
          className="size-2 rounded-full"
          style={{ background: ATHLETES[side].color }}
        />
        {ATHLETES[side].name}
      </p>
      {children}
    </div>
  );
}

function Panel({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {note ? (
            <p className="text-[11px] text-muted-foreground">{note}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function WorkoutForm({
  today,
  onSave,
}: {
  today: string;
  onSave: (record: Workout) => Promise<void>;
}) {
  const [day, setDay] = useState(today);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Workout["category"]>("MetCon");
  const [context, setContext] = useState<Workout["context"]>("pairs");
  const [stations, setStations] = useState<Station[]>(() => metconStations());
  const [entries, setEntries] = useState<Record<Side, Entry[]>>(() => ({
    hippos: entriesFor(metconStations()),
    gators: entriesFor(metconStations()),
  }));
  const [elapsed, setElapsed] = useState<Record<Side, string>>({
    hippos: "",
    gators: "",
  });
  const [lifts, setLifts] = useState<LiftRow[]>([blankLift()]);
  const [goal, setGoal] = useState("");
  const [fatigue, setFatigue] = useState(10);
  const [transition, setTransition] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const usesStations = category !== "Strength";
  const usesLifts = category === "Strength" || category === "Other";
  const isRun = category === "Endurance";

  /** Changing the category reshapes the session, so rebuild its stations. */
  function changeCategory(next: Workout["category"]) {
    setCategory(next);
    const fresh = stationsFor(next);
    setStations(fresh);
    setEntries({ hippos: entriesFor(fresh), gators: entriesFor(fresh) });
  }

  function setEntry(side: Side, index: number, patch: Partial<Entry>) {
    setEntries((current) => ({
      ...current,
      [side]: current[side].map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      ),
    }));
  }

  function setStation(index: number, patch: Partial<Station>) {
    setStations((current) =>
      current.map((station, i) => (i === index ? { ...station, ...patch } : station)),
    );
  }

  function addStation() {
    setStations((current) => [...current, { name: "", unit: "reps", target: "" }]);
    setEntries((current) => ({
      hippos: [...current.hippos, blankEntry()],
      gators: [...current.gators, blankEntry()],
    }));
  }

  function removeStation(index: number) {
    setStations((current) => current.filter((_, i) => i !== index));
    setEntries((current) => ({
      hippos: current.hippos.filter((_, i) => i !== index),
      gators: current.gators.filter((_, i) => i !== index),
    }));
  }

  function setLift(index: number, side: Side, patch: Partial<LiftRow["hippos"]>) {
    setLifts((current) =>
      current.map((lift, i) =>
        i === index ? { ...lift, [side]: { ...lift[side], ...patch } } : lift,
      ),
    );
  }

  /** A column counts as used once anything at all is typed into it. */
  function used(side: Side) {
    if (elapsed[side].trim() !== "") return true;
    if (entries[side].some((e) => e.completed.trim() !== "" || e.time.trim() !== ""))
      return true;
    return lifts.some(
      (lift) =>
        lift.name.trim() !== "" &&
        (lift[side].kg.trim() !== "" ||
          lift[side].sets.trim() !== "" ||
          lift[side].reps.trim() !== ""),
    );
  }

  function segmentsFor(side: Side): Segment[] {
    if (!usesStations) return [];
    return stations
      .map((station, index) => {
        const entry = entries[side][index];
        const completed = num(entry.completed);
        // A run is measured, not chased: what you covered is the target.
        const target = isRun ? completed : num(station.target);
        return {
          name: station.name.trim(),
          unit: station.unit,
          completed,
          target,
          seconds: seconds(entry.time),
        };
      })
      .filter((segment) => segment.name !== "");
  }

  function liftsFor(side: Side) {
    return lifts
      .filter((lift) => lift.name.trim() !== "" && lift[side].kg.trim() !== "")
      .map((lift) => ({
        name: lift.name.trim(),
        kg: Number(lift[side].kg),
        sets: Math.round(num(lift[side].sets) || 1),
        reps: Math.round(num(lift[side].reps) || 1),
      }));
  }

  const projections = useMemo(
    () =>
      Object.fromEntries(
        SIDES.map((side) => [
          side,
          projectWorkout(
            segmentsFor(side),
            seconds(elapsed[side]),
            fatigue,
            num(transition),
          ),
        ]),
      ) as Record<Side, ReturnType<typeof projectWorkout>>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stations, entries, elapsed, fatigue, transition, category],
  );

  function validateSide(side: Side) {
    const who = ATHLETES[side].name;
    const total = seconds(elapsed[side]);
    if (!Number.isFinite(total) || total <= 0)
      return `${who}: enter the elapsed time as mm:ss.`;
    if (total > 86400) return `${who}: that elapsed time is too long.`;

    const segments = segmentsFor(side);
    for (const segment of segments) {
      const where = `${who} · ${segment.name}`;
      if (!Number.isFinite(segment.seconds))
        return `${where}: write the time as mm:ss.`;
      if (!(segment.target > 0))
        return isRun
          ? `${where}: add the distance covered.`
          : `${where}: set a target above zero.`;
      if (segment.completed > segment.target)
        return `${where}: completed work is above the target.`;
      if (segment.completed === 0 && segment.seconds > 0)
        return `${where}: a time needs completed work with it.`;
      if (segment.completed > 0 && segment.seconds <= 0)
        return `${where}: measured work needs a time.`;
    }
    if (segments.reduce((n, s) => n + s.seconds, 0) > total + 1)
      return `${who}: the station times add up to more than the elapsed time.`;

    for (const lift of lifts) {
      if (lift.name.trim() === "") continue;
      const entry = lift[side];
      if (entry.kg.trim() === "") continue;
      if (!(Number(entry.kg) > 0))
        return `${who} · ${lift.name}: add the load in kg.`;
      if (entry.sets.trim() !== "" && !(num(entry.sets) >= 1))
        return `${who} · ${lift.name}: sets must be at least 1.`;
      if (entry.reps.trim() !== "" && !(num(entry.reps) >= 1))
        return `${who} · ${lift.name}: reps must be at least 1.`;
    }
    return "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const active = SIDES.filter(used);

    if (!title.trim()) return setError("Give the session a title.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError("Pick a valid date.");
    if (active.length === 0)
      return setError("Fill in at least one athlete before saving.");

    const goalSeconds = goal.trim() === "" ? null : parseTime(goal);
    if (goalSeconds !== null && (!Number.isFinite(goalSeconds) || goalSeconds <= 0))
      return setError("Write the goal time as mm:ss, or leave it empty.");

    for (const side of active) {
      const problem = validateSide(side);
      if (problem) return setError(problem);
    }
    setError("");

    const records: Workout[] = active.map((side) => ({
      id: newId(),
      kind: "workout",
      athlete: side,
      day,
      title: title.trim(),
      category,
      seconds: seconds(elapsed[side]),
      notes: notes.trim(),
      segments: segmentsFor(side),
      fatigue,
      transition: num(transition),
      goal: goalSeconds,
      context,
      lifts: liftsFor(side),
    }));

    setSaving(true);
    try {
      // Sequential: the second save should not race the first through SQLite.
      for (const record of records) await onSave(record);
      const fresh = stationsFor(category);
      setTitle("");
      setElapsed({ hippos: "", gators: "" });
      setStations(fresh);
      setEntries({ hippos: entriesFor(fresh), gators: entriesFor(fresh) });
      setLifts([blankLift()]);
      setGoal("");
      setTransition("");
      setNotes("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input
              type="date"
              value={day}
              max={today}
              onChange={(event) => setDay(event.target.value)}
            />
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
        <Field label="Session">
          <Input
            value={title}
            maxLength={120}
            placeholder="Full ATHX Lite simulation"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <NativeSelect
              value={category}
              onChange={(event) =>
                changeCategory(event.target.value as Workout["category"])
              }
            >
              {CATEGORIES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}
                </NativeSelectOption>
              ))}
            </NativeSelect>
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

      <Panel
        title="Elapsed time"
        note="Fill one side or both. An empty side is not saved."
      >
        <div className="grid grid-cols-2 gap-2.5">
          {SIDES.map((side) => (
            <Column key={side} side={side}>
              <Input
                value={elapsed[side]}
                inputMode="numeric"
                placeholder="24:30"
                aria-label={`${ATHLETES[side].name} elapsed time`}
                onChange={(event) =>
                  setElapsed((current) => ({
                    ...current,
                    [side]: event.target.value,
                  }))
                }
              />
            </Column>
          ))}
        </div>
      </Panel>

      {usesStations ? (
        <Panel
          title={isRun ? "Run" : "Stations"}
          note={
            isRun
              ? "Distance covered and the time it took."
              : "What each of you actually completed, station by station."
          }
          action={
            category === "Other" ? (
              <Button type="button" variant="outline" size="sm" onClick={addStation}>
                <Plus /> Station
              </Button>
            ) : null
          }
        >
          {stations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No stations yet — add one to record what you did.
            </p>
          ) : (
            <ul className="space-y-3">
              {stations.map((station, index) => (
                <li key={index} className="rounded-xl border bg-background p-3">
                  {category === "MetCon" ? (
                    <div className="mb-2.5">
                      <p className="text-sm font-medium">
                        {index + 1}. {station.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Target {station.target} {station.unit}
                        {station.load ? ` · ${station.load}` : ""}
                      </p>
                    </div>
                  ) : isRun ? (
                    <p className="mb-2.5 text-sm font-medium">Distance and time</p>
                  ) : (
                    <div className="mb-2.5 flex items-end gap-2">
                      <Field label="Station" className="flex-1">
                        <Input
                          value={station.name}
                          maxLength={100}
                          placeholder="Station name"
                          className="h-8"
                          onChange={(event) =>
                            setStation(index, { name: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="Target" className="w-20">
                        <Input
                          value={station.target}
                          inputMode="decimal"
                          className="h-8"
                          onChange={(event) =>
                            setStation(index, { target: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="Unit" className="w-24">
                        <NativeSelect
                          size="sm"
                          value={station.unit}
                          onChange={(event) =>
                            setStation(index, {
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove station ${index + 1}`}
                        onClick={() => removeStation(index)}
                      >
                        <X />
                      </Button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    {SIDES.map((side) => (
                      <Column key={side} side={side}>
                        <Field
                          label={isRun ? "Distance (m)" : `Done (${station.unit})`}
                        >
                          <Input
                            value={entries[side][index]?.completed ?? ""}
                            inputMode="decimal"
                            className="h-8"
                            onChange={(event) =>
                              setEntry(side, index, {
                                completed: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Time" hint="mm:ss">
                          <Input
                            value={entries[side][index]?.time ?? ""}
                            inputMode="numeric"
                            placeholder="3:20"
                            className="h-8"
                            onChange={(event) =>
                              setEntry(side, index, { time: event.target.value })
                            }
                          />
                        </Field>
                      </Column>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {usesLifts ? (
        <Panel
          title="Lifts"
          note="Load, sets and reps for each of you."
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLifts((current) => [...current, blankLift()])}
            >
              <Plus /> Lift
            </Button>
          }
        >
          <ul className="space-y-3">
            {lifts.map((lift, index) => (
              <li key={index} className="rounded-xl border bg-background p-3">
                <div className="mb-2.5 flex items-end gap-2">
                  <Field label="Lift" className="flex-1">
                    <Input
                      value={lift.name}
                      maxLength={80}
                      placeholder="Back squat"
                      className="h-8"
                      onChange={(event) =>
                        setLifts((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, name: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </Field>
                  {lifts.length > 1 ? (
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
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {SIDES.map((side) => (
                    <Column key={side} side={side}>
                      <Field label="kg">
                        <Input
                          value={lift[side].kg}
                          inputMode="decimal"
                          className="h-8"
                          onChange={(event) =>
                            setLift(index, side, { kg: event.target.value })
                          }
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Sets">
                          <Input
                            value={lift[side].sets}
                            inputMode="numeric"
                            placeholder="3"
                            className="h-8"
                            onChange={(event) =>
                              setLift(index, side, { sets: event.target.value })
                            }
                          />
                        </Field>
                        <Field label="Reps">
                          <Input
                            value={lift[side].reps}
                            inputMode="numeric"
                            placeholder="5"
                            className="h-8"
                            onChange={(event) =>
                              setLift(index, side, { reps: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                    </Column>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {usesStations && !isRun ? (
        <Panel title="Full-workout scenario">
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
          <Field label="Rest still to come" hint="Seconds of transition left">
            <Input
              value={transition}
              inputMode="numeric"
              placeholder="0"
              onChange={(event) => setTransition(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            {SIDES.map((side) => {
              const projection = projections[side];
              return (
                <Column key={side} side={side}>
                  {projection ? (
                    <div className="text-xs">
                      <p className="font-medium">
                        {projection.partial ? "Scenario " : "Time "}
                        {formatTime(projection.estimate)}
                      </p>
                      {projection.partial ? (
                        <p className="text-muted-foreground">
                          {formatTime(projection.linear)}–
                          {formatTime(projection.upper)} · {projection.coverage}%
                          performed
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          Every station completed.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Appears once every station has completed work with a time.
                    </p>
                  )}
                </Column>
              );
            })}
          </div>
        </Panel>
      ) : null}

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
