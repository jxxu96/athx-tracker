import { formatWeight, type Athlete, type Lift, type WeightUnit, type Workout } from "./domain.ts";
import { matchMovement, normalize } from "./movement-match.ts";

/**
 * What a saved session beat. Each lift is set against the same lift in every
 * session of that athlete's already in the journal, whatever its date: the
 * heaviest set, more weight and then more reps. Nothing is carried up to a
 * max, so fewer kilograms for more reps is not news. A lift logged for the
 * first time has nothing to beat, and is not a best.
 */
export type NewBest = {
  athlete: Exclude<Athlete, "team">;
  name: string;
  /** The only kind now; a phone still on the version before reads it the same. */
  kind: "heaviest";
  /** The set that did it. */
  kg: number;
  reps: number;
  /** The set it beat. */
  previous: { kg: number; reps: number };
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

type Best = { kg: number; reps: number };

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
      let held = bests.get(key) ?? { kg: 0, reps: 0 };
      for (const set of setsOf(lift)) if (heavier(set, held)) held = { kg: set.kg, reps: set.reps };
      bests.set(key, held);
    }
  }
  return bests;
}

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
    if (!held || !heavier(mine, held)) continue;
    const name = liftName(saved.lifts.find((lift) => liftKey(lift.name) === key)!.name);
    found.push({ athlete, name, kind: "heaviest", ...mine, previous: held });
  }
  return found;
}

/** One line for a notice: "Deadlift 140 kg × 3, up from 135 kg × 3". */
export function bestLine(best: NewBest, unit: WeightUnit) {
  return `${best.name} ${formatWeight(best.kg, unit)} × ${best.reps}, up from ${formatWeight(best.previous.kg, unit)} × ${best.previous.reps}`;
}
