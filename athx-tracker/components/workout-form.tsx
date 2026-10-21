"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { dayToDate, newId } from "@/lib/client";
import {
  ATHLETES,
  METCON,
  formatTime,
  parseTime,
  projectWorkout,
  fromKilograms,
  toKilograms,
  type Segment,
  type WeightUnit,
  type Workout,
} from "@/lib/domain";

type Side = "hippos" | "gators";

/** What the session is made of, shared by both athletes. */
type Station = {
  name: string;
  custom: string;
  unit: Segment["unit"];
  target: string;
  load?: string;
};

/** What one athlete actually did at one station. */
type Entry = { completed: string; time: string };

type LiftRow = {
  name: string;
  custom: string;
  hippos: { kg: string; sets: string; reps: string };
  gators: { kg: string; sets: string; reps: string };
};

const CATEGORIES = ["MetCon", "Strength", "Endurance", "Other"] as const;
const UNITS = ["reps", "m", "cal", "rounds"] as const;

const OTHER = "Other";

/** Picking beats typing on a phone, with a way out for anything not listed. */
const EXERCISES: { group: string; items: string[] }[] = [
  {
    // The loaded movements from the ATHX Lite MetCon, named exactly as the
    // stations name them, so a lift and a station read the same in the log.
    group: "ATHX",
    items: ["DB ground to overhead", "DB bench press", "Sandbag squats"],
  },
  {
    group: "Lower body",
    items: [
      "Back squat",
      "Front squat",
      "Goblet squat",
      "Deadlift",
      "Romanian deadlift",
      "Hip thrust",
      "Walking lunge",
      "Bulgarian split squat",
      "Step-up",
    ],
  },
  {
    group: "Upper push",
    items: [
      "Bench press",
      "Incline bench press",
      "Overhead press",
      "Push press",
      "Dip",
      "Push-up",
    ],
  },
  {
    group: "Upper pull",
    items: [
      "Pull-up",
      "Chin-up",
      "Barbell row",
      "Dumbbell row",
      "Lat pulldown",
      "Face pull",
    ],
  },
  {
    group: "Power",
    items: [
      "Power clean",
      "Clean and jerk",
      "Snatch",
      "Thruster",
      "Dumbbell snatch",
      "Kettlebell swing",
    ],
  },
  {
    group: "Carries and strongman",
    items: [
      "Farmer carry",
      "Sandbag carry",
      "Sandbag clean",
      "Sled push",
      "Sled pull",
    ],
  },
  {
    group: "Conditioning",
    items: [
      "Row",
      "Bike erg",
      "Ski erg",
      "Run",
      "Burpee",
      "Burpees over bench",
      "Wall ball",
      "Box jump",
      "Double under",
    ],
  },
];

/** The typed name only counts when Other is the choice. */
const exerciseName = (choice: string, custom: string) =>
  (choice === OTHER ? custom : choice).trim();

const LISTED = new Set(EXERCISES.flatMap((group) => group.items));

/** Reverse of exerciseName: put a saved name back into the picker. */
const toChoice = (name: string) =>
  LISTED.has(name) ? { name, custom: "" } : { name: OTHER, custom: name };

/** Legacy records can be on the team athlete, which has no column of its own. */
const sideOf = (athlete: Workout["athlete"]): Side =>
  athlete === "gators" ? "gators" : "hippos";

