"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/workout-form";
import { toast } from "sonner";
import { api, formatDay, message, newId } from "@/lib/client";
import { currentBodyweight, type BodyweightHistory } from "@/lib/bodyweight";
import { ageOn, restingEnergy } from "@/lib/energy";
import { formatAmount } from "@/lib/fuel";
import { recordTargetChange } from "@/lib/targets";
import { FOOD_NOTES_LIMIT } from "@/lib/estimate-conversation";
import {
  ATHLETES,
  DEFAULT_SETTINGS,
  PROGRESS_LIFTS,
  SEX,
  clockTime,
  displayLoad,
  formatTime,
  fromKilograms,
  parseLoad,
  parseTime,
  reunitLoad,
  toKilograms,
  type Bodyweight,
  type LiftTargets,
  type Macros,
  type ProgressLift,
  type Settings,
  type WeightUnit,
} from "@/lib/domain";

const CM_PER_INCH = 2.54;
/** Height follows the weights: inches beside pounds, centimetres beside kilograms. */
const heightUnit = (unit: WeightUnit) => (unit === "lb" ? "in" : "cm");
const showHeight = (cm: number, unit: WeightUnit) =>
  cm > 0 ? String(Math.round((unit === "lb" ? cm / CM_PER_INCH : cm) * 10) / 10) : "";
const readHeight = (text: string, unit: WeightUnit) => {
  const value = Number(text.trim());
  return unit === "lb" ? value * CM_PER_INCH : value;
};

/** Keeps a typed weight meaning the same number of kilograms across a unit switch. */
function reunit(draft: string, from: WeightUnit, to: WeightUnit) {
  const value = Number(draft.trim());
  if (draft.trim() === "" || !Number.isFinite(value)) return draft;
  return String(Math.round(fromKilograms(toKilograms(value, from), to) * 10) / 10);
}

const MACRO_FIELDS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
] as const satisfies readonly { key: keyof Macros; label: string; unit: string }[];

const LIMITS: Macros = { calories: 20000, protein: 2000, carbs: 3000, fat: 2000 };

type MacroDraft = Record<keyof Macros, string>;
type LiftDraft = Record<ProgressLift, string>;
const eachLift = <T,>(value: (key: ProgressLift) => T) =>
  Object.fromEntries(PROGRESS_LIFTS.map(({ key }) => [key, value(key)])) as Record<
    ProgressLift,
    T
  >;
const toDraft = (macros: Macros): MacroDraft => ({
  calories: String(macros.calories),
  protein: String(macros.protein),
  carbs: String(macros.carbs),
  fat: String(macros.fat),
});

