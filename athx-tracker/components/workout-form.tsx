"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { CalendarDays, Plus, Sparkles, X } from "lucide-react";
import { WorkoutDictation } from "@/components/workout-dictation";
import { EXERCISES } from "@/lib/exercises";
import { alignWorkoutDraft } from "@/lib/movement-match";
import { workoutDraftSchema, type WorkoutDraft } from "@/lib/workout-draft";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { athleteOutline, type AthleteOutline } from "@/lib/athlete-outline";
import { addDays, api, dayToDate, message, newId } from "@/lib/client";
import {
  ATHLETES,
  METCON,
  PRESETS,
  categoryShape,
  defaultContext,
  localDay,
  presetElapsed,
  presetTitle,
  sessionSeconds,
  formatTime,
  parseTime,
  displayDistance,
  displayLoad,
  formatWeight,
  fromMetres,
  liftTop,
  isDistanceUnit,
  metconLoadText,
  parseLoad,
  reunitLoad,
  segmentBlock,
  standardLoad,
  toMetres,
  type Block,
  type DistanceUnit,
  type Segment,
  type WeightUnit,
  type Workout,
} from "@/lib/domain";

type Side = "hippos" | "gators";
type Format = "hippos" | "gators" | "pairs";

/** What the session is made of, shared by both athletes. */
type Station = {
  name: string;
  custom: string;
  unit: Segment["unit"];
  target: string;
  /** MetCon or endurance work, which matters once a session mixes them. */
  block: Block;
  /** One of the ATHX circuit's stations, shown as prescribed rather than edited. */
  fixed?: boolean;
};

/**
 * What one athlete actually did at one station. load is in the unit on
 * screen; savedKg is the load the entry was opened with, kept exact.
 */
type Entry = {
  completed: string;
  time: string;
  load: string;
  savedKg?: number;
  /** The load box still holds the standard weight the form put there. */
  prefilled?: boolean;
};

type SetDraft = { kg: string; reps: string; savedKg?: number };
type LiftSide = {
  kg: string;
  sets: string;
  reps: string;
  savedKg?: number;
  /** Each set has its own weight and reps. Off is one weight for every set. */
  advanced: boolean;
  detail: SetDraft[];
};
type LiftRow = {
  name: string;
  custom: string;
  hippos: LiftSide;
  gators: LiftSide;
};

const CATEGORIES = [
  "MetCon", "Strength", "Endurance", "Mixed", "Solidcore", "Tennis", "YTW", "Other",
] as const;

/** The circuit's own entry for a station, when it is one of the seven. */
const circuitStation = (station: Pick<Station, "name" | "fixed">) =>
  station.fixed ? METCON.find((s) => s.name === station.name) : undefined;

/**
 * Whether a station takes a load. A circuit station does when the circuit
 * prescribes one; any other MetCon station may, unless it is counted in
 * calories, which is a machine. Endurance work is never loaded.
 */
const loadable = (category: Workout["category"], station: Station) => {
  // Solidcore, tennis and YTW stations are not lifted; MetCon, Mixed and Other may be.
  if (category === "Solidcore" || category === "Tennis" || category === "YTW") return false;
  if (station.block !== "metcon") return false;
  if (station.fixed) return Boolean(circuitStation(station)?.kg);
  return station.unit !== "cal";
};

const UNITS = ["reps", "m", "cal", "rounds"] as const;

const DISTANCE_CHOICES: readonly { value: DistanceUnit; name: string }[] = [
  { value: "m", name: "meters" },
  { value: "km", name: "kilometers" },
  { value: "mi", name: "miles" },
];

/** Metres, kilometres, or miles. The number in the box converts with the choice. */
function DistanceUnits({
  unit,
  onChange,
}: {
  unit: Segment["unit"];
  onChange: (next: DistanceUnit) => void;
}) {
  return (
    <div role="group" aria-label="Distance unit" className="flex w-fit rounded-full bg-muted p-0.5">
      {DISTANCE_CHOICES.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.name}
          aria-pressed={unit === option.value}
          onClick={() => onChange(option.value)}
          className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm"
        >
          {option.value}
        </button>
      ))}
    </div>
  );
}

function convertedDistance(text: string, from: DistanceUnit, to: DistanceUnit) {
  if (text.trim() === "" || from === to) return text;
  const value = Number(text);
  if (!Number.isFinite(value)) return text;
  return displayDistance(fromMetres(toMetres(value, from), to), to);
}

const OTHER = "Other";

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

const blankEntry = (): Entry => ({ completed: "", time: "", load: "" });
const blankSet = (): SetDraft => ({ kg: "", reps: "" });
const blankLiftSide = (): LiftSide => ({
  kg: "", sets: "", reps: "", advanced: false, detail: [],
});
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
    block: "metcon",
    fixed: true,
  }));

const runStation = (): Station[] => [
  { name: "Run", custom: "", unit: "m", target: "", block: "endurance" },
];

const stationsFor = (category: Workout["category"]): Station[] =>
  category === "MetCon"
    ? metconStations()
    : category === "Endurance"
      ? runStation()
      : [];

/**
 * Fresh entries for new stations. A circuit station that prescribes a load
 * starts with that athlete's standard weight, rounded to the rack, so saving it
 * untouched records it. Only ever for new stations: an entry opened for editing
 * keeps exactly what was saved, blank included.
 */
const entriesFor = (stations: Station[], side: Side, unit: WeightUnit): Entry[] =>
  stations.map((station) => {
    const kg = circuitStation(station)?.kg?.[side];
    return kg
      ? { ...blankEntry(), load: standardLoad(kg, unit), prefilled: true }
      : blankEntry();
  });

const entriesForBoth = (stations: Station[], unit: WeightUnit) => ({
  hippos: entriesFor(stations, "hippos", unit),
  gators: entriesFor(stations, "gators", unit),
});

const num = (value: string) => (value.trim() === "" ? 0 : Number(value));
/** How many set rows Advanced opens from the simple sets box. One, and never past the cap. */
const seedCount = (sets: string) => {
  const count = Math.round(num(sets));
  return Math.min(50, count >= 1 ? count : 1);
};
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