function ExercisePicker({
  label,
  choice,
  custom,
  onChoice,
  onCustom,
}: {
  label: string;
  choice: string;
  custom: string;
  onChoice: (value: string) => void;
  onCustom: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Field label={label}>
        <NativeSelect
          size="sm"
          value={choice}
          onChange={(event) => onChoice(event.target.value)}
        >
          <NativeSelectOption value="">Choose…</NativeSelectOption>
          {EXERCISES.map((group) => (
            <NativeSelectOptGroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {item}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ))}
          <NativeSelectOption value={OTHER}>Other…</NativeSelectOption>
        </NativeSelect>
      </Field>
      {choice === OTHER ? (
        <Field label="Name it">
          <Input
            value={custom}
            maxLength={80}
            placeholder="Exercise name"
            className="h-8"
            onChange={(event) => onCustom(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}

const blankEntry = (): Entry => ({ completed: "", time: "" });
const blankLiftSide = () => ({ kg: "", sets: "", reps: "" });
const blankLift = (): LiftRow => ({
  name: "",
  custom: "",
  hippos: blankLiftSide(),
  gators: blankLiftSide(),
});

const metconStations = (): Station[] =>
  METCON.map((s) => ({
    name: s.name,
    custom: "",
    unit: s.unit,
    target: String(s.target),
    load: s.load,
  }));

const runStation = (): Station[] => [
  { name: "Run", custom: "", unit: "m", target: "" },
];

const stationsFor = (category: Workout["category"]): Station[] =>
  category === "MetCon"
    ? metconStations()
    : category === "Endurance"
      ? runStation()
      : [];

const entriesFor = (stations: Station[]) => stations.map(() => blankEntry());

const num = (value: string) => (value.trim() === "" ? 0 : Number(value));
const seconds = (value: string) => (value.trim() === "" ? 0 : parseTime(value));

/** An untitled session is named after its date, which never goes stale. */
const dateTitle = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(dayToDate(day));

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
  sides,
  weightUnit,
  editing,
  onCancelEdit,
  onSave,
}: {
  today: string;
  sides: readonly Side[];
  weightUnit: WeightUnit;
  editing?: Workout | null;
  onCancelEdit?: () => void;
  onSave: (record: Workout) => Promise<void>;
}) {
  // Editing is one athlete's record, so it fills that athlete's column alone.
  // The parent remounts on a change of target, so these initialisers are enough.
  const editSide = editing ? sideOf(editing.athlete) : null;
  const columns = editSide ? ([editSide] as const) : sides;

  const [day, setDay] = useState(editing?.day ?? today);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [category, setCategory] = useState<Workout["category"]>(
    editing?.category ?? "MetCon",
  );
  const [context, setContext] = useState<Workout["context"]>(
    editing?.context ?? "pairs",
  );
  const [stations, setStations] = useState<Station[]>(() =>
    editing
      ? editing.segments.map((segment) => ({
          ...toChoice(segment.name),
          unit: segment.unit,
          target: String(segment.target),
          load: METCON.find((station) => station.name === segment.name)?.load,
        }))
      : metconStations(),
  );
  const [entries, setEntries] = useState<Record<Side, Entry[]>>(() => {
    if (!editing || !editSide)
      return {
        hippos: entriesFor(metconStations()),
        gators: entriesFor(metconStations()),
      };
    const mine = editing.segments.map((segment) => ({
      completed: segment.completed ? String(segment.completed) : "",
      time: segment.seconds ? formatTime(segment.seconds) : "",
    }));
    const empty = editing.segments.map(() => blankEntry());
    return editSide === "gators"
      ? { hippos: empty, gators: mine }
      : { hippos: mine, gators: empty };
  });
  const [elapsed, setElapsed] = useState<Record<Side, string>>(() =>
    editing && editSide
      ? { hippos: "", gators: "", [editSide]: formatTime(editing.seconds) }
      : { hippos: "", gators: "" },
  );
  const [lifts, setLifts] = useState<LiftRow[]>(() => {
    if (!editing || !editSide || editing.lifts.length === 0) return [blankLift()];
    return editing.lifts.map((lift) => ({
      ...blankLift(),
      ...toChoice(lift.name),
      [editSide]: {
        kg: String(Math.round(fromKilograms(lift.kg, weightUnit) * 10) / 10),
        sets: String(lift.sets ?? 1),
        reps: String(lift.reps),
      },
    }));
  });
  const [goal, setGoal] = useState(editing?.goal ? formatTime(editing.goal) : "");
  const [fatigue, setFatigue] = useState(editing?.fatigue ?? 10);
  const [transition, setTransition] = useState(
    editing ? String(editing.transition) : "",
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState("");
  const [invalidSide, setInvalidSide] = useState<Side | null>(null);
  const [saving, setSaving] = useState(false);
  const elapsedRefs = useRef<Record<Side, HTMLInputElement | null>>({
    hippos: null,
    gators: null,
  });

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
    setStations((current) => [
      ...current,
      { name: "", custom: "", unit: "reps", target: "" },
    ]);
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

  /**
   * Elapsed time is optional: a part-finished MetCon has a total anyway, which
   * is the time spent at the stations. Typing one still wins, because only you
   * know about the rest between them.
   */
  function totalFor(side: Side) {
    if (elapsed[side].trim() !== "") return seconds(elapsed[side]);
    return segmentsFor(side).reduce((sum, segment) => sum + segment.seconds, 0);
  }

  /** A column counts as used once anything at all is typed into it. */
  function used(side: Side) {
    if (elapsed[side].trim() !== "") return true;
    if (entries[side].some((e) => e.completed.trim() !== "" || e.time.trim() !== ""))
      return true;
    return lifts.some(
      (lift) =>
        exerciseName(lift.name, lift.custom) !== "" &&
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
          name: exerciseName(station.name, station.custom),
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
      .filter(
        (lift) =>
          exerciseName(lift.name, lift.custom) !== "" &&
          lift[side].kg.trim() !== "",
      )
      .map((lift) => ({
        name: exerciseName(lift.name, lift.custom),
        // Entered in your unit, stored in kilograms.
        kg:
          Math.round(toKilograms(Number(lift[side].kg), weightUnit) * 100) / 100,
        sets: Math.round(num(lift[side].sets) || 1),
        reps: Math.round(num(lift[side].reps) || 1),
      }));
  }

  const projections = useMemo(
    () =>
      Object.fromEntries(
        columns.map((side) => [
          side,
          projectWorkout(
            segmentsFor(side),
            totalFor(side),
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
    const typed = elapsed[side].trim() !== "";
    const total = totalFor(side);
    const segments = segmentsFor(side);

    if (typed && (!Number.isFinite(total) || total <= 0)) {
      // Say which box, and put the cursor in it: the message alone is not enough.
      setInvalidSide(side);
      elapsedRefs.current[side]?.focus();
      elapsedRefs.current[side]?.scrollIntoView({ block: "center" });
      return `${who}: write the elapsed time as mm:ss, or leave it empty.`;
    }
    if (!typed && !(total > 0)) {
      setInvalidSide(side);
      elapsedRefs.current[side]?.focus();
      elapsedRefs.current[side]?.scrollIntoView({ block: "center" });
      return usesStations
        ? `${who}: add an elapsed time, or a time against at least one station.`
        : `${who}: add the elapsed time as mm:ss.`;
    }
    if (total > 86400) return `${who}: that elapsed time is too long.`;

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
      const entry = lift[side];
      if (entry.kg.trim() === "") continue;
      const liftName = exerciseName(lift.name, lift.custom);
      if (liftName === "") return `${who}: choose or name the exercise.`;
      if (!(Number(entry.kg) > 0))
        return `${who} · ${liftName}: add the load in ${weightUnit}.`;
      if (entry.sets.trim() !== "" && !(num(entry.sets) >= 1))
        return `${who} · ${liftName}: sets must be at least 1.`;
      if (entry.reps.trim() !== "" && !(num(entry.reps) >= 1))
        return `${who} · ${liftName}: reps must be at least 1.`;
    }
    return "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setInvalidSide(null);
    const active = columns.filter(used);

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
      id: editing ? editing.id : newId(),
      kind: "workout",
      athlete: editing ? editing.athlete : side,
      day,
      title: title.trim() || dateTitle(day),
      category,
      seconds: totalFor(side),
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
      {editing ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border bg-muted/50 p-3">
          <p className="text-xs">
            Editing{" "}
            <span className="font-medium">{ATHLETES[editing.athlete].name}</span>
            {" · "}
            {editing.day}
          </p>
          <Button type="button" variant="ghost" size="xs" onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      ) : null}
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
        <Field label="Session" hint="Optional — the date is used if left blank">
          <Input
            value={title}
            maxLength={120}
            placeholder={dateTitle(day)}
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
              placeholder="mm:ss"
              onChange={(event) => setGoal(event.target.value)}
            />
          </Field>
        </div>
      </section>

      <Panel
        title="Elapsed time"
        note="Optional. Left blank, the station times are added up instead."
      >
        <div className={`grid gap-2.5 ${columns.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {columns.map((side) => (
            <Column key={side} side={side}>
              <Input
                ref={(element) => {
                  elapsedRefs.current[side] = element;
                }}
                value={elapsed[side]}
                inputMode="numeric"
                placeholder="mm:ss"
                aria-invalid={invalidSide === side}
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
                    <div className="mb-2.5 space-y-2">
                      <ExercisePicker
                        label="Station"
                        choice={station.name}
                        custom={station.custom}
                        onChoice={(value) => setStation(index, { name: value })}
                        onCustom={(value) => setStation(index, { custom: value })}
                      />
                      <div className="flex items-end gap-2">
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
                        <Field label="Unit" className="flex-1">
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
                    </div>
                  )}

                  <div className={`grid gap-2.5 ${columns.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                    {columns.map((side) => (
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
                            placeholder="mm:ss"
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
                  <div className="flex-1">
                    <ExercisePicker
                      label="Lift"
                      choice={lift.name}
                      custom={lift.custom}
                      onChoice={(value) =>
                        setLifts((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, name: value } : row,
                          ),
                        )
                      }
                      onCustom={(value) =>
                        setLifts((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, custom: value } : row,
                          ),
                        )
                      }
                    />
                  </div>
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
                <div className={`grid gap-2.5 ${columns.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {columns.map((side) => (
                    <Column key={side} side={side}>
                      <Field label={weightUnit}>
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
          <div className={`grid gap-2.5 ${columns.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {columns.map((side) => {
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
        {saving ? "Saving…" : editing ? "Update session" : "Save session"}
      </Button>
    </form>
  );
}
