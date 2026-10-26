import { bodyweightHistory } from "./bodyweight.ts";
import { DEFAULT_SETTINGS, type RecordItem, type Settings } from "./domain.ts";
import { strengthPlacing, type StrengthPlacing } from "./field.ts";
import { athleteFuel, teamSessions, type AthleteFuel } from "./fuel.ts";
import { liftProgress, togetherLiftSessions, type LiftProgress } from "./progress.ts";
import { raceEstimate } from "./race.ts";

/**
 * The figures that need the whole journal: the race-day estimate, Progress,
 * and Fuel over the whole journal. A phone holds only the recent slice, so
 * the server works these out over everything and sends the results, which
 * are a few kilobytes however deep the journal gets. They are the same
 * functions the phone runs, so with the whole journal in hand the phone
 * works them out itself, and the two agree.
 */
export type JournalSummary = {
  /** The day they were worked out for, which is the phone's day when it asked. */
  today: string;
  race: ReturnType<typeof raceEstimate>;
  placing: StrengthPlacing;
  lifts: Record<"hippos" | "gators", LiftProgress[]>;
  togetherLifts: number;
  overall: Record<"hippos" | "gators", AthleteFuel>;
  togetherOverall: number;
};

export function journalSummary(
  records: RecordItem[],
  stored: Settings | undefined,
  today: string,
): JournalSummary {
  const settings = stored ?? DEFAULT_SETTINGS;
  const targets = settings.liftTargets ?? DEFAULT_SETTINGS.liftTargets;
  const history = bodyweightHistory(records, settings.bodyweight);
  return {
    today,
    race: raceEstimate(records),
    placing: strengthPlacing(records),
    lifts: {
      hippos: liftProgress(records, "hippos", targets.hippos, today),
      gators: liftProgress(records, "gators", targets.gators, today),
    },
    togetherLifts: togetherLiftSessions(records),
    overall: {
      hippos: athleteFuel(records, "hippos", "overall", today, settings, history),
      gators: athleteFuel(records, "gators", "overall", today, settings, history),
    },
    togetherOverall: teamSessions(records, "overall", today),
  };
}
