"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/workout-form";
import { toast } from "sonner";
import { api, message } from "@/lib/client";
import {
  ATHLETES,
  fromKilograms,
  toKilograms,
  type Macros,
  type Settings,
  type WeightUnit,
} from "@/lib/domain";

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
const toDraft = (macros: Macros): MacroDraft => ({
  calories: String(macros.calories),
  protein: String(macros.protein),
  carbs: String(macros.carbs),
  fat: String(macros.fat),
});

export function SettingsForm({
  settings,
  grokReady,
  onRefresh,
  onSave,
}: {
  settings: Settings;
  grokReady: boolean;
  onRefresh: () => Promise<void>;
  onSave: (next: Settings) => Promise<void>;
}) {
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
      const stored = settings.bodyweight ?? { hippos: 0, gators: 0 };
      const show = (kg: number) =>
        kg > 0 ? String(Math.round(fromKilograms(kg, unit) * 10) / 10) : "";
      return { hippos: show(stored.hippos), gators: show(stored.gators) };
    },
  );
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
      for (const { key, label } of MACRO_FIELDS) {
        const value = Number(targets[athlete][key].trim() || "0");
        if (!Number.isFinite(value) || value < 0)
          return `${ATHLETES[athlete].name} ${label.toLowerCase()} needs a number of zero or more.`;
        if (value > LIMITS[key])
          return `${ATHLETES[athlete].name} ${label.toLowerCase()} looks too high.`;
      }
    }
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

    const weightFor = (athlete: "hippos" | "gators") => {
      const raw = bodyweight[athlete].trim();
      return raw === "" ? 0 : toKilograms(Number(raw), weightUnit);
    };

    setSaving(true);
    try {
      await onSave({
        eventName: eventName.trim(),
        eventDate,
        weeklyTarget: Number(weeklyTarget),
        weightUnit,
        targets: { hippos: macrosFor("hippos"), gators: macrosFor("gators") },
        bodyweight: {
          hippos: weightFor("hippos"),
          gators: weightFor("gators"),
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
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
                  setBodyweight((current) => ({
                    hippos: reunit(current.hippos, weightUnit, unit),
                    gators: reunit(current.gators, weightUnit, unit),
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
          <Field
            label={`Bodyweight (${weightUnit})`}
            hint="Used to estimate calories burned"
          >
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
