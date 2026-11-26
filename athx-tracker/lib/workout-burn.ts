import { z } from "zod";
import type { BodyweightHistory } from "./bodyweight.ts";
import { segmentBlock, type Workout } from "./domain.ts";
import { draftBodyweights } from "./workout-draft.ts";

export type BurnSide = "hippos" | "gators";
/** One athlete's record about to be saved, and whose column it came from. */
export type BurnRecord = { side: BurnSide; workout: Workout };

/**
 * What a session's burn is worked out from. A burn AI gave is for the workout
 * as it stood then, and once any of this changes the figure is out of date.
 * The title, notes, day, time and who it was for leave it be. Each field is
 * picked by name, so a saved session and the form it opens compare equal
 * whatever order their keys were written in.
 */
export function burnBasis(
  workout: Pick<Workout, "category" | "customCategory" | "seconds" | "segments" | "lifts" | "capHit">,
) {
  return JSON.stringify([
    workout.category,
    workout.customCategory,
    workout.seconds,
    workout.segments.map((segment) => [
      segment.name, segment.unit, segment.completed, segment.target, segment.seconds,
      segmentBlock(workout, segment), segment.kg ?? 0,
    ]),
    workout.lifts.map((lift) => [
      lift.name, lift.kg, lift.sets, lift.reps,
      (lift.detail ?? []).map((set) => [set.kg, set.reps, Boolean(set.failed)]),
    ]),
    Boolean(workout.capHit),
  ]);
}

/** A form's held basis: a burnBasis, "" until it is taken, or null for a box that is not AI's. */
export const isBurnBasis = (item: unknown): item is string | null =>
  item === null || typeof item === "string";

/**
 * The athletes whose burn is worked out again on save: AI gave the figure in
 * the box, nobody has typed over it, and the workout no longer matches the one
 * it was worked out for. aiBurn is each athlete's held basis.
 */
export function staleBurns(
  records: readonly BurnRecord[],
  aiBurn: Record<BurnSide, string | null>,
): BurnSide[] {
  return records
    .filter(({ side, workout }) => {
      const basis = aiBurn[side];
      return workout.kcal !== undefined && Boolean(basis) && basis !== burnBasis(workout);
    })
    .map(({ side }) => side);
}

/**
 * The app's request: each stale athlete's record as it will be saved, their
 * weight on the session's day, and what was described before AI filled the
 * form, while the form still holds it. The route checks it against the
 * records' own schema.
 */
export type BurnRequest = {
  workouts: Partial<Record<BurnSide, Workout>>;
  description?: string;
  bodyweightKg: Partial<Record<BurnSide, number>>;
};

const kcal = z.number().int().min(1).max(20000).nullable();
/** The estimator's answer, null for an athlete it could not tell. */
export const burnAnswerSchema = z.object({
  burn: z.object({ hippos: kcal, gators: kcal }).strict(),
  assumptions: z.string().max(2000),
}).strict();
export type BurnAnswer = z.infer<typeof burnAnswerSchema>;

export function burnRequest(
  stale: readonly BurnRecord[],
  description: string,
  bodyweights: BodyweightHistory | undefined,
  day: string,
): BurnRequest {
  const typed = description.trim().slice(0, 4000);
  return {
    workouts: Object.fromEntries(stale.map(({ side, workout }) => [side, workout])),
    bodyweightKg: draftBodyweights(bodyweights, stale.map(({ side }) => side), day),
    ...(typed ? { description: typed } : {}),
  };
}

/** What the estimator is sent of each record: the workout, not its ids or bookkeeping. */
export function burnPayload(input: BurnRequest) {
  const athletes = (["hippos", "gators"] as const).filter((side) => input.workouts[side]);
  const workouts = Object.fromEntries(athletes.map((side) => {
    const workout = input.workouts[side]!;
    return [side, {
      title: workout.title,
      category: workout.category,
      customCategory: workout.customCategory,
      seconds: workout.seconds,
      segments: workout.segments,
      lifts: workout.lifts,
      ...(workout.capHit ? { capHit: true } : {}),
      notes: workout.notes,
    }];
  }));
  return {
    task: "burn" as const,
    athletes,
    workouts,
    bodyweightKg: input.bodyweightKg,
    ...(input.description ? { description: input.description } : {}),
  };
}

function withoutBurn(workout: Workout): Workout {
  const record = { ...workout };
  delete record.kcal;
  delete record.kcalSource;
  return record;
}

/**
 * What a save did about out-of-date burns: the records to save, each redone
 * athlete's new figure (null for none), and why the request failed, if it did.
 */
export type RedoneBurns = {
  workouts: Workout[];
  redone: Partial<Record<BurnSide, number | null>>;
  failed: string | null;
};

/**
 * The records to save once every out-of-date burn is worked out again. A new
 * figure replaces the old one, and its working goes at the end of the notes as
 * far as they have room. One AI could not tell, or a request that failed,
 * leaves no figure, and the burn falls back on the MET estimate: an old figure
 * for a different workout is never saved. failed says why a request failed.
 */
export async function redoStaleBurns(
  records: readonly BurnRecord[],
  aiBurn: Record<BurnSide, string | null>,
  ask: (stale: BurnRecord[]) => Promise<BurnAnswer>,
): Promise<RedoneBurns> {
  const stale = new Set(staleBurns(records, aiBurn));
  if (stale.size === 0) return { workouts: records.map(({ workout }) => workout), redone: {}, failed: null };
  let answer: BurnAnswer;
  try {
    answer = burnAnswerSchema.parse(await ask(records.filter(({ side }) => stale.has(side))));
  } catch (error) {
    return {
      workouts: records.map(({ side, workout }) => (stale.has(side) ? withoutBurn(workout) : workout)),
      redone: Object.fromEntries([...stale].map((side) => [side, null])),
      failed: error instanceof z.ZodError
        ? "The AI returned an unusable burn."
        // fetch's own failure, offline or with the server out of reach.
        : error instanceof TypeError ? "The estimator could not be reached."
          : error instanceof Error ? error.message : "The AI could not work the burn out.",
    };
  }
  const working = answer.assumptions.trim();
  const redone: Partial<Record<BurnSide, number | null>> = {};
  const workouts = records.map(({ side, workout }) => {
    if (!stale.has(side)) return workout;
    const kcal = answer.burn[side];
    redone[side] = kcal;
    const notes = working
      ? [workout.notes, `Burn redone after edits: ${working}`].filter(Boolean).join("\n\n").slice(0, 2000)
      : workout.notes;
    return { ...withoutBurn(workout), notes, ...(kcal !== null ? { kcal, kcalSource: "ai" as const } : {}) };
  });
  return { workouts, redone, failed: null };
}

/** What a save says about the burns it worked out again. Null when there were none. */
export function redoneBurnNotice(result: RedoneBurns, name: (side: BurnSide) => string) {
  const sides = (["hippos", "gators"] as const).filter((side) => side in result.redone);
  if (sides.length === 0) return null;
  if (result.failed) return {
    title: "Burn not redone",
    description: `${result.failed} Your edits left the old figure out of date, so it was dropped and the log estimates the burn instead.`,
  };
  return {
    title: "Burn redone for your edits",
    description: sides.map((side) => {
      const kcal = result.redone[side];
      return kcal == null ? `${name(side)}: left to the log's estimate` : `${name(side)} ${kcal} kcal`;
    }).join(" · "),
  };
}
