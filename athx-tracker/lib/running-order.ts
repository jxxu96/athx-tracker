import { daysBetween } from "./client.ts";
import { METCON, liftEffort, type RecordItem, type Workout } from "./domain.ts";
import {
  ENDURANCE,
  METCON_CAP_SECONDS,
  RACE_ATHLETES,
  STRENGTH_2027,
  STRENGTH_LIFTS,
  listedName,
  strengthLift,
  type RaceAthlete,
  type RaceZone,
  type StrengthLift,
} from "./race.ts";

/**
 * Race day for an ATHX Lite pair, every workout in the order it is run, and
 * when each of you last did each one.
 *
 * The order is ATHX's timeline (athxgames.com/new-to-athx-games): Strength,
 * a 10-minute refuel, Endurance, a 30-minute recovery, then MetCon X. What
 * each zone asks is the 2027 format (athxgames.com/workouts/2027), the same
 * one the race-day estimate in race.ts scores.
 */

/**
 * The workouts that can be last done. The opening and closing rows are one
 * movement on one machine, so a row anywhere counts for both of them.
 */
export const MOVEMENTS = [
  "overhead",
  "squat",
  "deadlift",
  "run",
  "ski",
  "row",
  "groundToOverhead",
  "benchPress",
  "sandbagSquats",
  "carry",
  "burpees",
] as const;
export type Movement = (typeof MOVEMENTS)[number];

/** Names in the list's spelling, as listedName gives them. Lifts are strengthLift's. */
const NAMED = new Map<string, Movement>([
  ["Run", "run"],
  ["Ski erg", "ski"],
  ["Opening row", "row"],
  ["Closing row", "row"],
  ["Row", "row"],
  ["DB ground to overhead", "groundToOverhead"],
  ["DB bench press", "benchPress"],
  ["Sandbag squats", "sandbagSquats"],
  ["Sandbag carry", "carry"],
  ["Burpees over bench", "burpees"],
]);

/**
 * Which race workout a logged lift or station is, if any. The Strength
 * windows take whatever the race accepts there, as the estimate does: any
 * press or jerk from the shoulders is shoulder to overhead. Everything else
 * is its own name, so a front squat is not a back squat and a plain burpee is
 * not a burpee over the bench.
 */
export function movementOf(name: string): Movement | null {
  const lift = strengthLift(name);
  if (lift) return lift;
  return NAMED.get(listedName(name)) ?? null;
}

/**
 * The race workouts a session actually did. A lift counts once it has reps,
 * at any load, since a light day is still a day at it. A station counts with
 * work or time logged against it: a circuit station left at zero was not
 * reached, or in pairs was the other one's.
 */
export function movementsIn(workout: Pick<Workout, "lifts" | "segments">) {
  const found = new Set<Movement>();
  for (const lift of workout.lifts) {
    if (!(liftEffort(lift).reps > 0)) continue;
    const movement = movementOf(lift.name);
    if (movement) found.add(movement);
  }
  for (const segment of workout.segments) {
    if (!(segment.completed > 0) && !(segment.seconds > 0)) continue;
    const movement = movementOf(segment.name);
    if (movement) found.add(movement);
  }
  return found;
}

/** The newest day each athlete did each workout. A workout never done is absent. */
export type LastDone = Record<RaceAthlete, Partial<Record<Movement, string>>>;

/**
 * When each of you last did each race workout, on or before today: a session
 * dated ahead has not happened yet. A Together session belongs to neither of
 * you, as it does for the estimate, since it cannot say who did what.
 */
export function lastDone(records: readonly RecordItem[], today: string): LastDone {
  const last: LastDone = { hippos: {}, gators: {} };
  for (const record of records) {
    if (record.kind !== "workout" || record.athlete === "team" || record.day > today) continue;
    const mine = last[record.athlete];
    for (const movement of movementsIn(record)) {
      const held = mine[movement];
      if (held === undefined || record.day > held) mine[movement] = record.day;
    }
  }
  return last;
}

/**
 * The day a workout was last done. onOrBefore marks the newest it can be,
 * not the day itself: the phone holds nothing of it from there on and the
 * server's answer is missing, so all that is known is that it is that old.
 */
export type Seen = { day: string; onOrBefore?: true } | null;
export type SeenTable = Record<RaceAthlete, Record<Movement, Seen>>;

/**
 * What the phone holds against the whole journal's answer. Every day after
 * heldFrom is on the phone whole, so a session there is the answer, and a
 * day the server still names there was deleted here and not sent yet. The
 * days up to heldFrom are the server's to answer, which is where the phone
 * stops knowing. With the whole journal on the phone, heldFrom is null and
 * the phone answers alone.
 */
