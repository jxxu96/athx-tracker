import { z } from "zod";
const finite = z.number().finite().nonnegative();
export const macroSchema = z.object({
  calories: finite.max(20000), protein: finite.max(2000), carbs: finite.max(3000), fat: finite.max(2000),
}).strict();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v;
}, "Invalid calendar date");
const base = { id: z.string().uuid(), day };
export const workoutSchema = z.object({
  ...base, kind: z.literal("workout"), athlete: z.enum(["hippos", "gators", "team"]),
  title: z.string().trim().min(1).max(120),
  category: z.enum(["Strength", "Endurance", "MetCon", "Solidcore", "Tennis", "Other"]),
  // Defaulted, so sessions written before Other could be named still parse.
  customCategory: z.string().trim().max(60).default(""),
  seconds: finite.max(86400), notes: z.string().max(2000),
  segments: z.array(z.object({
    name: z.string().trim().min(1).max(100), unit: z.enum(["reps", "m", "cal", "rounds"]),
    completed: finite, target: finite.positive(), seconds: finite.max(86400),
  }).strict().refine(s => s.completed <= s.target, "Completed volume exceeds target")
    .refine(s => s.completed > 0 || s.seconds === 0, "A station time needs completed work with it")).max(30),
  fatigue: finite.max(50), transition: finite.max(3600), goal: finite.positive().max(86400).nullable(),
  context: z.enum(["solo", "pairs"]),
  lifts: z.array(z.object({ name: z.string().min(1).max(80), kg: finite.positive().max(1000), sets: z.number().int().min(1).max(50), reps: z.number().int().min(1).max(100) }).strict()).max(30),
}).strict().refine(w => w.seconds === 0 || w.segments.reduce((n,s) => n+s.seconds,0) <= w.seconds + 1, "Station times exceed elapsed workout time");
export const mealSchema = z.object({
  ...base, kind: z.literal("meal"), athlete: z.enum(["hippos", "gators"]),
  name: z.string().trim().min(1).max(300), meal: z.enum(["Breakfast","Lunch","Dinner","Snack"]),
  macros: macroSchema, source: z.enum(["manual","grok","queued"]), assumptions: z.string().max(3000),
}).strict();
/** What an estimator has to come back with, wherever the answer came from. */
export const estimateSchema = macroSchema.extend({
  name: z.string().min(1).max(300),
  assumptions: z.string().max(3000),
  confidence: z.enum(["low", "medium", "high"]),
});
export const recordSchema = z.union([workoutSchema, mealSchema]);
export const settingsSchema = z.object({
  eventDate: day, eventName: z.string().trim().min(1).max(100),
  weeklyTarget: z.number().int().min(1).max(21), weightUnit: z.enum(["kg","lb"]).default("lb"),
  targets: z.object({ hippos: macroSchema, gators: macroSchema }).strict(),
  // Defaulted, so settings stored before bodyweight existed still parse.
  bodyweight: z.object({ hippos: finite.max(500), gators: finite.max(500) })
    .strict().default({ hippos: 0, gators: 0 }),
}).strict();
