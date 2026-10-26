import type { Bodyweight, RecordItem, Settings } from "./domain.ts";

type Person = "hippos" | "gators";

/**
 * Every weigh-in by athlete, oldest first, with the weight Setup held before
 * weigh-ins were dated. Worked out once for a screen, rather than once per
 * session it is asked about.
 */
export type BodyweightHistory = {
  baseline: Record<Person, number>;
  weighIns: Record<Person, Bodyweight[]>;
};

const isWeighIn = (record: RecordItem): record is Bodyweight =>
  record.kind === "bodyweight";

/** Same day, the later clock last; untimed ones keep the order they came in. */
function chronological(a: Bodyweight, b: Bodyweight) {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return (a.time ?? "") < (b.time ?? "") ? -1 : (a.time ?? "") > (b.time ?? "") ? 1 : 0;
}

export function bodyweightHistory(
  records: readonly RecordItem[],
  baseline: Settings["bodyweight"] | undefined,
): BodyweightHistory {
  const weighIns: Record<Person, Bodyweight[]> = { hippos: [], gators: [] };
  for (const record of records) if (isWeighIn(record)) weighIns[record.athlete].push(record);
  weighIns.hippos.sort(chronological);
  weighIns.gators.sort(chronological);
  return {
    baseline: { hippos: baseline?.hippos ?? 0, gators: baseline?.gators ?? 0 },
    weighIns,
  };
}

/**
 * The bodyweight in force on a day, in kilograms: the latest weigh-in on or
 * before it. A day before the first weigh-in takes the weight Setup held
 * before weigh-ins were dated, which is the weight every burn used until
 * then, so none of those burns moves. With neither, the first weigh-in, the
 * nearest weight known. Zero when nothing is known, and a burn is withheld.
 */
export function bodyweightOn(history: BodyweightHistory, athlete: Person, day: string) {
  const list = history.weighIns[athlete];
  let found: Bodyweight | undefined;
  for (const weighIn of list) {
    if (weighIn.day > day) break;
    found = weighIn;
  }
  if (found) return found.kg;
  if (history.baseline[athlete] > 0) return history.baseline[athlete];
  return list[0]?.kg ?? 0;
}

/** The latest weight known, which is what Setup shows. */
export function currentBodyweight(history: BodyweightHistory, athlete: Person) {
  const list = history.weighIns[athlete];
  return list.length ? list[list.length - 1] : null;
}

/** Whether any weight is known, so a burn can be worked out at all. */
export function bodyweightKnown(history: BodyweightHistory, athlete: Person) {
  return history.baseline[athlete] > 0 || history.weighIns[athlete].length > 0;
}
