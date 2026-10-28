import { matchMovement, normalize } from "./movement-match.ts";
import {
  METCON,
  type LiftTargets,
  type RaceGoals,
  isDistanceUnit,
  standardLoad,
  toKilograms,
  toMetres,
  type RecordItem,
  type Workout,
} from "./domain.ts";

/**
 * What the pair would score on race day, from what is already logged. The
 * format is the 2027 season's, the same at every event, for ATHX Lite pairs
 * (athxgames.com/workouts/2027 and /movement-standards/2027):
 *
 * - Strength: a 1RM shoulder to overhead, a 2RM back squat and a 3RM
 *   deadlift, each lifted by both athletes and added together.
 * - Endurance: each athlete runs 2.4 km, then the pair skis on its one SkiErg
 *   until 24:00. The first back may start alone and they change over after
 *   that. The score is the distance skied.
 * - MetCon X: the circuit in METCON for time, capped at 25:00. One athlete
 *   works at a time and the work can be shared out, except the carry, which
 *   is 30 m each.
 *
 * Every figure is the best the log has shown, carried to the race's reps,
 * distance or time. Where the log cannot support one it is null, never a guess.
 */

export type RaceAthlete = "hippos" | "gators";
export const RACE_ATHLETES = ["hippos", "gators"] as const;

/** A Together session has no single athlete, so it counts for neither. */
const workoutsOf = (records: RecordItem[], athlete: RaceAthlete) =>
  records.filter(
    (record): record is Workout => record.kind === "workout" && record.athlete === athlete,
  );

const listed = new Map<string, string>();

