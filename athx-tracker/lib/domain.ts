export type Athlete = "hippos" | "gators" | "team";
export type WeightUnit = "kg" | "lb";
export type Macros = { calories: number; protein: number; carbs: number; fat: number };
export type Segment = {
  name: string; unit: "reps" | "m" | "cal" | "rounds";
  completed: number; target: number; seconds: number;
};
export type Workout = {
  id: string; kind: "workout"; athlete: Athlete; day: string;
  title: string; category: "Strength" | "Endurance" | "MetCon" | "Other";
  seconds: number; notes: string; segments: Segment[]; fatigue: number;
  transition: number; goal: number | null; context: "solo" | "pairs";
  lifts: { name: string; kg: number; sets: number; reps: number }[];
};
export type Meal = {
  id: string; kind: "meal"; athlete: Exclude<Athlete, "team">; day: string;
  name: string; meal: "Breakfast" | "Lunch" | "Dinner" | "Snack";
  macros: Macros; source: "manual" | "grok" | "queued"; assumptions: string;
};
export type RecordItem = Workout | Meal;
export type Settings = {
  eventDate: string; eventName: string; weeklyTarget: number; weightUnit: WeightUnit;
  targets: { hippos: Macros; gators: Macros };
};
export const DEFAULT_SETTINGS: Settings = {
  eventDate: "2027-08-28", eventName: "ATHX New York", weeklyTarget: 4, weightUnit: "lb",
  targets: {
    hippos: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    gators: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  },
};
export const ATHLETES = {
  hippos: { name: "Hippos", label: "Female", color: "#bb4e79" },
  gators: { name: "Gators", label: "Male", color: "#287653" },
  team: { name: "Together", label: "Mixed doubles", color: "#235a43" },
};
export const METCON = [
  { name: "Opening row", target: 40, unit: "cal" as const, load: "Shared calories" },
  { name: "DB ground to overhead", target: 30, unit: "reps" as const, load: "Hippos 7.5 kg · Gators 15 kg" },
  { name: "DB bench press", target: 30, unit: "reps" as const, load: "Hippos 7.5 kg · Gators 15 kg / DB" },
  { name: "Sandbag squats", target: 30, unit: "reps" as const, load: "Hippos 20 kg · Gators 30 kg" },
  { name: "Sandbag carry", target: 60, unit: "m" as const, load: "30 m each · Hippos 20 kg · Gators 30 kg" },
  { name: "Burpees over bench", target: 30, unit: "reps" as const, load: "Step-overs permitted in Lite" },
  { name: "Closing row", target: 40, unit: "cal" as const, load: "Shared calories" },
];
export function localDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function formatTime(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
export function parseTime(text: string) {
  if (!/^\d{1,4}:[0-5]\d$/.test(text)) return NaN;
  const [m, s] = text.split(":").map(Number);
  return m * 60 + s;
}
/**
 * A workout-only scenario, not a physiological prediction.
 * Keeps observed time intact. Applies adjustable slowdown only to unperformed work.
 * An unobserved station cannot inherit the pace of another movement.
 */
export function projectWorkout(segments: Segment[], observedSeconds: number, fatiguePercent = 10, remainingTransition = 0) {
  if (!segments.length || !Number.isFinite(observedSeconds) || observedSeconds <= 0) return null;
  let remaining = 0, extrapolation = 0;
  for (const s of segments) {
    if (![s.target, s.completed, s.seconds].every(Number.isFinite) || s.target <= 0 || s.completed < 0 || s.completed > s.target || s.seconds < 0) return null;
    if (s.completed < s.target && (s.completed === 0 || s.seconds <= 0)) return null;
    if (s.completed > 0 && s.seconds <= 0) return null;
    remaining += s.completed < s.target ? s.seconds / s.completed * (s.target - s.completed) : 0;
    extrapolation += (s.target - s.completed) / s.target;
  }
  if (segments.reduce((n, s) => n + s.seconds, 0) > observedSeconds + 1) return null;
  const pending = remaining > 0;
  const rest = pending ? Math.max(0, remainingTransition) : 0;
  const allowance = Math.max(0, Math.min(50, fatiguePercent)) / 100;
  const base = observedSeconds + remaining + rest;
  return {
    linear: base,
    estimate: observedSeconds + remaining * (1 + allowance) + rest,
    upper: observedSeconds + remaining * (1 + Math.min(.75, allowance + .15)) + rest,
    coverage: Math.round((1 - extrapolation / segments.length) * 100),
    partial: pending,
  };
}
export function sumMacros(meals: Meal[]): Macros {
  return meals.reduce((out, m) => {
    for (const k of ["calories", "protein", "carbs", "fat"] as const) out[k] += m.macros[k];
    return out;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

/**
 * Loads are stored in kilograms whatever the display unit, so changing the unit
 * never rewrites a record and old entries stay valid.
 */
export const LB_PER_KG = 2.20462262;
export function toKilograms(value: number, unit: WeightUnit) {
  return unit === "lb" ? value / LB_PER_KG : value;
}
export function fromKilograms(value: number, unit: WeightUnit) {
  return unit === "lb" ? value * LB_PER_KG : value;
}
export function formatWeight(kg: number, unit: WeightUnit) {
  return `${Math.round(fromKilograms(kg, unit) * 10) / 10} ${unit}`;
}
