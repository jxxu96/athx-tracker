export type Athlete = "hippos" | "gators" | "team";
export type WeightUnit = "kg" | "lb";
/** What a station counts. A run uses m, km, or mi; the number is in that unit. */
export const VOLUME_UNITS = ["reps", "m", "km", "mi", "cal", "rounds"] as const;
export type VolumeUnit = (typeof VOLUME_UNITS)[number];
export const DISTANCE_UNITS = ["m", "km", "mi"] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];
export type Macros = { calories: number; protein: number; carbs: number; fat: number };
/** Which part of a session a station belongs to. Lifts live in their own list. */
export type Block = "metcon" | "endurance";
export type Segment = {
  name: string; unit: VolumeUnit;
  completed: number; target: number; seconds: number;
  /**
   * Set on stations saved since sessions could mix parts. Older stations omit
   * it and take it from the session's category; see segmentBlock.
   */
  block?: Block;
  /** The load carried, in kilograms like every other weight. Omitted when unloaded or not recorded. */
  kg?: number;
};
export type Workout = {
  id: string; kind: "workout"; athlete: Athlete; day: string;
  title: string; category: "Strength" | "Endurance" | "MetCon" | "Mixed" | "Solidcore" | "Tennis" | "YTW" | "Other";
  /** What "Other" actually was. Empty for every other category. */
  customCategory: string;
  seconds: number; notes: string; segments: Segment[]; fatigue: number;
  transition: number; goal: number | null; context: "solo" | "pairs";
  lifts: { name: string; kg: number; sets: number; reps: number }[];
  /** The MetCon stopped at its time cap. Older sessions omit it, which reads as no. */
  capHit?: boolean;
};
export type Meal = {
  id: string; kind: "meal"; athlete: Exclude<Athlete, "team">; day: string;
  name: string; meal: "Breakfast" | "Lunch" | "Dinner" | "Snack" | "Alcohol";
  /**
   * Alcohol grams are only meaningful on an Alcohol sitting. Fiber grams are
   * already included in carbs. Older meals omit either one.
   */
  macros: Macros & { alcohol?: number; fiber?: number };
  source: "manual" | "grok" | "queued"; assumptions: string;
  /** Which CLI produced an estimate. Older meals, and anything typed by hand, omit it. */
  estimator?: Estimator;
};
export const ESTIMATORS = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
} as const;
export type Estimator = keyof typeof ESTIMATORS;
export type RecordItem = Workout | Meal;
/**
 * The lifts Progress follows, in the order it shows them. The name is the
 * picker's spelling; the key is what a target is stored under.
 */
export const PROGRESS_LIFTS = [
  { key: "splitJerk", name: "Split jerk" },
  { key: "overheadPress", name: "Overhead press" },
  { key: "backSquat", name: "Back squat" },
  { key: "deadlift", name: "Deadlift" },
] as const;
export type ProgressLift = (typeof PROGRESS_LIFTS)[number]["key"];
/** Kilograms, like every other weight here. Zero means no target. */
export type LiftTargets = Record<ProgressLift, number>;
export type Settings = {
  eventDate: string; eventName: string; weeklyTarget: number; weightUnit: WeightUnit;
  targets: { hippos: Macros; gators: Macros };
  /** Kilograms, like every other weight here. Zero means not given yet. */
  bodyweight: { hippos: number; gators: number };
  liftTargets: { hippos: LiftTargets; gators: LiftTargets };
};
/** Up here because the default lift targets below are given in pounds. */
export const LB_PER_KG = 2.20462262;
export const DEFAULT_SETTINGS: Settings = {
  eventDate: "2027-08-28", eventName: "ATHX New York", weeklyTarget: 4, weightUnit: "lb",
  targets: {
    hippos: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    gators: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  },
  bodyweight: { hippos: 0, gators: 0 },
  liftTargets: {
    hippos: { splitJerk: 0, overheadPress: 0, backSquat: 0, deadlift: 0 },
    gators: {
      splitJerk: 175 / LB_PER_KG,
      overheadPress: 135 / LB_PER_KG,
      backSquat: 255 / LB_PER_KG,
      deadlift: 335 / LB_PER_KG,
    },
  },
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
    color: "#6d28d9", ink: "var(--athlete-team-ink)",
  },
};
/**
 * The ATHX Lite circuit. Prescribed loads are kilograms per athlete, so they can
 * be shown in whichever unit Setup says and offered as the default load.
 */