export function SettingsForm({
  settings,
  history,
  today,
  grokReady,
  onRefresh,
  onSave,
  onDirty,
}: {
  settings: Settings;
  /** The weigh-ins, whose latest is the bodyweight shown here. */
  history: BodyweightHistory;
  today: string;
  grokReady: boolean;
  onRefresh: () => Promise<void>;
  /** A changed bodyweight is a weigh-in today, saved with the settings. */
  onSave: (next: Settings, notice?: string, weighIns?: Bodyweight[]) => Promise<void>;
  /** Whether anything has been typed, so a refresh can leave the form alone. */
  onDirty?: (dirty: boolean) => void;
}) {
  // A form keyed on the settings revision starts clean, and leaving it drops
  // what was typed, so it is only dirty while it is open.
  useEffect(() => () => onDirty?.(false), [onDirty]);
  /** The weight shown for an athlete: the latest weigh-in, or Setup's undated one. */
  const latestKg = (athlete: "hippos" | "gators") =>
    currentBodyweight(history, athlete)?.kg ?? settings.bodyweight?.[athlete] ?? 0;
  const [eventName, setEventName] = useState(settings.eventName);
  const [eventDate, setEventDate] = useState(settings.eventDate);
  const [weeklyTarget, setWeeklyTarget] = useState(String(settings.weeklyTarget));
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(
    settings.weightUnit ?? "lb",
  );
  const [targets, setTargets] = useState<Record<"hippos" | "gators", MacroDraft>>({
    hippos: toDraft(settings.targets.hippos),
    gators: toDraft(settings.targets.gators),
  });
  const [bodyweight, setBodyweight] = useState<Record<"hippos" | "gators", string>>(
    () => {
      const unit = settings.weightUnit ?? "lb";
      const show = (kg: number) =>
        kg > 0 ? String(Math.round(fromKilograms(kg, unit) * 10) / 10) : "";
      return { hippos: show(latestKg("hippos")), gators: show(latestKg("gators")) };
    },
  );
  const [height, setHeight] = useState<Record<"hippos" | "gators", string>>(() => {
    const unit = settings.weightUnit ?? "lb";
    return {
      hippos: showHeight(settings.height?.hippos ?? 0, unit),
      gators: showHeight(settings.height?.gators ?? 0, unit),
    };
  });
  const [birthYear, setBirthYear] = useState<Record<"hippos" | "gators", string>>(() => ({
    hippos: settings.birthYear?.hippos ? String(settings.birthYear.hippos) : "",
    gators: settings.birthYear?.gators ? String(settings.birthYear.gators) : "",
  }));
  // Settings saved before lift targets existed have none stored. Progress
  // shows the defaults for them, so this starts from the same numbers.
  const savedLifts = settings.liftTargets ?? DEFAULT_SETTINGS.liftTargets;
  const [liftTargets, setLiftTargets] = useState<Record<"hippos" | "gators", LiftDraft>>(
    () => {
      const unit = settings.weightUnit ?? "lb";
      const show = (targets: LiftTargets) =>
        eachLift((key) => (targets[key] > 0 ? displayLoad(targets[key], unit) : ""));
      return { hippos: show(savedLifts.hippos), gators: show(savedLifts.gators) };
    },
  );
  // Strength is in kilograms whatever the unit, as the race estimate shows it.
  const [raceGoals, setRaceGoals] = useState(() => {
    const goals = settings.raceGoals ?? DEFAULT_SETTINGS.raceGoals!;
    return {
      strength: goals.strength > 0 ? String(goals.strength) : "",
      endurance: goals.endurance > 0 ? String(goals.endurance) : "",
      metcon: goals.metcon > 0 ? formatTime(goals.metcon) : "",
    };
  });
  const [foodNotes, setFoodNotes] = useState(settings.foodNotes ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<{ status: string; detail: string } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  /** The journal is one file on someone else's machine. Take a copy. */
  async function exportJournal() {
    setBusy("export");
    setNote("");
    try {
      const [entries, config] = await Promise.all([
        api<{ records: unknown[] }>("/api/records"),
        api<{ settings: Settings }>("/api/settings"),
      ]);
      const payload = JSON.stringify(
        {
          app: "athx-tracker",
          version: 1,
          exportedAt: new Date().toISOString(),
          settings: config.settings,
          records: entries.records,
        },
        null,
        2,
      );
      const url = URL.createObjectURL(
        new Blob([payload], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `athx-journal-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNote(`${entries.records.length} entries downloaded.`);
    } catch (problem) {
      setNote(message(problem));
    } finally {
      setBusy("");
    }
  }

  /** Records upsert by id, so restoring the same file twice is harmless. */
  async function importJournal(file: File) {
    setBusy("import");
    setNote("");
    try {
      const parsed = JSON.parse(await file.text()) as {
        records?: unknown;
        settings?: unknown;
      };
      const records = Array.isArray(parsed.records) ? parsed.records : [];
      if (records.length === 0) {
        toast.error("No entries found in that file.");
        return;
      }
      let restored = 0;
      let rejected = 0;
      for (const record of records) {
        try {
          await api("/api/records", {
            method: "POST",
            body: JSON.stringify(record),
          });
          restored += 1;
        } catch {
          rejected += 1;
        }
      }
      // An export carries the settings as well. Putting the entries back and
      // silently dropping the targets, bodyweights and event date would be a
      // backup that only half works, discovered at the worst moment.
      let settingsRestored = false;
      if (parsed.settings) {
        try {
          const current = await api<{ revision: number }>("/api/settings");
          await api("/api/settings", {
            method: "PUT",
            body: JSON.stringify({
              settings: parsed.settings,
              revision: current.revision,
            }),
          });
          settingsRestored = true;
        } catch {
          // Entries matter more; say what happened rather than failing it all.
        }
      }
      // A toast, not the note below: restoring the settings bumps the revision
      // this form is keyed on, so it remounts and anything held here is lost.
      toast.success(
        `${restored} restored${rejected ? `, ${rejected} rejected as invalid` : ""}` +
          `${settingsRestored ? ", settings too" : parsed.settings ? ", but the settings would not restore" : ""}.`,
      );
      await onRefresh();
    } catch {
      toast.error("That file could not be read as a journal export.");
    } finally {
      setBusy("");
    }
  }

  /**
   * Reachable and working are different things, and this has only ever failed
   * at the second. The old test asked whether the estimator answers, which it
   * does, and then said it was fine. It runs a real meal through now, so the
   * reason a CLI failed lands here instead of in a log on the server.
   */
  async function testConnection() {
    setTesting(true);
    setProbe(null);
    try {
      const reach = await api<{ status: string; detail: string }>("/api/estimate");
      if (reach.status !== "ready") {
        setProbe(reach);
        return;
      }
      const { estimate } = await api<{ estimate: { calories: number } }>(
        "/api/estimate",
        {
          method: "POST",
          body: JSON.stringify({ description: "one medium banana" }),
        },
      );
      setProbe({
        status: "ready",
        detail: `Working. A test banana came back as ${Math.round(estimate.calories)} kcal.`,
      });
    } catch (problem) {
      setProbe({ status: "error", detail: message(problem) });
    } finally {
      setTesting(false);
    }
  }

  /** A lift target box in kilograms: zero for none, null when it is not a weight. */
  function liftKg(athlete: "hippos" | "gators", key: ProgressLift) {
    const raw = liftTargets[athlete][key].trim();
    if (raw === "" || Number(raw) === 0) return 0;
    return parseLoad(raw, weightUnit, savedLifts[athlete][key]);
  }

  /** Race goals as stored: kilograms, metres and seconds, zero for none, NaN when unreadable. */
  function goalsFrom() {
    const amount = (text: string) => (text.trim() === "" ? 0 : Number(text.trim().replace(/,/g, "")));
    const time = raceGoals.metcon.trim();
    return {
      strength: amount(raceGoals.strength),
      endurance: amount(raceGoals.endurance),
      metcon: time === "" ? 0 : parseTime(time),
    };
  }

  function validate() {
    if (!eventName.trim()) return "Name the event.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return "Pick a valid event date.";
    const weekly = Number(weeklyTarget);
    if (!Number.isInteger(weekly) || weekly < 1 || weekly > 21)
      return "Set a weekly session target between 1 and 21.";
    for (const athlete of ["hippos", "gators"] as const) {
      const raw = bodyweight[athlete].trim();
      if (raw !== "") {
        const kg = toKilograms(Number(raw), weightUnit);
        if (!Number.isFinite(kg) || kg <= 0 || kg > 500)
          return `${ATHLETES[athlete].name} bodyweight needs a sensible number, or nothing at all.`;
      }
      if (height[athlete].trim() !== "") {
        const cm = readHeight(height[athlete], weightUnit);
        if (!Number.isFinite(cm) || cm < 50 || cm > 300)
          return `${ATHLETES[athlete].name} height needs a sensible number, or nothing at all.`;
      }
      if (birthYear[athlete].trim() !== "") {
        const year = Number(birthYear[athlete].trim());
        if (!Number.isInteger(year) || year < 1900 || year > Number(today.slice(0, 4)) - 5)
          return `${ATHLETES[athlete].name} birth year needs four digits, or nothing at all.`;
      }
      for (const { key, label } of MACRO_FIELDS) {
        const value = Number(targets[athlete][key].trim() || "0");
        if (!Number.isFinite(value) || value < 0)
          return `${ATHLETES[athlete].name} ${label.toLowerCase()} needs a number of zero or more.`;
        if (value > LIMITS[key])
          return `${ATHLETES[athlete].name} ${label.toLowerCase()} looks too high.`;
      }
      for (const { key, name } of PROGRESS_LIFTS) {
        const kg = liftKg(athlete, key);
        if (kg === null)
          return `${ATHLETES[athlete].name} ${name.toLowerCase()} target needs a weight, or nothing at all.`;
        if (kg > 1000)
          return `${ATHLETES[athlete].name} ${name.toLowerCase()} target looks too high.`;
      }
    }
    const goals = goalsFrom();
    if (!Number.isFinite(goals.strength) || goals.strength < 0 || goals.strength > 2000)
      return "Strength goal needs kilograms, or nothing at all.";
    if (!Number.isFinite(goals.endurance) || goals.endurance < 0 || goals.endurance > 20000)
      return "Endurance goal needs metres, or nothing at all.";
    if (!Number.isFinite(goals.metcon) || goals.metcon > 3600)
      return "MetCon X goal needs a time like 14:30, or nothing at all.";
    return "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;

    const macrosFor = (athlete: "hippos" | "gators") =>
      MACRO_FIELDS.reduce((out, { key }) => {
        out[key] = Number(targets[athlete][key].trim() || "0");
        return out;
      }, {} as Macros);

    const liftsFor = (athlete: "hippos" | "gators") =>
      eachLift((key) => liftKg(athlete, key) ?? 0);

    /**
     * A new bodyweight is a weigh-in today, so the sessions before it keep
     * the weight they were done at. Setup's undated weight stays what it was
     * for every day before the first weigh-in; only with no weigh-ins at all
     * does clearing the box clear it.
     */
    const weighIns: Bodyweight[] = [];
    const baseline = { ...(settings.bodyweight ?? { hippos: 0, gators: 0 }) };
    for (const athlete of ["hippos", "gators"] as const) {
      const raw = bodyweight[athlete].trim();
      if (raw === "") {
        if (!currentBodyweight(history, athlete)) baseline[athlete] = 0;
        continue;
      }
      const kg = toKilograms(Number(raw), weightUnit);
      // The box shows a weight rounded to a tenth; that is not a new weight.
      if (Math.abs(kg - latestKg(athlete)) < 0.05) continue;
      weighIns.push({
        id: newId(),
        kind: "bodyweight",
        athlete,
        day: today,
        time: clockTime(),
        kg: Math.round(kg * 100) / 100,
      });
    }

    const nextTargets = { hippos: macrosFor("hippos"), gators: macrosFor("gators") };
    const pastTargets = settings.targetHistory ?? { hippos: [], gators: [] };
    const yearFor = (athlete: "hippos" | "gators") =>
      birthYear[athlete].trim() === "" ? 0 : Number(birthYear[athlete].trim());
    const heightFor = (athlete: "hippos" | "gators") =>
      height[athlete].trim() === "" ? 0 : Math.round(readHeight(height[athlete], weightUnit) * 10) / 10;

    setSaving(true);
    try {
      await onSave(
        {
          eventName: eventName.trim(),
          eventDate,
          weeklyTarget: Number(weeklyTarget),
          weightUnit,
          targets: nextTargets,
          // A day already passed keeps the targets it was judged against.
          targetHistory: {
            hippos: recordTargetChange(pastTargets.hippos, settings.targets.hippos, nextTargets.hippos, today),
            gators: recordTargetChange(pastTargets.gators, settings.targets.gators, nextTargets.gators, today),
          },
          bodyweight: baseline,
          height: { hippos: heightFor("hippos"), gators: heightFor("gators") },
          birthYear: { hippos: yearFor("hippos"), gators: yearFor("gators") },
          liftTargets: {
            hippos: liftsFor("hippos"),
            gators: liftsFor("gators"),
          },
          raceGoals: goalsFrom(),
          foodNotes: foodNotes.trim(),
          mealTemplates: settings.mealTemplates ?? { hippos: [], gators: [] },
        },
        undefined,
        weighIns,
      );
    } finally {
      setSaving(false);
    }
  }

  /** Resting energy from what is in the boxes, so the figure answers as you type. */
  function restingFor(athlete: "hippos" | "gators") {
    const kg = bodyweight[athlete].trim() === "" ? 0 : toKilograms(Number(bodyweight[athlete]), weightUnit);
    const cm = height[athlete].trim() === "" ? 0 : readHeight(height[athlete], weightUnit);
    const year = Number(birthYear[athlete].trim() || 0);
    if (![kg, cm, year].every(Number.isFinite)) return null;
    return restingEnergy({ kg, cm, age: ageOn(year, today), sex: SEX[athlete] });
  }

  /** Where the bodyweight shown came from. */
  function weightHint(athlete: "hippos" | "gators") {
    const latest = currentBodyweight(history, athlete);
    if (latest) return `Last weighed ${formatDay(latest.day, today)}. A new weight is logged as a weigh-in today.`;
    return "A new weight is logged as a weigh-in today, so earlier sessions keep theirs.";
  }

  return (
    <form onSubmit={submit} onChange={() => onDirty?.(true)} className="space-y-4 pb-4">
      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <h3 className="text-sm font-semibold">The event</h3>
        <Field label="Name">
          <Input
            value={eventName}
            maxLength={100}
            onChange={(event) => setEventName(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input
              type="date"
              value={eventDate}
              onChange={(event) => setEventDate(event.target.value)}
            />
          </Field>
          <Field label="Sessions a week" hint="Per athlete">
            <Input
              value={weeklyTarget}
              inputMode="numeric"
              onChange={(event) => setWeeklyTarget(event.target.value)}
            />
          </Field>
        </div>
        <div>
          <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Weights in
          </Label>
          <div role="group" className="flex w-fit rounded-full bg-muted p-0.5">
            {(["lb", "kg"] as const).map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() => {
                  if (unit === weightUnit) return;
                  onDirty?.(true);
                  setHeight((current) => ({
                    hippos: current.hippos.trim() === "" ? "" : showHeight(readHeight(current.hippos, weightUnit), unit),
                    gators: current.gators.trim() === "" ? "" : showHeight(readHeight(current.gators, weightUnit), unit),
                  }));
                  setBodyweight((current) => ({
                    hippos: reunit(current.hippos, weightUnit, unit),
                    gators: reunit(current.gators, weightUnit, unit),
                  }));
                  setLiftTargets((current) => ({
                    hippos: eachLift((key) =>
                      reunitLoad(current.hippos[key], weightUnit, unit, savedLifts.hippos[key]),
                    ),
                    gators: eachLift((key) =>
                      reunitLoad(current.gators[key], weightUnit, unit, savedLifts.gators[key]),
                    ),
                  }));
                  setWeightUnit(unit);
                }}
                aria-pressed={weightUnit === unit}
                className="rounded-full px-4 py-1 text-xs font-medium transition-colors aria-pressed:bg-background aria-pressed:shadow-sm"
              >
                {unit}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Loads are always stored in kilograms, so switching never changes a
            recorded lift.
          </p>
        </div>
      </section>

      {(["hippos", "gators"] as const).map((athlete) => (
        <section
          key={athlete}
          className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span
              className="size-2.5 rounded-full"
              style={{ background: ATHLETES[athlete].color }}
            />
            {ATHLETES[athlete].name} daily targets
          </h3>
          <Field label={`Bodyweight (${weightUnit})`} hint={weightHint(athlete)}>
            <Input
              value={bodyweight[athlete]}
              inputMode="decimal"
              placeholder="Not set"
              onChange={(event) =>
                setBodyweight((current) => ({
                  ...current,
                  [athlete]: event.target.value,
                }))
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Height (${heightUnit(weightUnit)})`}>
              <Input
                value={height[athlete]}
                inputMode="decimal"
                placeholder="Not set"
                onChange={(event) =>
                  setHeight((current) => ({ ...current, [athlete]: event.target.value }))
                }
              />
            </Field>
            <Field label="Birth year">
              <Input
                value={birthYear[athlete]}
                inputMode="numeric"
                placeholder="Not set"
                maxLength={4}
                onChange={(event) =>
                  setBirthYear((current) => ({ ...current, [athlete]: event.target.value }))
                }
              />
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {restingFor(athlete) !== null
              ? `Resting energy ~${formatAmount(Math.round(restingFor(athlete)! / 10) * 10)} kcal a day (Mifflin–St Jeor, ${SEX[athlete]}). Fuel adds training to it.`
              : "With bodyweight, height and birth year, Fuel counts resting energy as well as training."}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MACRO_FIELDS.map(({ key, label, unit }) => (
              <Field key={key} label={`${label} (${unit})`}>
                <Input
                  value={targets[athlete][key]}
                  inputMode="decimal"
                  onChange={(event) =>
                    setTargets((current) => ({
                      ...current,
                      [athlete]: { ...current[athlete], [key]: event.target.value },
                    }))
                  }
                />
              </Field>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Leave a target at zero to hide its progress bar.
          </p>
        </section>
      ))}

      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <div>
          <h3 className="text-sm font-semibold">Lift targets</h3>
          <p className="text-[11px] text-muted-foreground">
            What Progress measures each lift against. Leave one blank for no target.
          </p>
        </div>
        {(["hippos", "gators"] as const).map((athlete) => (
          <fieldset key={athlete} className="space-y-3">
            <legend className="flex items-center gap-2 text-xs font-semibold">
              <span
                className="size-2.5 rounded-full"
                style={{ background: ATHLETES[athlete].color }}
              />
              {ATHLETES[athlete].name}
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PROGRESS_LIFTS.map(({ key, name }) => (
                <Field key={key} label={`${name} (${weightUnit})`}>
                  <Input
                    value={liftTargets[athlete][key]}
                    inputMode="decimal"
                    placeholder="Not set"
                    onChange={(event) =>
                      setLiftTargets((current) => ({
                        ...current,
                        [athlete]: { ...current[athlete], [key]: event.target.value },
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        ))}
      </section>

      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <div>
          <h3 className="text-sm font-semibold">Race goals</h3>
          <p className="text-[11px] text-muted-foreground">
            What the pair is aiming for in each zone. Today measures progress from your first
            estimate to these. Leave one blank for no goal.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(
            [
              { key: "strength", label: "Strength (kg, combined)", mode: "decimal", placeholder: "Not set" },
              { key: "endurance", label: "Endurance (m SkiErg)", mode: "numeric", placeholder: "Not set" },
              { key: "metcon", label: "MetCon X (m:ss)", mode: "text", placeholder: "Not set" },
            ] as const
          ).map(({ key, label, mode, placeholder }) => (
            <Field key={key} label={label}>
              <Input
                value={raceGoals[key]}
                inputMode={mode}
                placeholder={placeholder}
                onChange={(event) =>
                  setRaceGoals((current) => ({ ...current, [key]: event.target.value }))
                }
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <div>
          <h3 className="text-sm font-semibold">Food notes</h3>
          <p className="text-[11px] text-muted-foreground">
            Foods you eat often: a usual order, which product you mean, or its
            label. Every meal estimate reads these, and uses a note only when
            the meal mentions that food. Shared by both of you.
          </p>
        </div>
        <Field label="Notes" hint={`${foodNotes.length}/${FOOD_NOTES_LIMIT}`}>
          <Textarea
            value={foodNotes}
            maxLength={FOOD_NOTES_LIMIT}
            rows={6}
            placeholder={"Yogurt means Fage Total 0% plain, 170 g cup\nCava: greens + grains bowl, chicken, hummus, no pita"}
            onChange={(event) => setFoodNotes(event.target.value)}
          />
        </Field>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? "Saving…" : "Save settings"}
      </Button>

      <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <div>
          <h3 className="text-sm font-semibold">Your data</h3>
          <p className="text-[11px] text-muted-foreground">
            The journal is a single file on the server. Keep a copy somewhere you
            control — restoring the same file twice is harmless.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== ""}
            onClick={exportJournal}
          >
            <Download />
            {busy === "export" ? "Preparing…" : "Download journal"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== ""}
            onClick={() => fileRef.current?.click()}
          >
            <Upload />
            {busy === "import" ? "Restoring…" : "Restore"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importJournal(file);
            }}
          />
        </div>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4 text-xs text-muted-foreground sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>
            Meal estimates:{" "}
            <span className="font-medium text-foreground">
              {grokReady ? "configured" : "not configured"}
            </span>
            {grokReady ? "" : ". Macros are entered by hand."}
          </p>
          {grokReady ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={testing}
              onClick={testConnection}
            >
              {testing ? "Testing…" : "Test"}
            </Button>
          ) : null}
        </div>
        {grokReady ? (
          <p className="text-[11px]">
            The test estimates a real meal, so it says why a provider failed
            rather than only whether it answered. A failed one costs nothing; a
            successful one uses a single estimate from the day&apos;s sixty.
          </p>
        ) : null}
        {probe ? (
          <p
            className={probe.status === "ready" ? "text-foreground" : "text-destructive"}
          >
            {probe.detail}
          </p>
        ) : null}
        <p>
          Everything you log is shared between the two of you and stored with this
          site.
        </p>
        <form action="/logout" method="post">
          <button
            type="submit"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign out
          </button>
        </form>
      </section>
    </form>
  );
}
