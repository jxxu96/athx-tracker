import { matchMovement } from "./movement-match.ts";
import type { Lift, Workout } from "./domain.ts";

const spelled = new Map<string, string>();

/**
 * A saved name the way the list spells it, so "back squat" typed under Other
 * is the same lift as Back squat picked from the list. A name the list does
 * not have is compared as typed, ignoring case.
 */
function listName(name: string) {
  let found = spelled.get(name);
  if (found === undefined) {
    const match = matchMovement(name);
    found = match.listed ? match.name : name.trim().toLowerCase();
    spelled.set(name, found);
  }
  return found;
}

export type LastLift = { day: string; lift: Lift };

/**
 * The last time an athlete logged a lift, on or before a day: the numbers a
 * lift row offers to copy. Workouts come newest first, the order the journal
 * keeps them in, so the first match is the latest. The entry being edited is
 * not its own last time, and a together session belongs to neither athlete.
 */
export function lastLift(
  workouts: readonly Workout[],
  athlete: "hippos" | "gators",
  name: string,
  { onOrBefore, exclude }: { onOrBefore: string; exclude?: string },
): LastLift | null {
  if (!name.trim()) return null;
  const wanted = listName(name);
  for (const workout of workouts) {
    if (workout.athlete !== athlete || workout.id === exclude || workout.day > onOrBefore) continue;
    const lift = workout.lifts.find((item) => listName(item.name) === wanted);
    if (lift) return { day: workout.day, lift };
  }
  return null;
}