export const METCON: {
  name: string; target: number; unit: Segment["unit"];
  kg?: { hippos: number; gators: number }; before?: string; after?: string; note?: string;
}[] = [
  { name: "Opening row", target: 40, unit: "cal", note: "Shared calories" },
  { name: "DB ground to overhead", target: 30, unit: "reps", kg: { hippos: 7.5, gators: 15 } },
  { name: "DB bench press", target: 30, unit: "reps", kg: { hippos: 7.5, gators: 15 }, after: " / DB" },
  { name: "Sandbag squats", target: 30, unit: "reps", kg: { hippos: 20, gators: 30 } },
  { name: "Sandbag carry", target: 60, unit: "m", kg: { hippos: 20, gators: 30 }, before: "30 m each" },
  { name: "Burpees over bench", target: 30, unit: "reps", note: "Step-overs permitted in Lite" },
  { name: "Closing row", target: 40, unit: "cal", note: "Shared calories" },
];

/** The line under a circuit station, in the unit you read weights in. */
export function metconLoadText(station: (typeof METCON)[number], unit: WeightUnit) {
  if (!station.kg) return station.note ?? "";
  const loads = `Hippos ${formatWeight(station.kg.hippos, unit)} · Gators ${formatWeight(station.kg.gators, unit)}${station.after ?? ""}`;
  return station.before ? `${station.before} · ${loads}` : loads;
}

/**
 * How many entries the app opens with. Two people logging meals and sessions
 * daily reach thousands before the event, and sending all of them to a phone on
 * every load is megabytes that nothing on the first screen reads. The Log asks
 * for the rest when it needs them.
 */
export const RECENT_LIMIT = 400;

/**
 * Today, in whichever zone the runtime is in. This was pinned to New York
 * because the event is there, which is not where someone training for it
 * necessarily is: from a later timezone an evening meal filed itself under
 * tomorrow, silently. The server renders first and cannot know where the phone
 * is, so its answer is only a starting value; the device corrects it.
 */
export function localDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

/**
 * The full-workout finish, read back from a session already saved.
 * Uses the estimate projectWorkout already makes. A finished session would
 * only repeat the time that was logged, and a session the scenario withholds
 * gets no figure at all, not a zero.
 */
