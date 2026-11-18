/**
 * The Session form's draft: the shapes it edits, the fresh rows it starts
 * from, and the small parsers its boxes go through. No React here.
 */
import { EXERCISES, STATIONS } from "@/lib/exercises";
import { dayToDate } from "@/lib/client";
import {
  METCON,
  displayDistance,
  displayLoad,
  fromMetres,
  parseTime,
  standardLoad,
  toMetres,
  type Block,
  type DistanceUnit,
  type Segment,
  type WeightUnit,
  type Workout,
} from "@/lib/domain";

export type Side = "hippos" | "gators";
export type Format = "hippos" | "gators" | "pairs";

/** What the session is made of, shared by both athletes. */
export type Station = {
  name: string;
  custom: string;
  unit: Segment["unit"];
  /**
   * The circuit's target, for one of its stations. Any other station has none:
   * what was done at it is the whole of it. An entry saved short of a target,
   * from before the box went, keeps that target through an edit.
   */
  target: string;
  /** MetCon or endurance work, which matters once a session mixes them. */
  block: Block;
  /** One of the ATHX circuit's stations, shown as prescribed rather than edited. */
  fixed?: boolean;
};

/**
 * What one athlete actually did at one station. load is in the unit on
 * screen; savedKg is the load the entry was opened with, kept exact.
 */
export type Entry = {
  completed: string;
  time: string;
  load: string;
  savedKg?: number;
  /** The load box still holds the standard weight the form put there. */
  prefilled?: boolean;
};

export type SetDraft = { kg: string; reps: string; savedKg?: number; failed?: boolean };
export type LiftSide = {
  kg: string;
  sets: string;
  reps: string;
  savedKg?: number;
  /** Each set has its own weight and reps. Off is one weight for every set. */
  advanced: boolean;
  detail: SetDraft[];
  /**
   * Sets and reps still hold the defaults the form put there when the lift
   * was chosen. Choosing another lift moves them to its defaults, and they
   * alone do not make a column count as used.
   */
  prefilled?: boolean;
};
export type LiftRow = {
  name: string;
  custom: string;
  hippos: LiftSide;
  gators: LiftSide;
};

export const CATEGORIES = [
  "MetCon", "Strength", "Endurance", "Mixed", "Solidcore", "Tennis", "Other",
] as const;

/** A session saved when YTW was its own type still has to show that type. */
export const SAVED_CATEGORIES = [
  "MetCon", "Strength", "Endurance", "Mixed", "Solidcore", "Tennis", "YTW", "Other",
] as const;

/** The circuit's own entry for a station, when it is one of the seven. */
export const circuitStation = (station: Pick<Station, "name" | "fixed">) =>
  station.fixed ? METCON.find((s) => s.name === station.name) : undefined;

/**
 * Whether a station takes a load. A circuit station does when the circuit
 * prescribes one; any other MetCon station may, unless it is counted in
 * calories, which is a machine. Endurance work is never loaded.
 */
export const loadable = (category: Workout["category"], station: Station) => {
  // Solidcore and tennis stations are not lifted, and neither is a session saved
  // when YTW was its own type. MetCon, Mixed and Other may be.
  if (category === "Solidcore" || category === "Tennis" || category === "YTW") return false;
  if (station.block !== "metcon") return false;
  if (station.fixed) return Boolean(circuitStation(station)?.kg);
  return station.unit !== "cal";
};

export const UNITS = ["reps", "m", "cal", "rounds"] as const;

export function convertedDistance(text: string, from: DistanceUnit, to: DistanceUnit) {
  if (text.trim() === "" || from === to) return text;
  const value = Number(text);
  if (!Number.isFinite(value)) return text;
  return displayDistance(fromMetres(toMetres(value, from), to), to);
}

export const OTHER = "Other";

/** The typed name only counts when Other is the choice. */
export const exerciseName = (choice: string, custom: string) =>
  (choice === OTHER ? custom : choice).trim();