/** The calendar button names a day that is neither today nor yesterday. */
const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dayToDate(day));

/** Local midnight, so the calendar's day is the day in the string. */
const parseDay = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1);
};

const CHOICE =
  "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors aria-pressed:bg-accent aria-pressed:font-semibold";

const FORMAT_OPTIONS: readonly {
  value: Format;
  label: string;
  dots: readonly string[];
}[] = [
  { value: "hippos", label: "Hippos", dots: [ATHLETES.hippos.color] },
  { value: "gators", label: "Gators", dots: [ATHLETES.gators.color] },
  {
    value: "pairs",
    label: "Pairs",
    dots: [ATHLETES.hippos.color, ATHLETES.gators.color],
  },
];

function FormatButtons({
  value,
  onChange,
}: {
  value: Format;
  onChange: (next: Format) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        Format
      </Label>
      <div role="group" aria-label="Format" className="grid grid-cols-3 gap-1.5">
        {FORMAT_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={selected}
              {...(selected
                ? athleteOutline(option.value === "pairs" ? "both" : option.value, "accent")
                : {})}
              className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border-2 px-2 py-2.5 text-xs font-medium whitespace-nowrap transition-colors aria-pressed:bg-accent aria-pressed:font-semibold"
            >
              <span className="flex shrink-0 gap-0.5" aria-hidden="true">
                {option.dots.map((color) => (
                  <span
                    key={color}
                    className="size-2 rounded-full"
                    style={{ background: color }}
                  />
                ))}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DayButtons({
  today,
  day,
  onChange,
}: {
  today: string;
  day: string;
  onChange: (next: string) => void;
}) {
  const yesterday = addDays(today, -1);
  const custom = day !== today && day !== yesterday;
  const [open, setOpen] = useState(false);
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        Date
      </Label>
      <div role="group" aria-label="Date" className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => choose(today)}
          aria-pressed={day === today}
          className={CHOICE}
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => choose(yesterday)}
          aria-pressed={day === yesterday}
          className={CHOICE}
        >
          Yesterday
        </button>
        <div className="min-w-0">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-pressed={custom}
                aria-label={custom ? `Calendar, ${shortDay(day)}` : "Calendar"}
                className={`${CHOICE} w-full`}
              >
                <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{custom ? shortDay(day) : "Calendar"}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={parseDay(day)}
                defaultMonth={parseDay(day)}
                disabled={{ after: parseDay(today) }}
                onSelect={(selected) => {
                  if (!selected) return;
                  const next = localDay(selected);
                  if (next > today) return;
                  choose(next);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}

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
  // The label sat beside the control rather than attached to it, so nothing
  // announced what any field was, and nothing could find one by its name.
  const generated = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, {
        id: (children as ReactElement<{ id?: string }>).props.id ?? generated,
      })
    : children;
  const htmlFor = isValidElement(children)
    ? ((children as ReactElement<{ id?: string }>).props.id ?? generated)
    : undefined;

  return (
    <div className={className}>
      <Label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-medium text-muted-foreground"
      >
        {label}
      </Label>
      <div className="[&>div]:w-full">{control}</div>
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
        style={{ color: ATHLETES[side].ink }}
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

/** One athlete's sets: one weight for all of them, or a row for each. */
function LiftSets({
  side,
  entry,
  unit,
  onToggle,
  onSimple,
  onSet,
  onAdd,
  onRemove,
}: {
  side: Side;
  entry: LiftSide;
  unit: WeightUnit;
  onToggle: () => void;
  onSimple: (patch: Partial<Pick<LiftSide, "kg" | "sets" | "reps">>) => void;
  onSet: (index: number, patch: Partial<SetDraft>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const who = ATHLETES[side].name;
  const parsed = entry.detail.flatMap((set) => {
    const kg = parseLoad(set.kg, unit, set.savedKg);
    const reps = Math.round(num(set.reps) || 0);
    return kg !== null && reps >= 1 ? [{ kg, reps }] : [];
  });
  const same = parsed.length > 0 && parsed.every((set) => set.kg === parsed[0].kg && set.reps === parsed[0].reps);
  const top = parsed.length > 0 ? liftTop(parsed) : null;
  return (
    <Column side={side}>
      <div>
        <Button
          type="button"
          variant={entry.advanced ? "secondary" : "outline"}
          size="xs"
          aria-pressed={entry.advanced}
          aria-label={`${who} advanced sets`}
          onClick={onToggle}
        >
          Advanced
        </Button>
      </div>
      {entry.advanced ? (
        <>
          <ul className="space-y-2">
            {entry.detail.map((set, index) => (
              <li key={index} className="flex items-end gap-2">
                <Field label={unit} className="min-w-0 flex-1">
                  <Input
                    value={set.kg}
                    inputMode="decimal"
                    className="h-8"
                    aria-label={`${who} set ${index + 1} weight`}
                    onChange={(event) => onSet(index, { kg: event.target.value })}
                  />
                </Field>
                <Field label="Reps" className="min-w-0 flex-1">
                  <Input
                    value={set.reps}
                    inputMode="numeric"
                    className="h-8"
                    aria-label={`${who} set ${index + 1} reps`}
                    onChange={(event) => onSet(index, { reps: event.target.value })}
                  />
                </Field>
                {entry.detail.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${who} remove set ${index + 1}`}
                    onClick={() => onRemove(index)}
                  >
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {entry.detail.length < 50 ? (
            <Button type="button" variant="outline" size="xs" aria-label={`${who} add set`} onClick={onAdd}>
              <Plus /> Set
            </Button>
          ) : null}
          {top ? (
            <p className="text-[11px] text-muted-foreground">
              {same
                ? `${parsed.length}×${parsed[0].reps} at ${formatWeight(parsed[0].kg, unit)}`
                : `Heaviest ${formatWeight(top.kg, unit)} ${top.sets}×${top.reps}`}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <Field label={unit}>
            <Input
              value={entry.kg}
              inputMode="decimal"
              className="h-8"
              onChange={(event) => onSimple({ kg: event.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Sets">
              <Input
                value={entry.sets}
                inputMode="numeric"
                placeholder="3"
                className="h-8"
                onChange={(event) => onSimple({ sets: event.target.value })}
              />
            </Field>
            <Field label="Reps">
              <Input
                value={entry.reps}
                inputMode="numeric"
                placeholder="5"
                className="h-8"
                onChange={(event) => onSimple({ reps: event.target.value })}
              />
            </Field>
          </div>
        </>
      )}
    </Column>
  );
}

function Panel({
  title,
  note,
  action,
  outline,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  outline: AthleteOutline;
  children: React.ReactNode;
}) {
  return (
    <section {...athleteOutline(outline)} className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
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
  grokReady,
  onWeightUnit,
  onLoggingFor,
  editing,
  onCancelEdit,
  onSave,
}: {
  today: string;
  sides: readonly Side[];
  weightUnit: WeightUnit;
  grokReady: boolean;
  /** Remembers a unit switched here, as Setup would. */
  onWeightUnit?: (unit: WeightUnit) => void;
  /** Hippos, Gators, or both. The header switch and these buttons are one choice. */
  onLoggingFor: (next: "hippos" | "gators" | "both") => void;
  editing?: Workout | null;
  onCancelEdit?: () => void;
  onSave: (batch: Workout[]) => Promise<void>;
}) {
  // The form's own copy: every box here is in this unit, whether or not the
  // switch has reached the server yet, so what is typed is read correctly.
  const [unit, setUnit] = useState<WeightUnit>(weightUnit);
  // Editing is one athlete's record, so it fills that athlete's column alone.
  // The parent remounts on a change of target, so these initialisers are enough.
  const editSide = editing ? sideOf(editing.athlete) : null;

  const [day, setDay] = useState(editing?.day ?? today);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [category, setCategory] = useState<Workout["category"]>(
    editing?.category ?? "MetCon",
  );
  const [customCategory, setCustomCategory] = useState(
    editing?.customCategory ?? "",
  );
  // An open edit is one record. These name that record. A new session follows
  // the header, and the format buttons are that switch: one person is solo,
  // Pairs is both.
  const [recordSide, setRecordSide] = useState<Side>(editSide ?? "hippos");
  const [recordContext, setRecordContext] = useState<Workout["context"]>(
    editing?.context ?? "solo",
  );
  const format: Format = editing
    ? recordContext === "pairs"
      ? "pairs"
      : recordSide
    : sides.length > 1
      ? "pairs"
      : sides[0];
  const outline: AthleteOutline = format === "pairs" ? "both" : format;
  const context: Workout["context"] = editing
    ? recordContext
    : defaultContext(sides.length);
  // Switching person on an edit keeps the original athlete when the side did
  // not change, so a legacy team record is not rewritten just by opening it.
  const athleteForEdit: Workout["athlete"] =
    editing && editSide && recordSide === editSide ? editing.athlete : recordSide;
  const columns: readonly Side[] = editing ? [recordSide] : sides;
  const [stations, setStations] = useState<Station[]>(() =>
    editing
      ? editing.segments.map((segment) => {
          const block = segmentBlock(editing, segment);
          const circuit = METCON.find((station) => station.name === segment.name);
          // Before sessions could mix, every MetCon station was a circuit one.
          const fixed =
            Boolean(circuit) &&
            (editing.category === "MetCon" ||
              (editing.category === "Mixed" &&
                block === "metcon" &&
                circuit?.unit === segment.unit &&
                circuit?.target === segment.target));
          return {
            ...(fixed ? { name: segment.name, custom: "" } : toChoice(segment.name)),
            unit: segment.unit,
            target: String(segment.target),
            block,
            fixed,
          };
        })
      : metconStations(),
  );
  const [entries, setEntries] = useState<Record<Side, Entry[]>>(() => {
    if (!editing || !editSide)
      return entriesForBoth(metconStations(), weightUnit);
    const mine = editing.segments.map((segment) => ({
      completed: segment.completed ? String(segment.completed) : "",
      time: segment.seconds ? formatTime(segment.seconds) : "",
      load: segment.kg ? displayLoad(segment.kg, weightUnit) : "",
      savedKg: segment.kg,
    }));
    const empty = editing.segments.map(() => blankEntry());
    return editSide === "gators"
      ? { hippos: empty, gators: mine }
      : { hippos: mine, gators: empty };
  });
  const [elapsed, setElapsed] = useState<Record<Side, string>>(() =>
    editing && editSide
      ? {
        hippos: "",
        gators: "",
        // Zero was never recorded, so the box stays empty rather than reading 0:00.
        [editSide]: editing.seconds > 0 ? formatTime(editing.seconds) : "",
      }
      : { hippos: "", gators: "" },
  );
  const [lifts, setLifts] = useState<LiftRow[]>(() => {
    if (!editing || !editSide || editing.lifts.length === 0) return [blankLift()];
    return editing.lifts.map((lift) => ({
      ...blankLift(),
      ...toChoice(lift.name),
      [editSide]: {
        kg: displayLoad(lift.kg, weightUnit),
        sets: String(lift.sets ?? 1),
        reps: String(lift.reps),
        savedKg: lift.kg,
        advanced: Boolean(lift.detail?.length),
        detail: (lift.detail ?? []).map((set) => ({
          kg: displayLoad(set.kg, weightUnit),
          reps: String(set.reps),
          savedKg: set.kg,
        })),
      },
    }));
  });
  const [capHit, setCapHit] = useState<Record<Side, boolean>>(() => ({
    hippos: false,
    gators: false,
    ...(editing && editSide ? { [editSide]: Boolean(editing.capHit) } : {}),
  }));
  const [goal, setGoal] = useState(editing?.goal ? formatTime(editing.goal) : "");
  const fatigue = editing?.fatigue ?? 10;
  const transition = editing ? String(editing.transition) : "";
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState("");
  const [invalidSide, setInvalidSide] = useState<Side | null>(null);
  // Stable across attempts. The endpoint upserts on id, so a retry after a
  // half-failed save corrects the entry that landed rather than adding a
  // second one beside it. New ids only once the whole submit is through.
  const [draftIds, setDraftIds] = useState(() => ({
    hippos: newId(),
    gators: newId(),
  }));
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [listening, setListening] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const draftRequest = useRef<AbortController | null>(null);
  const columnKey = columns.join(",");
  // A response for the old athlete selection must never fill the new one.
  useEffect(() => () => { draftRequest.current?.abort(); }, [columnKey]);

  async function fillWorkout() {
    setDraftError("");
    setDraftNotice("");
    setDrafting(true);
    const controller = new AbortController();
    draftRequest.current = controller;
    try {
      const result = await api<{ draft: WorkoutDraft; provider?: string }>("/api/workout-draft", {
        method: "POST", signal: controller.signal,
        body: JSON.stringify({ description: description.trim(), athletes: columns, weightUnit: unit }),
      });
      if (controller.signal.aborted) return;
      const draft = alignWorkoutDraft(workoutDraftSchema.parse(result.draft));
      const string = (value: number | null) => value === null ? "" : String(value);
      const time = (value: number | null) => value === null || value === 0 ? "" : formatTime(value);
      const load = (value: number | null) => value === null ? "" : displayLoad(value, unit);
      // A matched ATHX station is the circuit's own row, including the standard
      // load when the description never named one.
      const asCircuit = (station: WorkoutDraft["stations"][number]) => {
        const circuit = METCON.find((item) => item.name === station.name);
        return Boolean(circuit) && station.block === "metcon" && circuit?.unit === station.unit;
      };
      const nextStations: Station[] = draft.stations.map(station => {
        const fixed = asCircuit(station);
        return {
          ...(fixed ? { name: station.name, custom: "" } : toChoice(station.name)),
          unit: station.unit, target: String(station.target), block: station.block, fixed,
        };
      });
      const nextEntries = (side: Side): Entry[] => draft.stations.map(station => {
        if (!columns.includes(side)) return blankEntry();
        const circuit = asCircuit(station) ? METCON.find((item) => item.name === station.name) : undefined;
        const prescribed = circuit?.kg?.[side];
        return {
          completed: string(station[side].completed), time: time(station[side].seconds),
          load: prescribed !== undefined && station[side].kg === null ? standardLoad(prescribed, unit) : load(station[side].kg),
          ...(prescribed !== undefined && station[side].kg === null
            ? { prefilled: true }
            : { savedKg: station[side].kg ?? undefined }),
        };
      });
      const nextLiftSide = (side: Side, lift: WorkoutDraft["lifts"][number]): LiftSide => {
        if (!columns.includes(side)) return blankLiftSide();
        const { detail = [], ...whole } = lift[side];
        // Sets that differed open a row each. Sets that were all the same are the one line.
        const same = detail.every(set => set.kg === detail[0].kg && set.reps === detail[0].reps);
        if (!same) return {
          kg: "", sets: "", reps: "", advanced: true,
          detail: detail.map(set => ({ kg: load(set.kg), reps: string(set.reps), savedKg: set.kg ?? undefined })),
        };
        const line = detail.length ? { kg: detail[0].kg, sets: detail.length, reps: detail[0].reps } : whole;
        return {
          kg: load(line.kg), sets: string(line.sets), reps: string(line.reps),
          savedKg: line.kg ?? undefined,
          advanced: false,
          detail: [],
        };
      };
      // The Endurance panel labels its boxes as a run. Other endurance activities
      // use Mixed so their names and units remain visible and editable.
      setCategory(draft.category === "Endurance" && draft.stations.some(s => s.name !== "Run" || !isDistanceUnit(s.unit))
        ? "Mixed" : draft.category);
      setTitle(draft.title);
      setCustomCategory(draft.customCategory);
      setStations(nextStations);
      setEntries({ hippos: nextEntries("hippos"), gators: nextEntries("gators") });
      setLifts(draft.lifts.length ? draft.lifts.map(lift => ({
        ...toChoice(lift.name), hippos: nextLiftSide("hippos", lift), gators: nextLiftSide("gators", lift),
      })) : [blankLift()]);
      setElapsed({
        hippos: columns.includes("hippos") ? time(draft.elapsed.hippos) : "",
        gators: columns.includes("gators") ? time(draft.elapsed.gators) : "",
      });
      setNotes([draft.notes, draft.assumptions].filter(Boolean).join("\n\n").slice(0, 2000));
      setGoal("");
      setCapHit({ hippos: false, gators: false });
      setInvalidSide(null);
      setError("");
      setDraftNotice(`Workout filled. Review the fields below before saving.${draft.assumptions ? ` ${draft.assumptions}` : ""}`);
    } catch (problem) {
      setDraftError(controller.signal.aborted
        ? "The athlete selection changed. Fill the workout again for the selected athletes."
        : message(problem));
    } finally {
      setDrafting(false);
      draftRequest.current = null;
    }
  }
  const elapsedRefs = useRef<Record<Side, HTMLInputElement | null>>({
    hippos: null,
    gators: null,
  });

  const { usesStations, usesLifts, usesCustomStations, isRun, isMixed } =
    categoryShape(category);
  // Whether the session has MetCon work to have been capped on.
  const hasMetcon = usesStations && stations.some((s) => s.block === "metcon") &&
    (category === "MetCon" || isMixed);

  /** Distance covered is the target: a run is measured, not chased. */
  const measured = (station: Station) =>
    isRun || (isMixed && station.block === "endurance");

  /**
   * A standard weight still sitting in its box is offered again on the new
   * unit's rack (35 lb becomes 15 kg, not 15.9); anything else converts.
   */
  function reunitEntry(entry: Entry, index: number, side: Side, next: WeightUnit): Entry {
    const kg = entry.prefilled ? circuitStation(stations[index] ?? { name: "" })?.kg?.[side] : undefined;
    if (kg) return { ...entry, load: standardLoad(kg, next) };
    return { ...entry, load: reunitLoad(entry.load, unit, next, entry.savedKg) };
  }

  /** A side's weights, including each advanced set, in the unit being switched to. */
  function reunitSide(side: LiftSide, next: WeightUnit): LiftSide {
    return {
      ...side,
      kg: reunitLoad(side.kg, unit, next, side.savedKg),
      detail: side.detail.map((set) => ({
        ...set,
        kg: reunitLoad(set.kg, unit, next, set.savedKg),
      })),
    };
  }

  /** Every weight box follows the switch, and the choice is remembered. */
  function changeUnit(next: WeightUnit) {
    if (next === unit) return;
    setLifts((current) =>
      current.map((lift) => ({
        ...lift,
        hippos: reunitSide(lift.hippos, next),
        gators: reunitSide(lift.gators, next),
      })),
    );
    setEntries((current) => ({
      hippos: current.hippos.map((e, i) => reunitEntry(e, i, "hippos", next)),
      gators: current.gators.map((e, i) => reunitEntry(e, i, "gators", next)),
    }));
    setUnit(next);
    onWeightUnit?.(next);
  }

  /** Changing the category reshapes the session, so rebuild its stations. */
  function changeCategory(next: Workout["category"]) {
    setCategory(next);
    const fresh = stationsFor(next);
    setStations(fresh);
    setEntries(entriesForBoth(fresh, unit));
  }

  /** Sets the shape and a usual duration; everything stays editable after. */
  function applyPreset(preset: (typeof PRESETS)[number]) {
    changeCategory(preset.category);
    setElapsed((current) => {
      const next = { ...current };
      for (const side of columns) next[side] = presetElapsed(current[side], preset);
      return next;
    });
    setTitle((current) => presetTitle(current, preset));
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

  /** A run's boxes follow the unit. 5 km becomes 3.11 mi, not 5 mi. */
  function changeDistanceUnit(index: number, next: DistanceUnit) {
    const station = stations[index];
    if (!station || station.unit === next) return;
    const from = station.unit;
    const convert = (text: string) =>
      isDistanceUnit(from) ? convertedDistance(text, from, next) : text;
    setStation(index, { unit: next, target: convert(station.target) });
    if (!isDistanceUnit(from)) return;
    setEntries((current) => ({
      hippos: current.hippos.map((entry, i) =>
        i === index ? { ...entry, completed: convert(entry.completed) } : entry,
      ),
      gators: current.gators.map((entry, i) =>
        i === index ? { ...entry, completed: convert(entry.completed) } : entry,
      ),
    }));
  }

  function addStations(added: Station[]) {
    setStations((current) => [...current, ...added]);
    setEntries((current) => ({
      hippos: [...current.hippos, ...entriesFor(added, "hippos", unit)],
      gators: [...current.gators, ...entriesFor(added, "gators", unit)],
    }));
  }

  function addStation(block: Block = "metcon") {
    addStations([
      block === "endurance"
        ? { name: "Run", custom: "", unit: "m", target: "", block }
        : { name: "", custom: "", unit: "reps", target: "", block },
    ]);
  }

  function removeStation(index: number) {
    setStations((current) => current.filter((_, i) => i !== index));
    setEntries((current) => ({
      hippos: current.hippos.filter((_, i) => i !== index),
      gators: current.gators.filter((_, i) => i !== index),
    }));
  }

  function setLift(index: number, side: Side, patch: Partial<LiftSide>) {
    setLifts((current) =>
      current.map((lift, i) =>
        // Editing the one-line boxes drops a breakdown, so Advanced rebuilds from them.
        i === index ? { ...lift, [side]: { ...lift[side], ...patch, detail: [] } } : lift,
      ),
    );
  }

  /** Open one row per set, or fold the rows back into the one-line boxes. */
  function toggleAdvanced(index: number, side: Side) {
    setLifts((current) =>
      current.map((lift, i) => {
        if (i !== index) return lift;
        const entry = lift[side];
        if (!entry.advanced) {
          const detail = entry.detail.length > 0
            ? entry.detail
            : Array.from({ length: seedCount(entry.sets) }, () => ({
                kg: entry.kg,
                reps: entry.reps,
                ...(entry.savedKg !== undefined ? { savedKg: entry.savedKg } : {}),
              }));
          return { ...lift, [side]: { ...entry, advanced: true, detail } };
        }
        const touched = entry.detail.some((set) => set.kg.trim() !== "" || set.reps.trim() !== "");
        if (!touched) return { ...lift, [side]: { ...entry, advanced: false, detail: [] } };
        const parsed = entry.detail.map((set) => ({
          kg: parseLoad(set.kg, unit, set.savedKg),
          // An empty rep box is one rep, the same as the one-line field.
          reps: set.reps.trim() === "" ? 1 : Math.round(num(set.reps)),
          text: set,
        }));
        // A half-filled breakdown stays open, so closing it cannot drop sets.
        if (!parsed.every((set) => set.kg !== null && set.reps >= 1)) return lift;
        const detail = parsed.map((set) => ({ kg: set.kg!, reps: set.reps }));
        const same = detail.every((set) => set.kg === detail[0].kg && set.reps === detail[0].reps);
        if (same) {
          return {
            ...lift,
            [side]: {
              ...entry,
              advanced: false,
              kg: entry.detail[0].kg,
              sets: String(detail.length),
              reps: String(detail[0].reps),
              savedKg: entry.detail[0].savedKg,
              detail: [],
            },
          };
        }
        const top = liftTop(detail);
        const match = parsed.find((set) => set.kg === top.kg && set.reps === top.reps)!;
        return {
          ...lift,
          [side]: {
            ...entry,
            advanced: false,
            kg: match.text.kg,
            sets: String(top.sets),
            reps: String(top.reps),
            savedKg: match.text.savedKg,
            detail: [],
          },
        };
      }),
    );
  }

  function setDetail(index: number, side: Side, setIndex: number, patch: Partial<SetDraft>) {
    setLifts((current) =>
      current.map((lift, i) => {
        if (i !== index) return lift;
        const detail = lift[side].detail.map((set, n) => (n === setIndex ? { ...set, ...patch } : set));
        return { ...lift, [side]: { ...lift[side], detail } };
      }),
    );
  }

  function addSet(index: number, side: Side) {
    setLifts((current) =>
      current.map((lift, i) => {
        if (i !== index || lift[side].detail.length >= 50) return lift;
        const last = lift[side].detail[lift[side].detail.length - 1] ?? blankSet();
        return { ...lift, [side]: { ...lift[side], detail: [...lift[side].detail, { ...last }] } };
      }),
    );
  }

  function removeSet(index: number, side: Side, setIndex: number) {
    setLifts((current) =>
      current.map((lift, i) => {
        if (i !== index) return lift;
        const detail = lift[side].detail.filter((_, n) => n !== setIndex);
        return { ...lift, [side]: { ...lift[side], detail: detail.length > 0 ? detail : [blankSet()] } };
      }),
    );
  }

  /**
   * Elapsed time is optional: a part-finished MetCon has a total anyway, which
   * is the time spent at the stations. Typing one still wins, because only you
   * know about the rest between them.
   */
  function totalFor(side: Side) {
    return sessionSeconds(elapsed[side], segmentsFor(side));
  }

  /** A column counts as used once anything at all is typed into it. */
  function used(side: Side) {
    if (elapsed[side].trim() !== "") return true;
    if (
      entries[side].some(
        // A standard weight the form filled in is not something you did.
        (e) =>
          e.completed.trim() !== "" ||
          e.time.trim() !== "" ||
          (!e.prefilled && e.load.trim() !== ""),
      )
    )
      return true;
    return lifts.some((lift) => {
      if (exerciseName(lift.name, lift.custom) === "") return false;
      const entry = lift[side];
      if (entry.advanced)
        return entry.detail.some((set) => set.kg.trim() !== "" || set.reps.trim() !== "");
      return entry.kg.trim() !== "" || entry.sets.trim() !== "" || entry.reps.trim() !== "";
    });
  }

  function segmentsFor(side: Side): Segment[] {
    if (!usesStations) return [];
    return stations
      .map((station, index) => {
        const entry = entries[side][index];
        const completed = num(entry.completed);
        // A run is measured, not chased: what you covered is the target.
        const target = measured(station) ? completed : num(station.target);
        // A standard weight left in the box of a station never reached was
        // not carried, so it is not recorded; one you typed always is.
        const offered = entry.prefilled && completed === 0;
        const kg =
          loadable(category, station) && !offered
            ? parseLoad(entry.load, unit, entry.savedKg)
            : null;
        const segment: Segment = {
          name: exerciseName(station.name, station.custom),
          unit: station.unit,
          completed,
          target,
          seconds: seconds(entry.time),
          block: station.block,
        };
        if (kg !== null) segment.kg = kg;
        return segment;
      })
      .filter((segment) => segment.name !== "");
  }

  function liftsFor(side: Side) {
    return lifts.flatMap((lift) => {
      const name = exerciseName(lift.name, lift.custom);
      if (name === "") return [];
      const entry = lift[side];
      if (entry.advanced) {
        if (!entry.detail.some((set) => set.kg.trim() !== "")) return [];
        // Entered in your unit, stored in kilograms. Validated before this runs.
        const detail = entry.detail.map((set) => ({
          kg: parseLoad(set.kg, unit, set.savedKg) ?? 0,
          reps: Math.round(num(set.reps) || 1),
        }));
        const same = detail.every((set) => set.kg === detail[0].kg && set.reps === detail[0].reps);
        if (same) return [{ name, kg: detail[0].kg, sets: detail.length, reps: detail[0].reps }];
        return [{ name, ...liftTop(detail), detail }];
      }
      if (entry.kg.trim() === "") return [];
      return [{
        name,
        kg: parseLoad(entry.kg, unit, entry.savedKg) ?? 0,
        sets: Math.round(num(entry.sets) || 1),
        reps: Math.round(num(entry.reps) || 1),
      }];
    });
  }


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
    if (total > 86400) return `${who}: that elapsed time is too long.`;

    for (const [index, station] of stations.entries()) {
      const name = exerciseName(station.name, station.custom);
      const typed = entries[side][index]?.load.trim() ?? "";
      if (name && loadable(category, station) && typed !== "" && parseLoad(typed, unit) === null)
        return `${who} · ${name}: write the load in ${unit}, or leave it empty.`;
    }

    for (const segment of segments) {
      const where = `${who} · ${segment.name}`;
      if (!Number.isFinite(segment.seconds))
        return `${where}: write the time as mm:ss.`;
      if (!(segment.target > 0))
        return isRun || (isMixed && segment.block === "endurance")
          ? `${where}: add the distance covered.`
          : `${where}: set a target above zero.`;
      if (segment.completed > segment.target)
        return `${where}: completed work is above the target.`;
      if (segment.completed === 0 && segment.seconds > 0)
        return `${where}: a time needs completed work with it.`;
      // The reverse is allowed: reps you did not time are still reps you did.
      // The projection needs the pace and quietly withholds itself without it.
    }
    if (segments.reduce((n, s) => n + s.seconds, 0) > total + 1)
      return `${who}: the station times add up to more than the elapsed time.`;

    for (const lift of lifts) {
      const entry = lift[side];
      const liftName = exerciseName(lift.name, lift.custom);
      if (entry.advanced) {
        const touched = entry.detail.some((set) => set.kg.trim() !== "" || set.reps.trim() !== "");
        if (!touched) continue;
        if (liftName === "") return `${who}: choose or name the exercise.`;
        for (const [index, set] of entry.detail.entries()) {
          const where = `${who} · ${liftName}, set ${index + 1}`;
          if (set.kg.trim() === "" && set.reps.trim() === "")
            return `${where}: add the load in ${unit}, or remove this set.`;
          if (parseLoad(set.kg, unit, set.savedKg) === null)
            return `${where}: add the load in ${unit}.`;
          if (set.reps.trim() !== "" && !(num(set.reps) >= 1))
            return `${where}: reps must be at least 1.`;
          // An empty rep box typed by hand is one rep. One the AI left empty was
          // never said, so it is asked for rather than saved as one.
          if (draftNotice && set.reps.trim() === "")
            return `${where}: fill in the missing reps, or remove this set before saving.`;
        }
        continue;
      }
      if (draftNotice && liftName !== "" &&
        [entry.kg, entry.sets, entry.reps].some(value => value.trim() !== "") &&
        [entry.kg, entry.sets, entry.reps].some(value => value.trim() === ""))
        return `${who} · ${liftName}: fill in the missing weight, sets and reps, or remove this lift before saving.`;
      if (entry.kg.trim() === "") continue;
      if (liftName === "") return `${who}: choose or name the exercise.`;
      if (parseLoad(entry.kg, unit, entry.savedKg) === null)
        return `${who} · ${liftName}: add the load in ${unit}.`;
      if (entry.sets.trim() !== "" && !(num(entry.sets) >= 1))
        return `${who} · ${liftName}: sets must be at least 1.`;
      if (entry.reps.trim() !== "" && !(num(entry.reps) >= 1))
        return `${who} · ${liftName}: reps must be at least 1.`;
    }
    return "";
  }

  /**
   * The numbers stay with the session when an edit names the other person.
   * Leaving them on the old side would open a blank column.
   */
  function relocate(from: Side, to: Side) {
    if (from === to) return;
    setElapsed((current) => ({ hippos: "", gators: "", [to]: current[from] }));
    setEntries((current) => {
      const moved = current[from].map((entry) => ({ ...entry }));
      const empty = () => current[from].map(() => blankEntry());
      return {
        hippos: to === "hippos" ? moved : empty(),
        gators: to === "gators" ? moved : empty(),
      };
    });
    setLifts((current) =>
      current.map((lift) => ({
        ...lift,
        hippos: to === "hippos" ? { ...lift[from] } : blankLiftSide(),
        gators: to === "gators" ? { ...lift[from] } : blankLiftSide(),
      })),
    );
    setCapHit((current) => ({ hippos: false, gators: false, [to]: current[from] }));
  }

  function chooseFormat(next: Format) {
    setInvalidSide(null);
    if (!editing || !editSide) {
      onLoggingFor(next === "pairs" ? "both" : next);
      return;
    }
    if (next === "pairs") {
      setRecordContext("pairs");
      return;
    }
    relocate(recordSide, next);
    setRecordSide(next);
    setRecordContext("solo");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (drafting || listening) return;
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
      ...(hasMetcon && capHit[side] ? { capHit: true } : {}),
      id: editing ? editing.id : draftIds[side],
      kind: "workout",
      athlete: editing ? athleteForEdit : side,
      day,
      title: title.trim() || dateTitle(day),
      category,
      customCategory: category === "Other" ? customCategory.trim() : "",
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
      await onSave(records);
      setDraftIds({ hippos: newId(), gators: newId() });
      const fresh = stationsFor(category);
      setTitle("");
      setElapsed({ hippos: "", gators: "" });
      setStations(fresh);
      setEntries(entriesForBoth(fresh, unit));
      setLifts([blankLift()]);
      setCapHit({ hippos: false, gators: false });
      setGoal("");
      setNotes("");
      setDescription("");
      setDraftNotice("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      {editing ? (
        <div
          {...athleteOutline(outline, "muted")}
          className="flex items-center justify-between gap-3 rounded-2xl border bg-muted/50 p-3"
        >
          <p className="text-xs">
            Editing{" "}
            <span className="font-medium">{ATHLETES[athleteForEdit].name}</span>
            {" · "}
            {day}
          </p>
          <Button type="button" variant="ghost" size="xs" onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      ) : null}
      <Panel outline={outline} title="Describe your workout" note="Type it or dictate it, then let AI fill the form.">
        <Field label="Workout description" hint="Sets × reps: 1 x 2 means 1 set of 2 reps. Include weights and units when you know them.">
          <Textarea value={description} maxLength={4000} rows={4} disabled={drafting || listening || saving}
            placeholder="Hippos: deadlift 3 x 5 at 185 lb, back squat 1 x 2 at 135 lb. Gators: deadlift 3 x 5 at 95 lb."
            onChange={event => setDescription(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-start gap-2">
          <Button type="button" size="sm" disabled={!grokReady || drafting || listening || saving || description.trim().length < 3}
            onClick={() => void fillWorkout()}>
            <Sparkles /> {drafting ? "Filling workout…" : "Fill workout with AI"}
          </Button>
          <WorkoutDictation value={description} onChange={setDescription} disabled={drafting || saving}
            listening={listening} onListening={setListening} />
        </div>
        <p className="text-xs text-muted-foreground">Fills the selected athletes and replaces the workout fields below. Nothing is saved until you choose {editing ? "Update session" : "Save session"}.</p>
        {!grokReady ? <p className="text-xs text-muted-foreground">Connect the estimator in Setup to fill workouts with AI.</p> : null}
        {drafting ? <p role="status" className="text-xs text-muted-foreground">AI is reading your workout. This can take about a minute.</p> : null}
        {draftNotice ? <p role="status" className="text-xs text-muted-foreground">{draftNotice}</p> : null}
        {draftError ? <p role="alert" className="text-sm text-destructive">{draftError}</p> : null}
      </Panel>
      <fieldset disabled={drafting || listening || saving} className="min-w-0 space-y-4">
      <section {...athleteOutline(outline)} className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <DayButtons today={today} day={day} onChange={setDay} />
        <FormatButtons value={format} onChange={chooseFormat} />
        <Field label="Session" hint="Optional — the date is used if left blank">
          <Input
            value={title}
            maxLength={120}
            placeholder={dateTitle(day)}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <div>
          <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Quick start
          </Label>
          <div
            role="group"
            aria-label="Session presets"
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${PRESETS.length}, minmax(0, 1fr))` }}
          >
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                aria-pressed={category === preset.category}
                className="rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors aria-pressed:bg-accent aria-pressed:font-semibold"
              >
                {preset.label}{" "}
                <span className="font-normal text-muted-foreground">
                  {preset.minutes}m
                </span>
              </button>
            ))}
          </div>
        </div>
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
        {category === "Other" ? (
          <Field label="What was it?" hint="Shown instead of “Other” in the log">
            <Input
              value={customCategory}
              maxLength={60}
              placeholder="Hiking, yoga, climbing…"
              onChange={(event) => setCustomCategory(event.target.value)}
            />
          </Field>
        ) : null}
        {usesLifts || hasMetcon ? (
          <div>
            <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Weights in
            </Label>
            <div
              role="group"
              aria-label="Weight unit"
              className="flex w-fit rounded-full bg-muted p-0.5"
            >
              {(["lb", "kg"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => changeUnit(option)}
                  aria-pressed={unit === option}
                  className="rounded-full px-4 py-1 text-xs font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <Panel
        outline={outline}
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
          outline={outline}
          title={isRun ? "Run" : isMixed ? "MetCon and endurance" : "Stations"}
          note={
            isRun
              ? "Distance covered and the time it took."
              : isMixed
                ? "Add whichever parts you did. Lifts go in their own panel below."
                : "What each of you actually completed, station by station. Stopping short is fine: log what you did."
          }
          action={
            isMixed ? (
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addStations(metconStations())}
                >
                  <Plus /> ATHX circuit
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addStation("metcon")}>
                  <Plus /> Station
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addStation("endurance")}
                >
                  <Plus /> Endurance
                </Button>
              </div>
            ) : usesCustomStations ? (
              <Button type="button" variant="outline" size="sm" onClick={() => addStation()}>
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
                  {station.fixed ? (
                    <div className="mb-2.5 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {index + 1}. {station.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Target {station.target} {station.unit}
                          {(() => {
                            const circuit = circuitStation(station);
                            const text = circuit ? metconLoadText(circuit, unit) : "";
                            return text ? ` · ${text}` : "";
                          })()}
                        </p>
                      </div>
                      {isMixed ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove station ${index + 1}`}
                          onClick={() => removeStation(index)}
                        >
                          <X />
                        </Button>
                      ) : null}
                    </div>
                  ) : isRun ? (
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">Distance and time</p>
                      <DistanceUnits
                        unit={station.unit}
                        onChange={(next) => changeDistanceUnit(index, next)}
                      />
                    </div>
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
                        {isMixed ? (
                          <Field label="Part" className="w-28">
                            <NativeSelect
                              size="sm"
                              value={station.block}
                              onChange={(event) => {
                                const block = event.target.value as Block;
                                if (block === "endurance" && !isDistanceUnit(station.unit)) {
                                  setStation(index, { block, unit: "m" });
                                  return;
                                }
                                if (block === "metcon" && isDistanceUnit(station.unit) && station.unit !== "m") {
                                  changeDistanceUnit(index, "m");
                                  setStation(index, { block });
                                  return;
                                }
                                setStation(index, { block });
                              }}
                            >
                              <NativeSelectOption value="metcon">MetCon</NativeSelectOption>
                              <NativeSelectOption value="endurance">Endurance</NativeSelectOption>
                            </NativeSelect>
                          </Field>
                        ) : null}
                        {measured(station) ? null : (
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
                        )}
                        {measured(station) ? (
                          <div className="flex-1">
                            <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                              Distance
                            </Label>
                            <DistanceUnits
                              unit={station.unit}
                              onChange={(next) => changeDistanceUnit(index, next)}
                            />
                          </div>
                        ) : (
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
                        )}
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
                          label={
                            isRun
                              ? `Distance (${station.unit})`
                              : measured(station)
                                ? `Covered (${station.unit})`
                                : `Done (${station.unit})`
                          }
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
                        {loadable(category, station) ? (
                          <Field label={`Load (${unit})`} hint="Optional">
                            <Input
                              value={entries[side][index]?.load ?? ""}
                              inputMode="decimal"
                              className="h-8"
                              aria-label={`${ATHLETES[side].name} ${exerciseName(station.name, station.custom) || `station ${index + 1}`} load`}
                              placeholder={(() => {
                                const kg = circuitStation(station)?.kg?.[side];
                                return kg ? displayLoad(kg, unit) : "";
                              })()}
                              onChange={(event) =>
                                setEntry(side, index, {
                                  load: event.target.value,
                                  prefilled: false,
                                })
                              }
                            />
                          </Field>
                        ) : null}
                      </Column>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasMetcon ? (
            <div className={`grid gap-2.5 ${columns.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {columns.map((side) => (
                <label
                  key={side}
                  className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs"
                  style={{ borderColor: `${ATHLETES[side].color}44` }}
                >
                  <input
                    type="checkbox"
                    checked={capHit[side]}
                    onChange={(event) =>
                      setCapHit((current) => ({ ...current, [side]: event.target.checked }))
                    }
                  />
                  {ATHLETES[side].name}: stopped at the time cap
                </label>
              ))}
            </div>
          ) : null}
        </Panel>
      ) : null}

      {usesLifts ? (
        <Panel
          outline={outline}
          title="Lifts"
          note="One weight for every set, or Advanced when the sets differ."
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
                    <LiftSets
                      key={side}
                      side={side}
                      entry={lift[side]}
                      unit={unit}
                      onToggle={() => toggleAdvanced(index, side)}
                      onSimple={(patch) => setLift(index, side, patch)}
                      onSet={(setIndex, patch) => setDetail(index, side, setIndex, patch)}
                      onAdd={() => addSet(index, side)}
                      onRemove={(setIndex) => removeSet(index, side, setIndex)}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}


      <section {...athleteOutline(outline)} className="rounded-2xl border bg-card p-4 sm:p-5">
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
      </fieldset>
    </form>
  );
}
