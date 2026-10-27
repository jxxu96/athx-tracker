import type { RecordItem } from "./domain.ts";
import { FIELD_DATA } from "./field-data.ts";
import {
  RACE_ATHLETES,
  STRENGTH_2026,
  STRENGTH_LIFTS,
  strengthPlan,
  type RaceAthlete,
  type StrengthLift,
} from "./race.ts";

/**
 * Where the pair would have placed in the last full season: every mixed ATHX
 * Lite pair's Strength score from 2026, as the ATHX leaderboard lists it,
 * pulled by scripts/pull-field.mjs. That season scored a strict press for one,
 * a back squat for three and a deadlift for five, so the pair is scored on
 * those lifts too: a 2027 total set against it would flatter. Endurance and
 * MetCon X changed format for 2027, so they have no fair field until 2027
 * results exist.
 */
export const FIELD = { ...FIELD_DATA, label: "mixed Lite pairs" };

/** What each window was in the field's season, for saying what is missing. */
export const FIELD_LIFTS: Record<StrengthLift, string> = {
  overhead: "strict press",
  squat: "back squat",
  deadlift: "deadlift",
};

/** The share of a field below a score, a tie counting half, as a percent. */
export function percentile(score: number, field: readonly number[]) {
  let below = 0;
  let ties = 0;
  for (const value of field) {
    if (value < score) below += 1;
    else if (value === score) ties += 1;
  }
  return (100 * (below + ties / 2)) / field.length;
}

function middle(sorted: readonly number[]) {
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

export type StrengthPlacing = {
  /** The pair's total on the field's lifts, in whole kilograms. Null while a lift is missing. */
  total: number | null;
  /** Whole percent of the field below the total. */
  percentile: number | null;
  /** Pairs in the field with a lower total. */
  ahead: number;
  pairs: number;
  median: number;
  /** Lifts still to log, on the field's terms, before the pair can be placed. */
  missing: { athlete: RaceAthlete; lift: StrengthLift }[];
};

/** The pair's Strength placed in the field, from the journal as it stands. */
export function strengthPlacing(
  records: RecordItem[],
  field: readonly number[] = FIELD.strength,
): StrengthPlacing {
  const plan = strengthPlan(records, STRENGTH_2026);
  const total = plan.combined;
  return {
    total,
    percentile: total === null ? null : Math.round(percentile(total, field)),
    ahead: total === null ? 0 : field.filter((kg) => kg < total).length,
    pairs: field.length,
    median: middle(field),
    missing: RACE_ATHLETES.flatMap((athlete) =>
      STRENGTH_LIFTS.filter(({ key }) => !plan.athletes[athlete].lifts[key]).map(({ key }) => ({
        athlete,
        lift: key,
      })),
    ),
  };
}