/** A saved name in the list's spelling, so "SkiErg" and "ski erg" are the same machine. */
function listedName(name: string) {
  let known = listed.get(name);
  if (known === undefined) {
    const match = matchMovement(name);
    known = match.listed ? match.name : name.trim();
    listed.set(name, known);
  }
  return known;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Strength

/** The zone's three windows, in the order they are lifted. */
export const STRENGTH_LIFTS = [
  { key: "overhead", name: "Shoulder to overhead", short: "S2OH" },
  { key: "squat", name: "Back squat", short: "Squat" },
  { key: "deadlift", name: "Deadlift", short: "Deadlift" },
] as const;
export type StrengthLift = (typeof STRENGTH_LIFTS)[number]["key"];

/**
 * Shoulder to overhead allows a press, push press, push jerk or split jerk
 * from the rack, so any of them is the figure. A clean and jerk put that load
 * overhead from the shoulders too. Front squats and Romanian deadlifts are
 * other lifts, and do not count.
 */
const LIFT_OF = new Map<string, StrengthLift>([
  ["Overhead press", "overhead"],
  ["Push press", "overhead"],
  ["Split jerk", "overhead"],
  ["Clean and jerk", "overhead"],
  ["Back squat", "squat"],
  ["Deadlift", "deadlift"],
]);
/** Jerks the picker has no entry for, so they arrive typed under Other. */
const TYPED_OVERHEAD = new Set([
  "push jerk", "power jerk", "squat jerk", "jerk", "shoulder to overhead", "s2oh", "stoh",
]);

/**
 * How a season scores Strength: the rep max each window asks for, and whether
 * the overhead lift has to be strict. 2027 takes any press or jerk for one,
 * with a 2RM squat and 3RM deadlift. 2026 took a strict press, a 3RM squat
 * and a 5RM deadlift, which is what its results are totals of.
 */
export type StrengthFormat = { reps: Record<StrengthLift, number>; strict: boolean };
export const STRENGTH_2027: StrengthFormat = {
  reps: { overhead: 1, squat: 2, deadlift: 3 },
  strict: false,
};
export const STRENGTH_2026: StrengthFormat = {
  reps: { overhead: 1, squat: 3, deadlift: 5 },
  strict: true,
};

/** A strict window takes the overhead press alone: no leg drive, so no push press or jerk. */
export function strengthLift(name: string, strict = false): StrengthLift | null {
  const listed = listedName(name);
  const lift = LIFT_OF.get(listed) ?? (TYPED_OVERHEAD.has(normalize(name).join(" ")) ? "overhead" : null);
  return lift === "overhead" && strict && listed !== "Overhead press" ? null : lift;
}

/** Past ten reps a set is endurance as much as strength, and says little about a max. */
export const MAX_REPS = 10;

/**
 * A set's load carried to another rep count, on Brzycki's line: the most you
 * can lift r times is (37 - r) / 36 of a 1RM. Exact at the reps done, so a
 * single is its own 1RM. A working set is rarely to failure, which makes this
 * an estimate that errs low.
 */
export function repMax(kg: number, reps: number, target: number) {
  return (kg * (37 - target)) / (37 - reps);
}

export type LiftEstimate = {
  /** The rep max the window asks for, in kilograms. */
  kg: number;
  /** Whole kilograms, which is what is shown and added up. */
  shown: number;
  /** The set it comes from, in the list's spelling. */
  name: string;
  day: string;
  setKg: number;
  reps: number;
};

export type AthleteStrength = {
  lifts: Record<StrengthLift, LiftEstimate | null>;
  /** Null until all three lifts have a figure. */
  total: number | null;
};

/** Each lift at the most any logged set predicts for the window's reps. */
export function athleteStrength(
  records: RecordItem[],
  athlete: RaceAthlete,
  format: StrengthFormat = STRENGTH_2027,
): AthleteStrength {
  const lifts: Record<StrengthLift, LiftEstimate | null> = { overhead: null, squat: null, deadlift: null };
  for (const workout of workoutsOf(records, athlete)) {
    for (const lift of workout.lifts) {
      const key = strengthLift(lift.name, format.strict);
      if (!key) continue;
      const target = format.reps[key];
      // A varied lift has every set; one that was the same throughout is its one line.
      const sets = lift.detail?.length ? lift.detail : [{ kg: lift.kg, reps: lift.reps }];
      for (const set of sets) {
        const reps = Math.floor(set.reps);
        if (!(set.kg > 0) || !(reps >= 1 && reps <= MAX_REPS)) continue;
        const kg = repMax(set.kg, reps, target);
        const held = lifts[key];
        if (held && held.kg >= kg) continue;
        lifts[key] = {
          kg,
          shown: Math.round(kg),
          name: listedName(lift.name),
          day: workout.day,
          setKg: set.kg,
          reps,
        };
      }
    }
  }
  const shown = STRENGTH_LIFTS.map(({ key }) => lifts[key]?.shown ?? null);
  const total = shown.every((kg) => kg !== null)
    ? shown.reduce<number>((sum, kg) => sum + kg!, 0)
    : null;
  return { lifts, total };
}

export type StrengthPlan = {
  athletes: Record<RaceAthlete, AthleteStrength>;
  /** Both athletes' totals added. Null while any of the six lifts is missing. */
  combined: number | null;
};

export function strengthPlan(records: RecordItem[], format: StrengthFormat = STRENGTH_2027): StrengthPlan {
  const athletes = {
    hippos: athleteStrength(records, "hippos", format),
    gators: athleteStrength(records, "gators", format),
  };
  const { hippos, gators } = athletes;
  return {
    athletes,
    combined: hippos.total === null || gators.total === null ? null : hippos.total + gators.total,
  };
}

// Endurance

export const ENDURANCE = { capSeconds: 24 * 60, runMetres: 2400 } as const;

/**
 * Riegel's exponent: time grows with distance to the power 1.06, so a longer
 * effort is a little slower per metre. Used for the SkiErg as well as the run.
 */
export const RIEGEL = 1.06;
/** A sprint is a different effort from a race, so pieces shorter than this are left out. */
export const MIN_PIECE_METRES = 1000;

export type Piece = { metres: number; seconds: number; day: string };

/** Timed pieces of one movement over a distance, in any session. */
export function pieces(records: RecordItem[], athlete: RaceAthlete, movement: "Run" | "Ski erg") {
  const found: Piece[] = [];
  for (const workout of workoutsOf(records, athlete)) {
    for (const segment of workout.segments) {
      if (!isDistanceUnit(segment.unit) || !(segment.completed > 0) || !(segment.seconds > 0)) continue;
      if (listedName(segment.name) !== movement) continue;
      const metres = toMetres(segment.completed, segment.unit);
      if (metres < MIN_PIECE_METRES) continue;
      found.push({ metres, seconds: segment.seconds, day: workout.day });
    }
  }
  return found;
}

/** The quickest 2.4 km any logged run predicts, in seconds. */
export function runSeconds(runs: Piece[]) {
  let best: number | null = null;
  for (const run of runs) {
    const seconds = run.seconds * (ENDURANCE.runMetres / run.metres) ** RIEGEL;
    if (best === null || seconds < best) best = seconds;
  }
  return best;
}

/** The farthest any logged SkiErg piece predicts for that long on the erg, in metres. */
export function skiMetres(skis: Piece[], seconds: number) {
  if (!(seconds > 0)) return 0;
  let best: number | null = null;
  for (const ski of skis) {
    const metres = ski.metres * (seconds / ski.seconds) ** (1 / RIEGEL);
    if (best === null || metres > best) best = metres;
  }
  return best;
}

/** Ski distances are shown to ten metres, which is all the method is worth. */
const tens = (metres: number) => Math.round(metres / 10) * 10;

export type EndurancePlan = {
  /** Each athlete's 2.4 km, in seconds. */
  run: Record<RaceAthlete, number | null>;
  /** Time on the erg and the distance it covers. Null until both runs are known. */
  ski: Record<RaceAthlete, { seconds: number; metres: number | null }> | null;
  /** When the first athlete back starts skiing. Null when nobody gets there before the cap. */
  skiFrom: number | null;
  /** The score: both athletes' metres added. Null while either is unknown. */
  metres: number | null;
  /** Whose run or SkiErg has nothing to go on yet. */
  missing: { athlete: RaceAthlete; piece: "run" | "ski" }[];
};

/**
 * The first athlete back skis alone until the other arrives, and from there
 * they take turns, half the time each. Each athlete's distance follows from
 * their total time on the erg, which is conservative for someone resting
 * between turns.
 */
export function endurancePlan(records: RecordItem[]): EndurancePlan {
  const cap = ENDURANCE.capSeconds;
  const runs = {
    hippos: pieces(records, "hippos", "Run"),
    gators: pieces(records, "gators", "Run"),
  };
  const skis = {
    hippos: pieces(records, "hippos", "Ski erg"),
    gators: pieces(records, "gators", "Ski erg"),
  };
  const run = { hippos: runSeconds(runs.hippos), gators: runSeconds(runs.gators) };
  const missing = RACE_ATHLETES.flatMap((athlete) => [
    ...(run[athlete] === null ? [{ athlete, piece: "run" as const }] : []),
    ...(skis[athlete].length === 0 ? [{ athlete, piece: "ski" as const }] : []),
  ]);
  if (run.hippos === null || run.gators === null)
    return { run, ski: null, skiFrom: null, metres: null, missing };

  const [first, second] = run.hippos <= run.gators
    ? (["hippos", "gators"] as const)
    : (["gators", "hippos"] as const);
  const firstBack = Math.min(run[first]!, cap);
  const secondBack = Math.min(run[second]!, cap);
  const turns = (cap - secondBack) / 2;
  const seconds = { hippos: turns, gators: turns };
  seconds[first] += secondBack - firstBack;

  const ski = {
    hippos: { seconds: seconds.hippos, metres: skiMetres(skis.hippos, seconds.hippos) },
    gators: { seconds: seconds.gators, metres: skiMetres(skis.gators, seconds.gators) },
  };
  for (const athlete of RACE_ATHLETES) {
    const metres = ski[athlete].metres;
    if (metres !== null) ski[athlete].metres = tens(metres);
  }
  const { hippos, gators } = ski;
  return {
    run,
    ski,
    skiFrom: firstBack < cap ? firstBack : null,
    metres: hippos.metres === null || gators.metres === null ? null : hippos.metres + gators.metres,
    missing,
  };
}

// MetCon X

export const METCON_CAP_SECONDS = 25 * 60;

type Station = (typeof METCON)[number];

/** Each athlete covers half of these. Everything else the pair shares out however it likes. */
const HALF_EACH = new Set(["Sandbag carry"]);
/** One machine under three names: a row's pace stands in for another row's. */
const ROWS = new Set(["Opening row", "Closing row", "Row"]);

/**
 * The lightest load that is still the station's race weight: the prescribed
 * load, or the rack's nearest to it in either unit, which is what the form
 * fills in. Hippos' 7.5 kg is offered as 15 lb, which is 6.8 kg.
 */
export function raceLoad(kg: number) {
  return Math.min(
    kg,
    toKilograms(Number(standardLoad(kg, "lb")), "lb"),
    toKilograms(Number(standardLoad(kg, "kg")), "kg"),
  );
}

/**
 * Seconds per unit at the quickest timed attempt at a station, in its own
 * unit. A row with nothing timed takes the quickest of the athlete's other
 * rows, since it is the same machine; nothing else borrows a pace. An attempt
 * logged lighter than race weight is not race pace, so it is left out; one
 * with no load recorded is taken as it stands.
 */
export function stationPace(records: RecordItem[], athlete: RaceAthlete, station: Station) {
  const prescribed = station.kg?.[athlete];
  // Stored loads are rounded to a hundredth of a kilogram.
  const lightest = prescribed ? raceLoad(prescribed) - 0.01 : 0;
  let own: number | null = null;
  let row: number | null = null;
  for (const workout of workoutsOf(records, athlete)) {
    for (const segment of workout.segments) {
      if (segment.unit !== station.unit || !(segment.completed > 0) || !(segment.seconds > 0)) continue;
      if (segment.kg !== undefined && segment.kg < lightest) continue;
      const name = listedName(segment.name);
      const pace = segment.seconds / segment.completed;
      if (name === station.name) own = own === null ? pace : Math.min(own, pace);
      else if (ROWS.has(station.name) && ROWS.has(name)) row = row === null ? pace : Math.min(row, pace);
    }
  }
  return own ?? row;
}

export type StationPlan = {
  name: string;
  seconds: number | null;
  /** Who does it: the quicker of you, both for the carry, either when you are level. */
  by: RaceAthlete | "both" | "either" | null;
};

/**
 * One station for the pair: the quicker of you takes it. That is a plan you
 * can always carry out, and taking turns well can only beat it, where an even
 * split at paces held going solo came out slower than the quicker athlete
 * alone. With one pace known, that athlete takes it. The carry is half each,
 * so it needs both.
 */
export function pairStation(
  station: Pick<Station, "name" | "target">,
  hippos: number | null,
  gators: number | null,
): Omit<StationPlan, "name"> {
  if (HALF_EACH.has(station.name)) {
    return hippos === null || gators === null
      ? { seconds: null, by: null }
      : { seconds: (station.target / 2) * (hippos + gators), by: "both" };
  }
  if (hippos === null && gators === null) return { seconds: null, by: null };
  if (gators === null || (hippos !== null && hippos < gators))
    return { seconds: station.target * hippos!, by: "hippos" };
  if (hippos === null || gators < hippos) return { seconds: station.target * gators, by: "gators" };
  return { seconds: station.target * hippos, by: "either" };
}

/**
 * Seconds per change of station, from circuits logged on their own with an
 * elapsed time longer than their splits: the difference, spread over the six
 * changes. The middle of those circuits; null when none shows it.
 */
export function changeoverSeconds(records: RecordItem[], athlete: RaceAthlete) {
  const gaps: number[] = [];
  for (const workout of workoutsOf(records, athlete)) {
    // A Mixed session's clock also holds its lifts or run.
    if (workout.category !== "MetCon" || workout.segments.length !== METCON.length) continue;
    const splits = METCON.map(
      (station) =>
        workout.segments.find((segment) => listedName(segment.name) === station.name)?.seconds ?? 0,
    );
    if (splits.some((seconds) => !(seconds > 0))) continue;
    const stations = splits.reduce((sum, seconds) => sum + seconds, 0);
    if (!(workout.seconds > stations)) continue;
    gaps.push((workout.seconds - stations) / (METCON.length - 1));
  }
  return median(gaps);
}

export type MetconPlan = {
  /** The whole circuit for the pair. Null while any station cannot be timed. */
  seconds: number | null;
  stations: StationPlan[];
  /** Time between stations included in seconds. Zero when no circuit shows it. */
  changeovers: number;
  changeoversKnown: boolean;
  /** A station neither of you has timed, or a carry one of you has not. */
  missing: { station: string; athlete: RaceAthlete | null }[];
};

export function metconPlan(records: RecordItem[]): MetconPlan {
  const missing: MetconPlan["missing"] = [];
  const stations = METCON.map((station) => {
    const hippos = stationPace(records, "hippos", station);
    const gators = stationPace(records, "gators", station);
    const plan = pairStation(station, hippos, gators);
    if (plan.seconds === null) {
      if (!HALF_EACH.has(station.name)) missing.push({ station: station.name, athlete: null });
      else
        for (const [athlete, pace] of [["hippos", hippos], ["gators", gators]] as const)
          if (pace === null) missing.push({ station: station.name, athlete });
    }
    return { name: station.name, ...plan };
  });
  // You move between stations together, so the pair takes the average of what each shows.
  const each = RACE_ATHLETES.map((athlete) => changeoverSeconds(records, athlete)).filter(
    (seconds): seconds is number => seconds !== null,
  );
  const changeovers = each.length
    ? (each.reduce((sum, seconds) => sum + seconds, 0) / each.length) * (METCON.length - 1)
    : 0;
  return {
    seconds: missing.length
      ? null
      : stations.reduce((sum, station) => sum + station.seconds!, 0) + changeovers,
    stations,
    changeovers,
    changeoversKnown: each.length > 0,
    missing,
  };
}

export function raceEstimate(records: RecordItem[]) {
  return {
    strength: strengthPlan(records),
    endurance: endurancePlan(records),
    metcon: metconPlan(records),
  };
}

export type RaceZone = "strength" | "endurance" | "metcon";
/** What a zone scores: kilograms and metres count up, MetCon X's seconds count down. */
export const RACE_ZONES = [
  { key: "strength", name: "Strength", lower: false },
  { key: "endurance", name: "Endurance", lower: false },
  { key: "metcon", name: "MetCon X", lower: true },
] as const;

/** Each zone's score from an estimate, null where the log cannot support one. */
export function zoneScores(estimate: ReturnType<typeof raceEstimate>): Record<RaceZone, number | null> {
  return {
    strength: estimate.strength.combined,
    endurance: estimate.endurance.metres,
    metcon: estimate.metcon.seconds,
  };
}

const ZONE_SCORE: Record<RaceZone, (records: RecordItem[]) => number | null> = {
  strength: (records) => strengthPlan(records).combined,
  endurance: (records) => endurancePlan(records).metres,
  metcon: (records) => metconPlan(records).seconds,
};

export type ZoneStart = { score: number; day: string };

/**
 * Each zone's first estimate: the score as of the first day the log could
 * support one, counting everything logged up to the end of that day. A score
 * can come and go: two runs past the cap ski nothing, which scores, until a
 * quicker run leaves time on an erg nobody has used. So every day is tried
 * in order, rather than halving on the assumption that a score once there stays.
 */
export function raceStart(records: RecordItem[]): Record<RaceZone, ZoneStart | null> {
  const days = [
    ...new Set(
      records
        .filter((record) => record.kind === "workout" && record.athlete !== "team")
        .map((record) => record.day),
    ),
  ].sort();
  const found: Record<RaceZone, ZoneStart | null> = { strength: null, endurance: null, metcon: null };
  for (const day of days) {
    const upTo = records.filter((record) => record.day <= day);
    for (const { key } of RACE_ZONES) {
      if (found[key]) continue;
      const score = ZONE_SCORE[key](upTo);
      if (score !== null) found[key] = { score, day };
    }
    if (RACE_ZONES.every(({ key }) => found[key])) break;
  }
  return found;
}

/**
 * Strength's goal, from the lift targets Progress measures against. A target
 * is a one-rep max, as Progress reads it against each estimated max, so each
 * is carried to the window's reps on the same line a logged set is. Shoulder
 * to overhead takes the higher of the press and split jerk targets, since
 * either counts. Null until both athletes have all three, as the score is.
 */
export function strengthGoal(targets: Record<RaceAthlete, LiftTargets>) {
  let total = 0;
  for (const athlete of RACE_ATHLETES) {
    const own = targets[athlete];
    const kg: Record<StrengthLift, number> = {
      overhead: Math.max(own.overheadPress, own.splitJerk),
      squat: own.backSquat,
      deadlift: own.deadlift,
    };
    for (const { key } of STRENGTH_LIFTS) {
      if (!(kg[key] > 0)) return null;
      total += Math.round(repMax(kg[key], 1, STRENGTH_2027.reps[key]));
    }
  }
  return total;
}

/** Each zone's goal: Strength from the lift targets, the others from Setup's race goals. */
export function zoneGoals(
  targets: Record<RaceAthlete, LiftTargets>,
  goals: RaceGoals | undefined,
): Record<RaceZone, number> {
  return {
    strength: strengthGoal(targets) ?? 0,
    endurance: goals?.endurance ?? 0,
    metcon: goals?.metcon ?? 0,
  };
}

/**
 * How far from the start to the goal the current score has come, as a
 * percent from 0 to 100. Null without a goal, or when the start was already
 * at it, which leaves no distance to cover.
 */
export function zoneProgress(start: number, current: number, goal: number, lower: boolean) {
  if (!(goal > 0)) return null;
  const span = lower ? start - goal : goal - start;
  if (!(span > 0)) return null;
  const covered = lower ? start - current : current - start;
  return Math.min(100, Math.max(0, (covered / span) * 100));
}