export function scenarioLine(
  workout: Pick<Workout, "segments" | "seconds" | "fatigue" | "transition">,
) {
  const projected = projectWorkout(
    workout.segments,
    workout.seconds,
    workout.fatigue,
    workout.transition,
  );
  if (!projected?.partial) return null;
  return `At this pace, the whole session is about ${formatTime(projected.estimate)}.`;
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
export function toKilograms(value: number, unit: WeightUnit) {
  return unit === "lb" ? value / LB_PER_KG : value;
}
export function fromKilograms(value: number, unit: WeightUnit) {
  return unit === "lb" ? value * LB_PER_KG : value;
}

const METRES_PER: Record<DistanceUnit, number> = { m: 1, km: 1000, mi: 1609.344 };

export function isDistanceUnit(unit: string): unit is DistanceUnit {
  return unit === "m" || unit === "km" || unit === "mi";
}

export function toMetres(value: number, unit: DistanceUnit) {
  return value * METRES_PER[unit];
}

export function fromMetres(metres: number, unit: DistanceUnit) {
  return metres / METRES_PER[unit];
}

/**
 * The number a distance box shows. Metres stay whole. Kilometres and miles
 * keep two decimals and drop the trailing zeros, so 5 km does not read 5.00.
 */
export function displayDistance(value: number, unit: DistanceUnit) {
  if (unit === "m") return String(Math.round(value));
  return String(Math.round(value * 100) / 100);
}

/** A saved run as the log reads it: "5 km", "3.1 mi", "5,000 m". */
export function formatDistance(value: number, unit: DistanceUnit) {
  const shown = displayDistance(value, unit);
  const grouped = unit === "m" ? shown.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : shown;
  return `${grouped} ${unit}`;
}

/** Endurance distances, in the unit they were logged. Null when there are none. */
export function distanceLine(
  workout: Pick<Workout, "category" | "segments">,
) {
  const parts: string[] = [];
  for (const segment of workout.segments) {
    if (segmentBlock(workout, segment) !== "endurance" || !isDistanceUnit(segment.unit)) continue;
    parts.push(`${segment.name} ${formatDistance(segment.completed, segment.unit)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Calories burned, from the compendium formula: MET x 3.5 x kg / 200 per minute.
 * METs for vigorous effort, which is what these sessions are.
 */
export const MET_BY_CATEGORY: Record<Workout["category"], number> = {
  Strength: 6,
  MetCon: 8,
  Endurance: 9,
  // Only the fallback: a mixed session is weighted by its parts, in sessionMet.
  Mixed: 7,
  // Slow resistance on a megaformer: continuous and hard, but not the 500 kcal
  // an hour the marketing claims. Deliberately conservative, because an
  // overstated burn quietly inflates what the day looks like it can afford.
  Solidcore: 5,
  // Compendium puts general play near 7, between doubles and singles. Rallying
  // is not continuous, and the stop-start is already in that number.
  Tennis: 7,
  // Light shoulder raises. Below Solidcore: the load is small and the rest
  // between letters is most of the session.
  YTW: 4,
  Other: 5,
};

/**
 * A lift session with no clock. Each rep is a few seconds under the bar, and
 * each set after the first keeps a short strength rest. The short end of a
 * rest, on purpose: a longer one would invent a session nobody timed. Bar
 * weight is not its own term. Bodyweight is already in the MET formula.
 */
const LIFT_SECONDS_PER_REP = 4;
const LIFT_REST_SECONDS = 150;

export function untimedLiftSeconds(lifts: { sets: number; reps: number }[]) {
  let seconds = 0;
  for (const lift of lifts) {
    const sets = Math.max(0, Math.floor(lift.sets));
    const reps = Math.max(0, Math.floor(lift.reps));
    if (sets < 1 || reps < 1) continue;
    seconds += sets * reps * LIFT_SECONDS_PER_REP;
    seconds += Math.max(0, sets - 1) * LIFT_REST_SECONDS;
  }
  return seconds;
}

function kcalFor(met: number, bodyweightKg: number, seconds: number) {
  return ((met * 3.5 * bodyweightKg) / 200) * (seconds / 60);
}

/**
 * Null when it cannot be known rather than a number that looks measured.
 * That takes a bodyweight, and some work: a clock, station splits, or lifts.
 * Station time is the MetCon or the run. A clock longer than those splits
 * already includes the lifts, so their allowance is not added again. A clock
 * that is only the stations does not, and the lifts count beside it. Rounded
 * to ten, because the method is not worth more.
 */
export function estimateBurn(workout: Workout, bodyweightKg: number) {
  if (!(bodyweightKg > 0)) return null;
  const stationSeconds = workout.segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.seconds),
    0,
  );
  const clock = Math.max(0, workout.seconds);
  const liftSeconds = untimedLiftSeconds(workout.lifts);
  if (clock === 0 && stationSeconds === 0) {
    if (!(liftSeconds > 0)) return null;
    return Math.round(kcalFor(MET_BY_CATEGORY.Strength, bodyweightKg, liftSeconds) / 10) * 10;
  }
  const timed = Math.max(clock, stationSeconds);
  const gap = Math.max(0, timed - stationSeconds);
  // The gap is already priced as lifting when this session has lifts.
  const liftExtra = workout.lifts.length === 0
    ? 0
    : gap > 0
      ? Math.max(0, liftSeconds - gap)
      : liftSeconds;
  const met = sessionMet({ ...workout, seconds: timed });
  const kcal = kcalFor(met, bodyweightKg, timed)
    + kcalFor(MET_BY_CATEGORY.Strength, bodyweightKg, liftExtra);
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
  { label: "YTW", category: "YTW", minutes: 15 },
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
  workout: Pick<Workout, "category" | "customCategory"> &
    Partial<Pick<Workout, "segments" | "lifts">>,
) {
  const named = (workout.customCategory ?? "").trim();
  if (workout.category === "Mixed") {
    const parts = sessionParts({
      category: workout.category,
      segments: workout.segments ?? [],
      lifts: workout.lifts ?? [],
    });
    return parts.length > 1 ? parts.map((part) => PART_LABEL[part]).join(" + ") : "Mixed";
  }
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
  const isMixed = category === "Mixed";
  return {
    usesStations,
    usesLifts: category === "Strength" || category === "Other" || isMixed,
    usesCustomStations: usesStations && !bringsItsOwnCircuit,
    isRun: category === "Endurance",
    /** Each station says whether it is MetCon or endurance work. */
    isMixed,
  };
}

/**
 * Which part a station is. Saved stations carry it; older ones do not, and
 * before sessions could mix, a station's part was its session's category.
 */
export function segmentBlock(
  workout: Pick<Workout, "category">,
  segment: Pick<Segment, "block">,
): Block {
  if (segment.block) return segment.block;
  return workout.category === "Endurance" ? "endurance" : "metcon";
}

export type Part = "lifts" | Block;
export const PART_LABEL: Record<Part, string> = {
  lifts: "Strength", metcon: "MetCon", endurance: "Endurance",
};

/** The parts a session actually contains, in a fixed order. */
export function sessionParts(
  workout: Pick<Workout, "category" | "segments" | "lifts">,
): Part[] {
  const parts = new Set<Part>();
  if (workout.lifts.length) parts.add("lifts");
  for (const segment of workout.segments) parts.add(segmentBlock(workout, segment));
  return (["lifts", "metcon", "endurance"] as const).filter((part) => parts.has(part));
}

/**
 * A mixed session's MET, weighted by where its time went. Timed stations use
 * their own part's MET. Time not spent at a timed station is lifting when the
 * session has lifts, and otherwise the session's untimed stations. Every other
 * category keeps the single figure it always had, so no old burn changes.
 */
export function sessionMet(
  workout: Pick<Workout, "category" | "segments" | "lifts" | "seconds">,
) {
  if (workout.category !== "Mixed")
    return MET_BY_CATEGORY[workout.category] ?? MET_BY_CATEGORY.Other;
  const metOf = (part: Part) =>
    part === "lifts" ? MET_BY_CATEGORY.Strength
      : part === "metcon" ? MET_BY_CATEGORY.MetCon : MET_BY_CATEGORY.Endurance;
  const parts = sessionParts(workout);
  if (!parts.length || !(workout.seconds > 0)) return MET_BY_CATEGORY.Mixed;
  let timed = 0, weighted = 0;
  for (const segment of workout.segments) {
    const seconds = Math.max(0, segment.seconds);
    timed += seconds;
    weighted += seconds * metOf(segmentBlock(workout, segment));
  }
  const rest = Math.max(0, workout.seconds - timed);
  if (rest > 0) {
    const restPart: Part = parts.includes("lifts") ? "lifts" : parts.includes("metcon") ? "metcon" : "endurance";
    weighted += rest * metOf(restPart);
  }
  const total = timed + rest;
  return total > 0 ? weighted / total : MET_BY_CATEGORY.Mixed;
}

/**
 * How much of the MetCon was done, from what each station logged against its
 * target. Null when the session has no MetCon stations. Only finished
 * movements count as finished; the fraction is of the work, station by station.
 */
export function metconCompletion(
  workout: Pick<Workout, "category" | "segments" | "capHit">,
) {
  // Solidcore, tennis and Other can have stations too, but none is a MetCon.
  if (workout.category !== "MetCon" && workout.category !== "Mixed") return null;
  const stations = workout.segments.filter(
    (segment) => segmentBlock(workout, segment) === "metcon" && segment.target > 0,
  );
  if (!stations.length) return null;
  const finished = stations.filter((s) => s.completed >= s.target).length;
  const fraction =
    stations.reduce((n, s) => n + Math.min(1, s.completed / s.target), 0) / stations.length;
  return {
    finished,
    movements: stations.length,
    percent: Math.round(fraction * 100),
    complete: finished === stations.length,
    capHit: Boolean(workout.capHit),
  };
}

/** One line for the log: "5/7 movements · 82% · time cap". Null when finished and uncapped. */
export function completionLine(
  workout: Pick<Workout, "category" | "segments" | "capHit">,
) {
  const done = metconCompletion(workout);
  if (!done || (done.complete && !done.capHit)) return null;
  const parts = [`${done.finished}/${done.movements} movements`, `${done.percent}% of the work`];
  if (done.capHit) parts.push("time cap hit");
  return parts.join(" · ");
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
  return `${displayLoad(kg, unit)} ${unit}`;
}

/** A stored load as the number a weight box shows, to a tenth. */
export function displayLoad(kg: number, unit: WeightUnit) {
  return String(Math.round(fromKilograms(kg, unit) * 10) / 10);
}

/**
 * Plate steps for a prescribed load: 5 lb in pounds, 2.5 kg in kilograms.
 * Nobody grabs a 33.1 lb dumbbell, so the standard ATHX load is offered as
 * the nearest weight actually on the rack.
 */
export const LOAD_STEP: Record<WeightUnit, number> = { lb: 5, kg: 2.5 };

/**
 * The text a weight box starts with for a prescribed load. It is what saving
 * the box untouched records, so it has to read back as itself: parseLoad of
 * this text, shown again in the same unit, is this text.
 */
export function standardLoad(kg: number, unit: WeightUnit) {
  const step = LOAD_STEP[unit];
  const rounded = Math.max(step, Math.round(fromKilograms(kg, unit) / step) * step);
  return String(rounded);
}

/**
 * What a weight box means in kilograms. A box still showing a saved load
 * returns that load untouched, so opening and re-saving an entry never nudges
 * it by a rounding step (100 kg reads 220.5 lb, which is 100.02 kg). Blank or
 * not a positive number is null.
 */
export function parseLoad(text: string, unit: WeightUnit, saved?: number) {
  const typed = text.trim();
  if (typed === "") return null;
  if (saved !== undefined && saved > 0 && displayLoad(saved, unit) === typed) return saved;
  const value = Number(typed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(toKilograms(value, unit) * 100) / 100;
}

/**
 * A weight box's text when the unit switches. A saved load is shown fresh in
 * the new unit, not converted from its rounded display; anything typed is
 * converted; anything unreadable is left for the form to complain about.
 */
export function reunitLoad(text: string, from: WeightUnit, to: WeightUnit, saved?: number) {
  if (from === to) return text;
  const typed = text.trim();
  if (typed === "") return text;
  if (saved !== undefined && saved > 0 && displayLoad(saved, from) === typed)
    return displayLoad(saved, to);
  const value = Number(typed);
  if (!Number.isFinite(value) || value <= 0) return text;
  return String(Math.round(fromKilograms(toKilograms(value, from), to) * 10) / 10);
}
