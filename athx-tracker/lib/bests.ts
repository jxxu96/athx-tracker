import { formatWeight, fromKilograms, type Athlete, type Lift, type WeightUnit, type Workout } from "./domain.ts";
import { matchMovement, normalize } from "./movement-match.ts";
import { estimatedMax } from "./progress.ts";

/**
 * What a saved session beat. Each lift is set against the same lift in every
 * session of that athlete's already in the journal, whatever its date: first the heaviest set,
 * more weight and then more reps, as Progress ranks them; failing that the
 * estimated max, so five reps where three used to be is news too. A lift
 * logged for the first time has nothing to beat, and is not a best.
 */
export type NewBest = {
  athlete: Exclude<Athlete, "team">;
  name: string;
  kind: "heaviest" | "estimated";
  /** The set that did it. */
  kg: number;
  reps: number;
  /** Heaviest: the set it beat. Estimated: the max it beat, and the new one. */
  previous: { kg: number; reps: number };
  estimate?: number;
};

const keys = new Map<string, string>();

/** The list's spelling when a name is one of its lifts, so "OHP" and "Overhead press" are one lift. */
function liftKey(name: string) {
  let key = keys.get(name);
  if (key === undefined) {
    const match = matchMovement(name);
    key = match.listed ? match.name : normalize(name).join(" ") || name.trim().toLowerCase();
    keys.set(name, key);
  }
  return key;
}

function liftName(name: string) {
  const match = matchMovement(name);
  return match.listed ? match.name : name.trim();
}

type Best = { top: { kg: number; reps: number }; estimate: number | null };

function heavier(a: { kg: number; reps: number }, b: { kg: number; reps: number }) {
  return a.kg > b.kg || (a.kg === b.kg && a.reps > b.reps);
}

function setsOf(lift: Lift) {
  return lift.detail?.length ? lift.detail : [{ kg: lift.kg, reps: lift.reps }];
}

/** The best of each lift across some sessions, by key. */
function bestsOf(workouts: readonly Workout[]) {
  const bests = new Map<string, Best>();
  for (const workout of workouts) {
    for (const lift of workout.lifts) {
      const key = liftKey(lift.name);
      const held = bests.get(key) ?? { top: { kg: 0, reps: 0 }, estimate: null };
      for (const set of setsOf(lift)) if (heavier(set, held.top)) held.top = { kg: set.kg, reps: set.reps };
      const estimate = estimatedMax(lift, workout.day)?.kg ?? null;
      if (estimate !== null && (held.estimate === null || estimate > held.estimate)) held.estimate = estimate;
      bests.set(key, held);
    }
  }
  return bests;
}

/** Below a tenth of a kilogram, two estimates are the same estimate. */
const EPSILON = 0.05;

export function newBests(saved: Workout, others: readonly Workout[]): NewBest[] {
  if (saved.athlete === "team" || saved.lifts.length === 0) return [];
  const athlete = saved.athlete;
  // The session's own earlier version counts as another session, so saving
  // an edit does not announce a best the session already held.
  const before = bestsOf(others.filter((workout) => workout.athlete === athlete));
  const now = bestsOf([saved]);
  const found: NewBest[] = [];
  for (const [key, mine] of now) {
    const held = before.get(key);
    if (!held) continue;
    const name = liftName(saved.lifts.find((lift) => liftKey(lift.name) === key)!.name);
    if (heavier(mine.top, held.top)) {
      found.push({ athlete, name, kind: "heaviest", ...mine.top, previous: held.top });
      continue;
    }
    if (mine.estimate !== null && held.estimate !== null && mine.estimate > held.estimate + EPSILON) {
      const set = saved.lifts
        .filter((lift) => liftKey(lift.name) === key)
        .map((lift) => estimatedMax(lift, saved.day))
        .reduce((best, next) => (next && (!best || next.kg > best.kg) ? next : best), null as ReturnType<typeof estimatedMax>);
      if (!set) continue;
      found.push({
        athlete,
        name,
        kind: "estimated",
        kg: set.setKg,
        reps: set.reps,
        previous: { kg: held.estimate, reps: 1 },
        estimate: mine.estimate,
      });
    }
  }
  return found;
}

/** One line for a notice: "Deadlift 140 kg × 3, up from 135 kg × 3". */
export function bestLine(best: NewBest, unit: WeightUnit) {
  const set = `${best.name} ${formatWeight(best.kg, unit)} × ${best.reps}`;
  if (best.kind === "heaviest")
    return `${set}, up from ${formatWeight(best.previous.kg, unit)} × ${best.previous.reps}`;
  const whole = (kg: number) => `${Math.round(fromKilograms(kg, unit))} ${unit}`;
  return `${set}: estimated max ${whole(best.estimate ?? 0)}, up from ${whole(best.previous.kg)}`;
}
