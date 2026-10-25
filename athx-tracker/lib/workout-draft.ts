import { z } from "zod";
import { VOLUME_UNITS } from "./domain.ts";

const amount = z.number().finite().nonnegative();
const seconds = amount.max(86400).nullable();
const kg = amount.positive().max(1000).nullable();
const liftSide = z.object({
  kg, sets: amount.int().min(1).max(50).nullable(),
  reps: amount.int().min(1).max(100).nullable(),
}).strict();
const stationSide = z.object({ completed: amount.nullable(), seconds, kg }).strict();

/** Null means unreported, so the form keeps that box empty. Weights are always kg. */
export const workoutDraftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.enum(["Strength", "Endurance", "MetCon", "Mixed", "Solidcore", "Tennis", "YTW", "Other"]),
  customCategory: z.string().trim().max(60),
  notes: z.string().max(2000),
  assumptions: z.string().max(2000),
  elapsed: z.object({ hippos: seconds, gators: seconds }).strict(),
  lifts: z.array(z.object({
    name: z.string().trim().min(1).max(80), hippos: liftSide, gators: liftSide,
  }).strict()).max(30),
  stations: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    unit: z.enum(VOLUME_UNITS),
    target: amount.positive(), block: z.enum(["metcon", "endurance"]),
    hippos: stationSide, gators: stationSide,
  }).strict()).max(30),
}).strict().superRefine((draft, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  // Mixed keeps every panel visible when the description includes different kinds of work.
  if (draft.lifts.length && !["Strength", "Mixed", "Other"].includes(draft.category))
    issue("This category cannot display lifts.");
  if (draft.stations.length && draft.category === "Strength") issue("Strength cannot display stations.");
  if (draft.category === "Endurance" && draft.stations.some(s => s.block !== "endurance"))
    issue("Endurance stations must be endurance work.");
  for (const side of ["hippos", "gators"] as const) {
    let total = 0;
    for (const station of draft.stations) {
      const entry = station[side];
      total += entry.seconds ?? 0;
      if ((entry.completed ?? 0) > station.target) issue("Completed volume exceeds target.");
      if ((entry.seconds ?? 0) > 0 && !(entry.completed! > 0)) issue("Station time needs completed work.");
      if (station.block === "endurance" && entry.kg !== null) issue("Endurance loads cannot be displayed.");
      if (["Solidcore", "Tennis", "YTW"].includes(draft.category) && entry.kg !== null)
        issue("This category cannot display station loads.");
    }
    if (draft.elapsed[side] !== null && total > draft.elapsed[side]! + 1)
      issue("Station times exceed elapsed time.");
  }
});

export type WorkoutDraft = z.infer<typeof workoutDraftSchema>;
