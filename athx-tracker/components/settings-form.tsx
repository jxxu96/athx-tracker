"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/workout-form";
import {
  ATHLETES,
  type Macros,
  type Settings,
} from "@/lib/domain";

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
  signOutPath,
  onSave,
}: {
  settings: Settings;
  grokReady: boolean;
  signOutPath: string;
  onSave: (next: Settings) => Promise<void>;
}) {
  const [eventName, setEventName] = useState(settings.eventName);
  const [eventDate, setEventDate] = useState(settings.eventDate);
  const [weeklyTarget, setWeeklyTarget] = useState(String(settings.weeklyTarget));
  const [targets, setTargets] = useState<Record<"hippos" | "gators", MacroDraft>>({
    hippos: toDraft(settings.targets.hippos),
    gators: toDraft(settings.targets.gators),
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function validate() {
    if (!eventName.trim()) return "Name the event.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return "Pick a valid event date.";
    const weekly = Number(weeklyTarget);
    if (!Number.isInteger(weekly) || weekly < 1 || weekly > 21)
      return "Set a weekly session target between 1 and 21.";
    for (const athlete of ["hippos", "gators"] as const) {
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

    setSaving(true);
    try {
      await onSave({
        eventName: eventName.trim(),
        eventDate,
        weeklyTarget: Number(weeklyTarget),
        targets: { hippos: macrosFor("hippos"), gators: macrosFor("gators") },
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

      <section className="space-y-3 rounded-2xl border bg-card p-4 text-xs text-muted-foreground sm:p-5">
        <p>
          Meal estimates:{" "}
          <span className="font-medium text-foreground">
            {grokReady ? "Grok connected" : "not connected"}
          </span>
          . {grokReady ? "" : "Macros can still be entered by hand."}
        </p>
        <p>
          Everything you log is shared between the two of you and stored with this
          site.
        </p>
        <a
          href={signOutPath}
          target="_top"
          className="inline-block font-medium text-foreground underline underline-offset-4"
        >
          Sign out
        </a>
      </section>
    </form>
  );
}
