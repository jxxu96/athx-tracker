import { METCON, type VolumeUnit } from "./domain.ts";

/** How many sets a lift's one-line boxes start at once the lift is chosen. */
export const DEFAULT_SETS = 3;

/**
 * Reps a lift's one-line boxes start at once the lift is chosen, so leaving
 * them alone saves what they show. Every lift not named here starts at five.
 */
const DEFAULT_REPS: Record<string, number> = {
  "Split jerk": 1,
  Deadlift: 3,
  "Back squat": 5,
  "Bench press": 5,
};

export const defaultReps = (name: string) => DEFAULT_REPS[name] ?? 5;

const ATHX_STATIONS = {
  // Named exactly as the MetCon stations name them, so a lift and a station
  // read the same in the log. Opening and closing row stay distinct; Row is
  // the plain erg when it was not one of those two.
  group: "ATHX stations",
  items: [
    "Opening row",
    "DB ground to overhead",
    "DB bench press",
    "Sandbag squats",
    "Sandbag carry",
    "Burpees over bench",
    "Closing row",
    "Row",
  ],
};

/**
 * What a MetCon station is picked from: the ATHX stations and nothing else.
 * A lift is not a station, and anything not listed is typed under Other.
 */
export const STATIONS: { group: string; items: string[] }[] = [ATHX_STATIONS];

/**
 * The unit a station starts at once it is chosen: the circuit's own for one
 * of its stations, calories for the plain row as for the circuit's two, and
 * reps for anything else. It stays a choice; this is only where it starts.
 */
export function stationUnit(name: string): VolumeUnit {
  if (name === "Row") return "cal";
  return METCON.find((station) => station.name === name)?.unit ?? "reps";
}

/** Picking beats typing on a phone, with a way out for anything not listed. */
export const EXERCISES: { group: string; items: string[] }[] = [
  {
    // The lifts the programme is built around, first because they are typed most.
    group: "Main lifts",
    items: [
      "Deadlift",
      "Back squat",
      "Overhead press",
      "Push press",
      "Split jerk",
    ],
  },
  ATHX_STATIONS,
  {
    group: "Lower body",
    items: [
      "Front squat",
      "Goblet squat",
      "Walking lunge",
      "Bulgarian split squat",
      "Step-up",
    ],
  },
  {
    group: "Upper push",
    items: ["Bench press", "Incline bench press", "Dip", "Push-up", "Lu Raises", "Tricep kickbacks"],
  },
  {
    group: "Upper pull",
    items: [
      "Pull-up",
      "Curls",
      "Barbell row",
      "Dumbbell row",
      "Lat pulldown",
      "Face pull",
      "YTWs",
    ],
  },
  {
    group: "Power",
    items: [
      "Power clean",
      "Clean and jerk",
      "Snatch",
      "Dumbbell snatch",
      "Kettlebell swing",
    ],
  },
  {
    group: "Conditioning",
    items: ["Bike erg", "Ski erg", "Run", "Burpee"],
  },
];
