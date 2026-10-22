export type Athlete = "hippos" | "gators" | "team";
export type WeightUnit = "kg" | "lb";
export type Macros = { calories: number; protein: number; carbs: number; fat: number };
export type Segment = {
  name: string; unit: "reps" | "m" | "cal" | "rounds";
  completed: number; target: number; seconds: number;
};
export type Workout = {
  id: string; kind: "workout"; athlete: Athlete; day: string;
  title: string; category: "Strength" | "Endurance" | "MetCon" | "Solidcore" | "Tennis" | "Other";
  /** What "Other" actually was. Empty for every other category. */
  customCategory: string;
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
  /** Kilograms, like every other weight here. Zero means not given yet. */
  bodyweight: { hippos: number; gators: number };
};
export const DEFAULT_SETTINGS: Settings = {
  eventDate: "2027-08-28", eventName: "ATHX New York", weeklyTarget: 4, weightUnit: "lb",
  targets: {
    hippos: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    gators: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  },
  bodyweight: { hippos: 0, gators: 0 },
};
/**
 * color identifies the athlete on dots and bars. ink is the same colour made
 * readable against whichever theme is on, for anywhere it becomes text.
 */
export const ATHLETES = {
  hippos: {
    name: "Hippos", label: "Female",
    color: "#bb4e79", ink: "var(--athlete-hippos-ink)",
  },
  gators: {
    name: "Gators", label: "Male",
    color: "#287653", ink: "var(--athlete-gators-ink)",
  },
  team: {
    name: "Together", label: "Mixed doubles",
    color: "#235a43", ink: "var(--athlete-team-ink)",
  },
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
/**
 * How many entries the app opens with. Two people logging meals and sessions
 * daily reach thousands before the event, and sending all of them to a phone on
 * every load is megabytes that nothing on the first screen reads. The Log asks
 * for the rest when it needs them.
 */
export const RECENT_LIMIT = 400;

export function localDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
/** Zero means the time was not recorded, which is not the same as no time. */
export function formatTimeOrDash(seconds: number) {
  return seconds > 0 ? formatTime(seconds) : "—";
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
/**
 * Calories burned, from the compendium formula: MET x 3.5 x kg / 200 per minute.
 * METs for vigorous effort, which is what these sessions are.
 */
export const MET_BY_CATEGORY: Record<Workout["category"], number> = {
  Strength: 6,
  MetCon: 8,
  Endurance: 9,
  // Slow resistance on a megaformer: continuous and hard, but not the 500 kcal
  // an hour the marketing claims. Deliberately conservative, because an
  // overstated burn quietly inflates what the day looks like it can afford.
  Solidcore: 5,
  // Compendium puts general play near 7, between doubles and singles. Rallying
  // is not continuous, and the stop-start is already in that number.
  Tennis: 7,
  Other: 5,
};

/**
 * Null when it cannot be known rather than a number that looks measured: the
 * formula needs a bodyweight, and a duration that a session logged without a
 * time does not have. Rounded to ten, because the method is not worth more.
 */
export function estimateBurn(workout: Workout, bodyweightKg: number) {
  if (!(bodyweightKg > 0) || !(workout.seconds > 0)) return null;
  const met = MET_BY_CATEGORY[workout.category] ?? MET_BY_CATEGORY.Other;
  const kcal = ((met * 3.5 * bodyweightKg) / 200) * (workout.seconds / 60);
  return Math.round(kcal / 10) * 10;
}

/**
 * One tap for the sessions that are always the same shape. The minutes are a
 * starting point rather than a fact: they land in the elapsed box, which stays
 * editable. Kept here rather than in the form so the categories and times can
 * be checked by a test, which is where a preset naming a category that no
 * longer exists would otherwise go unnoticed.
 */
export const PRESETS = [
  { label: "Solidcore", category: "Solidcore", minutes: 50 },
  { label: "Tennis", category: "Tennis", minutes: 60 },
] as const satisfies readonly {
  label: string;
  category: Workout["category"];
  minutes: number;
}[];

/**
 * Pairs or solo, taken from who you are logging for. It sat at Pairs whatever
 * the switch at the top said, which made every solo session claim otherwise
 * unless you noticed the dropdown.
 */
export function defaultContext(sideCount: number): Workout["context"] {
  return sideCount > 1 ? "pairs" : "solo";
}

/**
 * What to call the session's type. "Other" says nothing in a log, so when you
 * have named it, the name is what shows.
 */
export function categoryName(
  workout: Pick<Workout, "category" | "customCategory">,
) {
  const named = (workout.customCategory ?? "").trim();
  return workout.category === "Other" && named ? named : workout.category;
}

/**
 * How long a session lasted, from what was filled in. A typed time wins,
 * because only you know about the rest between stations; with none, the
 * station splits are the time actually spent. Nothing at all is zero, which
 * the journal reads as not recorded rather than as a session of no length.
 *
 * This is the rule that took three attempts to get right, so it is here where
 * it can be tested rather than inside the form where it could not be.
 */
export function sessionSeconds(
  elapsedText: string,
  segments: { seconds: number }[],
) {
  const typed = elapsedText.trim();
  if (typed !== "") return parseTime(typed);
  return segments.reduce((sum, segment) => sum + segment.seconds, 0);
}

/**
 * What a category makes the session form show. Kept out of the component
 * because every preset bug so far has been a decision like these getting a
 * category wrong, and a decision in a component is a decision no test sees.
 */
export function categoryShape(category: Workout["category"]) {
  const usesStations = category !== "Strength";
  // MetCon and Endurance arrive with a circuit. Anything else that shows
  // stations has to let you name them, or the panel asks for something it
  // gives you no way to provide.
  const bringsItsOwnCircuit = category === "MetCon" || category === "Endurance";
  return {
    usesStations,
    usesLifts: category === "Strength" || category === "Other",
    usesCustomStations: usesStations && !bringsItsOwnCircuit,
    isRun: category === "Endurance",
  };
}

/**
 * What a preset should leave in the title. It replaces what another preset put
 * there, so correcting a mistaken tap does not save a tennis session called
 * Solidcore, and never replaces something you typed yourself.
 */
export function presetTitle(current: string, preset: (typeof PRESETS)[number]) {
  const typed = current.trim();
  const leftByAPreset = PRESETS.some((other) => other.label === typed);
  return !typed || leftByAPreset ? preset.label : current;
}

/** The same rule for the elapsed box: replace a preset's time, keep yours. */
export function presetElapsed(current: string, preset: (typeof PRESETS)[number]) {
  const typed = current.trim();
  const leftByAPreset = PRESETS.some(
    (other) => formatTime(other.minutes * 60) === typed,
  );
  return !typed || leftByAPreset ? formatTime(preset.minutes * 60) : current;
}

export function formatWeight(kg: number, unit: WeightUnit) {
  return `${Math.round(fromKilograms(kg, unit) * 10) / 10} ${unit}`;
}