export type Groups = readonly { group: string; items: readonly string[] }[];

const LISTED = new Set(EXERCISES.flatMap((group) => group.items));
const STATION_LISTED = new Set(STATIONS.flatMap((group) => group.items));

/** A MetCon station is one of the ATHX stations; endurance work picks from everything. */
export const stationGroups = (block: Block): Groups => (block === "metcon" ? STATIONS : EXERCISES);
export const listedFor = (block: Block) => (block === "metcon" ? STATION_LISTED : LISTED);

/** Reverse of exerciseName: put a saved name back into the picker. */
export const toChoice = (name: string, listed: ReadonlySet<string> = LISTED) =>
  listed.has(name) ? { name, custom: "" } : { name: OTHER, custom: name };

/**
 * A station's name as its part's list can show it. One that list lacks, such
 * as a run moved to MetCon or a lift picked before stations were ATHX only,
 * is typed under Other, so the picker never shows a choice it does not hold.
 */
export const fitPicker = (station: Station): Station => {
  if (station.fixed) return station;
  const name = exerciseName(station.name, station.custom);
  return name === "" ? station : { ...station, ...toChoice(name, listedFor(station.block)) };
};

/** Legacy records can be on the team athlete, which has no column of its own. */
export const sideOf = (athlete: Workout["athlete"]): Side =>
  athlete === "gators" ? "gators" : "hippos";

export const blankEntry = (): Entry => ({ completed: "", time: "", load: "" });
export const blankSet = (): SetDraft => ({ kg: "", reps: "" });
export const blankLiftSide = (): LiftSide => ({
  kg: "", sets: "", reps: "", advanced: false, detail: [],
});
export const blankLift = (): LiftRow => ({
  name: "",
  custom: "",
  hippos: blankLiftSide(),
  gators: blankLiftSide(),
});

export const metconStations = (): Station[] =>
  METCON.map((s) => ({
    name: s.name,
    custom: "",
    unit: s.unit,
    target: String(s.target),
    block: "metcon",
    fixed: true,
  }));

const runStation = (): Station[] => [
  { name: "Run", custom: "", unit: "m", target: "", block: "endurance" },
];

export const stationsFor = (category: Workout["category"]): Station[] =>
  category === "MetCon"
    ? metconStations()
    : category === "Endurance"
      ? runStation()
      : [];

/**
 * Fresh entries for new stations. A circuit station that prescribes a load
 * starts with that athlete's standard weight, rounded to the rack, so saving it
 * untouched records it. Only ever for new stations: an entry opened for editing
 * keeps exactly what was saved, blank included.
 */
export const entriesFor = (stations: Station[], side: Side, unit: WeightUnit): Entry[] =>
  stations.map((station) => {
    const kg = circuitStation(station)?.kg?.[side];
    return kg
      ? { ...blankEntry(), load: standardLoad(kg, unit), prefilled: true }
      : blankEntry();
  });

export const entriesForBoth = (stations: Station[], unit: WeightUnit) => ({
  hippos: entriesFor(stations, "hippos", unit),
  gators: entriesFor(stations, "gators", unit),
});

export const num = (value: string) => (value.trim() === "" ? 0 : Number(value));
/** A saved lift's number as its box shows it: a 0 was a box left blank, so it opens blank. */
export const boxOf = (value: number) => (value > 0 ? String(value) : "");
export const loadBoxOf = (kg: number, unit: WeightUnit) => (kg > 0 ? displayLoad(kg, unit) : "");
/** How many set rows Advanced opens from the simple sets box. One, and never past the cap. */
export const seedCount = (sets: string) => {
  const count = Math.round(num(sets));
  return Math.min(50, count >= 1 ? count : 1);
};
export const seconds = (value: string) => (value.trim() === "" ? 0 : parseTime(value));

/** An untitled session is named after its date, which never goes stale. */
export const dateTitle = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(dayToDate(day));