export function seenTable(phone: LastDone, journal: LastDone | undefined, heldFrom: string | null): SeenTable {
  const table = { hippos: {}, gators: {} } as SeenTable;
  for (const athlete of RACE_ATHLETES) {
    for (const movement of MOVEMENTS) {
      const here = phone[athlete][movement];
      let seen: Seen = null;
      if (heldFrom === null || (here !== undefined && here > heldFrom)) seen = here ? { day: here } : null;
      else if (!journal) seen = { day: heldFrom, onOrBefore: true };
      else {
        const there = journal[athlete][movement];
        const older = [here, there !== undefined && there <= heldFrom ? there : undefined]
          .filter((day): day is string => day !== undefined)
          .sort();
        seen = older.length ? { day: older[older.length - 1] } : null;
      }
      table[athlete][movement] = seen;
    }
  }
  return table;
}

/** Green up to this many days since, yellow up to DUE_DAYS, red past that or never. */
export const FRESH_DAYS = 5;
export const DUE_DAYS = 14;
export type Recency = "fresh" | "due" | "stale";

export function recency(seen: Seen, today: string): Recency {
  if (!seen) return "stale";
  const days = daysBetween(seen.day, today);
  return days <= FRESH_DAYS ? "fresh" : days <= DUE_DAYS ? "due" : "stale";
}

/** "Today", "3d ago", "41d+" when that is only how old it is at least, or "Never". */
export function seenLabel(seen: Seen, today: string) {
  if (!seen) return "Never";
  const days = daysBetween(seen.day, today);
  if (seen.onOrBefore) return `${days}d+`;
  return days === 0 ? "Today" : `${days}d ago`;
}

/** The same, read aloud: "3 days ago", "41 days or more ago". */
export function seenSpoken(seen: Seen, today: string) {
  if (!seen) return "never";
  const days = daysBetween(seen.day, today);
  if (days === 0 && !seen.onOrBefore) return "today";
  const count = `${days} day${days === 1 ? "" : "s"}`;
  return seen.onOrBefore ? `${count} or more ago` : `${count} ago`;
}

export type RunningStep = {
  name: string;
  movement: Movement;
  /** What it asks of the pair, which is the same for both of you: "1RM", "2.4 km each". */
  asks: string[];
  /** The load each of you carries, in kilograms, for a station that has one. */
  kg?: Record<RaceAthlete, number>;
  /** After each load: " / DB" is a dumbbell in each hand. */
  per?: string;
};

export type RunningZone = {
  key: RaceZone;
  name: string;
  /** How long it runs, or its cap. */
  time: string;
  steps: RunningStep[];
  /** The break before the next zone. */
  then?: string;
};

/** Each Strength window, by the minute of the zone's 20 it runs in. */
const STRENGTH_WINDOW: Record<StrengthLift, string> = {
  overhead: "0–5 min",
  squat: "5–10 min",
  deadlift: "10–20 min",
};

/** "Shared calories" reads "shared calories" mid-line; "DB" keeps its capitals. */
const lower = (text: string) => (/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

export const RUNNING_ORDER: RunningZone[] = [
  {
    key: "strength",
    name: "Strength",
    time: "20 min",
    steps: STRENGTH_LIFTS.map((lift) => ({
      name: lift.name,
      movement: lift.key,
      asks: [`${STRENGTH_2027.reps[lift.key]}RM`, STRENGTH_WINDOW[lift.key]],
    })),
    then: "10 min refuel",
  },
  {
    key: "endurance",
    name: "Endurance",
    time: `${ENDURANCE.capSeconds / 60} min cap`,
    steps: [
      { name: "Run", movement: "run", asks: [`${ENDURANCE.runMetres / 1000} km each`] },
      { name: "SkiErg", movement: "ski", asks: ["Max metres", "one erg"] },
    ],
    then: "30 min recovery",
  },
  {
    key: "metcon",
    name: "MetCon X",
    time: `${METCON_CAP_SECONDS / 60} min cap`,
    steps: METCON.map((station) => ({
      name: station.name,
      movement: NAMED.get(station.name)!,
      asks: [
        `${station.target} ${station.unit}`,
        ...(station.before ? [station.before] : []),
        ...(station.note ? [lower(station.note)] : []),
      ],
      ...(station.kg ? { kg: station.kg } : {}),
      ...(station.after ? { per: station.after } : {}),
    })),
  },
];

/** How many of the rows on screen are red for an athlete: done over DUE_DAYS ago, or never. */
export function staleCount(table: SeenTable, athlete: RaceAthlete, today: string) {
  return RUNNING_ORDER.flatMap((zone) => zone.steps).filter(
    (step) => recency(table[athlete][step.movement], today) === "stale",
  ).length;
}
