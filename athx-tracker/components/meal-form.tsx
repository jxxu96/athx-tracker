"use client";

import { useState } from "react";
import { Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/workout-form";
import { ATHLETES, type Macros, type Meal } from "@/lib/domain";
import { api, message, newId } from "@/lib/client";

const MACRO_FIELDS = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
] as const satisfies readonly { key: keyof Macros; label: string; unit: string }[];

const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;
const LIMITS: Macros = { calories: 20000, protein: 2000, carbs: 3000, fat: 2000 };

type MacroDraft = Record<keyof Macros, string>;
const emptyMacros: MacroDraft = { calories: "", protein: "", carbs: "", fat: "" };

type Estimate = Macros & {
  name: string;
  assumptions: string;
  confidence: "low" | "medium" | "high";
};

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; color?: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div
        role="group"
        aria-label={label}
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className="rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors aria-pressed:bg-accent aria-pressed:font-semibold"
            style={
              value === option.value && option.color
                ? { borderColor: option.color, color: option.color }
                : undefined
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MealForm({
  athlete,
  today,
  grokReady,
  editing,
  onAthlete,
  onCancelEdit,
  onSave,
}: {
  athlete: Meal["athlete"];
  today: string;
  grokReady: boolean;
  editing?: Meal | null;
  onAthlete: (next: Meal["athlete"]) => void;
  onCancelEdit?: () => void;
  onSave: (record: Meal) => Promise<void>;
}) {
  // Controlled by the switch in the header, so the two never disagree.
  const who = athlete;
  const setWho = onAthlete;
  const [day, setDay] = useState(editing?.day ?? today);
  const [slot, setSlot] = useState<Meal["meal"]>(editing?.meal ?? "Lunch");
  const [description, setDescription] = useState("");
  const [name, setName] = useState(editing?.name ?? "");
  const [macros, setMacros] = useState<MacroDraft>(() =>
    editing
      ? {
          calories: String(editing.macros.calories),
          protein: String(editing.macros.protein),
          carbs: String(editing.macros.carbs),
          fat: String(editing.macros.fat),
        }
      : emptyMacros,
  );
  const [assumptions, setAssumptions] = useState(editing?.assumptions ?? "");
  const [confidence, setConfidence] = useState<Estimate["confidence"] | null>(null);
  const [source, setSource] = useState<Meal["source"]>(editing?.source ?? "manual");
  const [adjusted, setAdjusted] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setDescription("");
    setName("");
    setMacros(emptyMacros);
    setAssumptions("");
    setConfidence(null);
    setSource("manual");
    setAdjusted(false);
  }

  async function estimate() {
    setError("");
    setEstimating(true);
    try {
      const { estimate } = await api<{ estimate: Estimate }>("/api/estimate", {
        method: "POST",
        body: JSON.stringify({ description: description.trim() }),
      });
      setName(estimate.name.slice(0, 300));
      setMacros({
        calories: String(Math.round(estimate.calories)),
        protein: String(Math.round(estimate.protein)),
        carbs: String(Math.round(estimate.carbs)),
        fat: String(Math.round(estimate.fat)),
      });
      setAssumptions(estimate.assumptions);
      setConfidence(estimate.confidence);
      setSource("grok");
      setAdjusted(false);
    } catch (problem) {
      setError(message(problem));
      // 503 means the estimator is down, not that the description is bad.
      setOffline((problem as Error & { status?: number }).status === 503);
    } finally {
      setEstimating(false);
    }
  }

  function setMacro(key: keyof Macros, value: string) {
    setMacros((current) => ({ ...current, [key]: value }));
    if (source === "grok") {
      setSource("manual");
      setAdjusted(true);
    }
  }

  /** Save now with the description kept, and let the worker fill the macros. */
  async function queueForLater() {
    const text = description.trim();
    if (text.length < 3) {
      setError("Describe the meal first, so it can be estimated later.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: editing ? editing.id : newId(),
        kind: "meal",
        athlete: who,
        day,
        name: name.trim() || text.slice(0, 60),
        meal: slot,
        macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
        source: "queued",
        assumptions: text.slice(0, 3000),
      });
      reset();
      setOffline(false);
    } finally {
      setSaving(false);
    }
  }

  function validate() {
    if (!name.trim()) return "Name the meal, or run an estimate first.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Pick a valid date.";
    for (const { key, label } of MACRO_FIELDS) {
      const raw = macros[key].trim();
      const value = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(value) || value < 0)
        return `${label} needs a number of zero or more.`;
      if (value > LIMITS[key]) return `${label} looks too high.`;
    }
    if (MACRO_FIELDS.every(({ key }) => (macros[key].trim() || "0") === "0"))
      return "Add at least one macro value.";
    return "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;

    const record: Meal = {
      id: editing ? editing.id : newId(),
      kind: "meal",
      athlete: who,
      day,
      name: name.trim(),
      meal: slot,
      macros: MACRO_FIELDS.reduce((out, { key }) => {
        out[key] = macros[key].trim() === "" ? 0 : Number(macros[key]);
        return out;
      }, {} as Macros),
      source,
      assumptions: assumptions.trim().slice(0, 3000),
    };

    setSaving(true);
    try {
      await onSave(record);
      reset();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      {editing ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border bg-muted/50 p-3">
          <p className="text-xs">
            Editing <span className="font-medium">{editing.name}</span>
          </p>
          <Button type="button" variant="ghost" size="xs" onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      ) : null}
      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <Choice
          label="Athlete"
          value={who}
          onChange={setWho}
          options={(["hippos", "gators"] as const).map((key) => ({
            value: key,
            label: ATHLETES[key].name,
            color: ATHLETES[key].color,
          }))}
        />
        <Choice
          label="Sitting"
          value={slot}
          onChange={setSlot}
          options={MEALS.map((value) => ({ value, label: value }))}
        />
        <Field label="Date">
          <Input
            type="date"
            value={day}
            max={today}
            onChange={(event) => setDay(event.target.value)}
          />
        </Field>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <div>
          <h3 className="text-sm font-semibold">Describe it</h3>
          <p className="text-[11px] text-muted-foreground">
            {grokReady
              ? "Grok reads the description and fills the macros. Check them before saving."
              : "Grok is not connected, so enter the macros yourself below."}
          </p>
        </div>
        <Textarea
          value={description}
          maxLength={4000}
          rows={3}
          placeholder="Two eggs, 80 g oats with milk, banana, flat white"
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={!grokReady || estimating || description.trim().length < 3}
          onClick={estimate}
        >
          <Sparkles />
          {estimating ? "Estimating…" : "Estimate macros"}
        </Button>
        {offline ? (
          <div className="rounded-xl bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">
              The estimator is not answering. Save the meal now and it will be
              estimated automatically once it is back.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              disabled={saving}
              onClick={queueForLater}
            >
              <Clock />
              {saving ? "Saving…" : "Save and estimate later"}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
        <Field label="Meal">
          <Input
            value={name}
            maxLength={300}
            placeholder="Oats, eggs and coffee"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {MACRO_FIELDS.map(({ key, label, unit }) => (
            <Field key={key} label={`${label} (${unit})`}>
              <Input
                value={macros[key]}
                inputMode="decimal"
                placeholder="0"
                onChange={(event) => setMacro(key, event.target.value)}
              />
            </Field>
          ))}
        </div>

        {confidence ? (
          <p className="text-xs text-muted-foreground">
            Grok confidence: <span className="font-medium">{confidence}</span>
            {adjusted ? " · saved as your own numbers after your edit" : null}
          </p>
        ) : null}

        {assumptions ? (
          <Field label="Assumptions">
            <Textarea
              value={assumptions}
              maxLength={3000}
              rows={3}
              onChange={(event) => setAssumptions(event.target.value)}
            />
          </Field>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? "Saving…" : editing ? "Update meal" : "Save meal"}
      </Button>
    </form>
  );
}
