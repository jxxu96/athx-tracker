import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyweightHistory } from "./bodyweight.ts";
import type { Workout } from "./domain.ts";
import { workoutSchema } from "./validation.ts";
import {
  burnAnswerSchema, burnBasis, burnPayload, burnRequest, redoneBurnNotice, redoStaleBurns, staleBurns,
  type BurnAnswer, type BurnRecord,
} from "./workout-burn.ts";
// The app image's build context excludes its sibling estimator directory.
const { BURN_TASK } = await import(new URL("../../estimator/workout.mjs", import.meta.url).href);

const tennis: Workout = {
  id: "7b0c8a52-5d0e-4e7a-9f60-0d3a3c1f2b11", kind: "workout", athlete: "hippos", day: "2026-11-20",
  title: "Tennis", category: "Tennis", customCategory: "", seconds: 3600, notes: "Hippos 420 kcal: MET 7, 60 min, 82 kg.",
  segments: [], fatigue: 10, transition: 0, goal: null, context: "solo", lifts: [], kcal: 420, kcalSource: "ai",
};
const squats: Workout = {
  ...tennis, id: "0f6f3c1e-2a8b-4c55-8d0e-5b7a9e2c4d33", athlete: "gators", title: "Squats", category: "Strength",
  seconds: 0, notes: "", kcal: 120, lifts: [{ name: "Back squat", kg: 60, sets: 3, reps: 5 }],
};
const names = { hippos: "Hippos", gators: "Gators" } as const;
const without = (workout: Workout, ...keys: (keyof Workout)[]) =>
  Object.fromEntries(Object.entries(workout).filter(([key]) => !keys.includes(key as keyof Workout))) as Workout;
const retitled: Workout = { ...tennis, title: "Singles", notes: "Windy", day: "2026-11-21", time: "07:00" };

test("a burn is out of date once the workout it was for changes, and not for its title, notes or day", () => {
  const basis = burnBasis(tennis);
  assert.equal(burnBasis(retitled), basis);
  assert.equal(burnBasis(without(tennis, "kcal", "kcalSource")), basis, "the figure is not what it was worked out from");
  for (const changed of [
    { seconds: 2700 }, { category: "Other" as const }, { customCategory: "Padel" }, { capHit: true },
    { segments: [{ name: "Run", unit: "m" as const, completed: 400, target: 400, seconds: 90, block: "endurance" as const }] },
    { lifts: [{ name: "Back squat", kg: 60, sets: 3, reps: 5 }] },
  ]) assert.notEqual(burnBasis({ ...tennis, ...changed }), basis, JSON.stringify(changed));
});

test("a saved session and the form it opens compare equal, whatever order their keys came in", () => {
  const run = { name: "Run", unit: "m" as const, completed: 400, target: 400, seconds: 90, block: "endurance" as const };
  const mixed: Workout = { ...squats, category: "Mixed", segments: [run],
    lifts: [{ name: "Back squat", kg: 80, sets: 1, reps: 3, detail: [{ kg: 60, reps: 5 }, { kg: 80, reps: 3, failed: true }] }] };
  const reordered: Workout = { ...mixed,
    segments: [{ block: "endurance", seconds: 90, target: 400, completed: 400, unit: "m", name: "Run" }],
    lifts: [{ detail: [{ reps: 5, kg: 60 }, { failed: true, reps: 3, kg: 80 }], reps: 3, sets: 1, kg: 80, name: "Back squat" }] };
  assert.equal(burnBasis(reordered), burnBasis(mixed));
  // A station saved before parts were kept is its session's part.
  const endurance: Workout = { ...tennis, category: "Endurance", segments: [run] };
  const legacy = { name: "Run", unit: "m" as const, completed: 400, target: 400, seconds: 90 };
  assert.equal(burnBasis({ ...endurance, segments: [legacy] }), burnBasis(endurance));
  // A set's failed last rep is a different set.
  assert.notEqual(burnBasis({ ...mixed, lifts: [{ ...mixed.lifts[0], detail: [{ kg: 60, reps: 5 }, { kg: 80, reps: 3 }] }] }), burnBasis(mixed));
});

test("only an AI burn the workout has moved away from is worked out again", () => {
  const records: BurnRecord[] = [
    { side: "hippos", workout: { ...tennis, seconds: 2700 } },
    { side: "gators", workout: squats },
  ];
  // Hippos' tennis was cut to 45 minutes; Gators' squats are as AI saw them.
  assert.deepEqual(staleBurns(records, { hippos: burnBasis(tennis), gators: burnBasis(squats) }), ["hippos"]);
  // A typed figure, a basis not taken yet, or no figure left in the box is never redone.
  assert.deepEqual(staleBurns(records, { hippos: null, gators: burnBasis(tennis) }), ["gators"]);
  assert.deepEqual(staleBurns(records, { hippos: "", gators: null }), []);
  const cleared = without(records[0].workout, "kcal", "kcalSource");
  assert.deepEqual(staleBurns([{ side: "hippos", workout: cleared }], { hippos: burnBasis(tennis), gators: null }), []);
});

test("the estimator is sent each stale workout, the weight on its day, and what was described", () => {
  const history = bodyweightHistory(
    [{ id: "hippos-2026-11-01", kind: "bodyweight", athlete: "hippos", day: "2026-11-01", kg: 82.04 }],
    { hippos: 0, gators: 0 },
  );
  const request = burnRequest([{ side: "hippos", workout: tennis }], "  Tennis for an hour ", history, tennis.day);
  assert.deepEqual(request, { workouts: { hippos: tennis }, bodyweightKg: { hippos: 82 }, description: "Tennis for an hour" });
  assert.equal("description" in burnRequest([{ side: "hippos", workout: tennis }], " ", undefined, tennis.day), false);
  // Every record it sends passes the records' own schema, which the route checks.
  assert.equal(workoutSchema.safeParse(tennis).success, true);
  assert.deepEqual(burnPayload(request), {
    task: "burn", athletes: ["hippos"], bodyweightKg: { hippos: 82 }, description: "Tennis for an hour",
    workouts: { hippos: {
      title: "Tennis", category: "Tennis", customCategory: "", seconds: 3600, segments: [], lifts: [],
      notes: tennis.notes,
    } },
  });
});

test("a saved source needs a saved burn", () => {
  assert.equal(workoutSchema.safeParse(without(tennis, "kcal")).success, false);
  assert.equal(workoutSchema.safeParse(without(tennis, "kcalSource")).success, true);
});

test("an answer the estimator gives is one the app takes", () => {
  const answer = { burn: { hippos: 310, gators: null }, assumptions: "Hippos 310 kcal: MET 7, 45 min, 82 kg." };
  assert.deepEqual(BURN_TASK.clean(answer), answer);
  assert.deepEqual(burnAnswerSchema.parse(answer), answer);
  for (const hippos of [0, 310.5, 20001]) {
    const bad = { ...answer, burn: { hippos, gators: null } };
    assert.equal(BURN_TASK.clean(bad), null, String(hippos));
    assert.equal(burnAnswerSchema.safeParse(bad).success, false, String(hippos));
  }
});

test("a redone burn replaces the old one and adds its working to the notes", async () => {
  const records: BurnRecord[] = [
    { side: "hippos", workout: { ...tennis, seconds: 2700 } },
    { side: "gators", workout: squats },
  ];
  const asked: BurnRecord[][] = [];
  const result = await redoStaleBurns(records, { hippos: burnBasis(tennis), gators: burnBasis(squats) }, async (stale) => {
    asked.push(stale);
    return { burn: { hippos: 310, gators: 999 }, assumptions: "Hippos 310 kcal: MET 7, 45 min, 82 kg." };
  });
  assert.deepEqual(asked, [[records[0]]], "only the stale athlete is asked about");
  assert.equal(result.failed, null);
  assert.deepEqual(result.redone, { hippos: 310 });
  assert.equal(result.workouts[0].kcal, 310);
  assert.equal(result.workouts[0].kcalSource, "ai");
  assert.equal(result.workouts[0].notes, `${tennis.notes}\n\nBurn redone after edits: Hippos 310 kcal: MET 7, 45 min, 82 kg.`);
  assert.equal(result.workouts[1], squats, "a burn still current is left as it is");
  assert.deepEqual(redoneBurnNotice(result, (side) => names[side]), {
    title: "Burn redone for your edits", description: "Hippos 310 kcal",
  });
});

test("notes keep their room, and an athlete AI cannot tell is left to the log's estimate", async () => {
  const full = { ...tennis, seconds: 2700, notes: "x".repeat(1990) };
  const result = await redoStaleBurns([{ side: "hippos", workout: full }], { hippos: burnBasis(tennis), gators: null },
    async () => ({ burn: { hippos: null, gators: null }, assumptions: "Too little to tell how hard it was." }));
  assert.equal(result.workouts[0].notes.length, 2000);
  assert.ok(result.workouts[0].notes.startsWith(full.notes));
  assert.equal("kcal" in result.workouts[0], false);
  assert.equal("kcalSource" in result.workouts[0], false);
  assert.equal(workoutSchema.safeParse(result.workouts[0]).success, true);
  assert.deepEqual(redoneBurnNotice(result, (side) => names[side])?.description, "Hippos: left to the log's estimate");
});

test("a failed or unusable answer drops the out-of-date figure rather than saving it", async () => {
  const records: BurnRecord[] = [{ side: "hippos", workout: { ...tennis, seconds: 2700 } }];
  const aiBurn = { hippos: burnBasis(tennis), gators: null };
  const failed = await redoStaleBurns(records, aiBurn, async () => { throw new Error("The estimator did not answer with a burn."); });
  assert.equal(failed.failed, "The estimator did not answer with a burn.");
  assert.equal("kcal" in failed.workouts[0], false);
  assert.equal(failed.workouts[0].notes, tennis.notes);
  assert.equal(redoneBurnNotice(failed, (side) => names[side])?.title, "Burn not redone");
  const offline = await redoStaleBurns(records, aiBurn, async () => { throw new TypeError("Failed to fetch"); });
  assert.equal(offline.failed, "The estimator could not be reached.");
  const unusable = await redoStaleBurns(records, aiBurn, async () => ({ burn: { hippos: 12.5 } }) as unknown as BurnAnswer);
  assert.equal(unusable.failed, "The AI returned an unusable burn.");
  assert.equal("kcal" in unusable.workouts[0], false);
});

test("nothing out of date asks nothing and says nothing", async () => {
  const records: BurnRecord[] = [{ side: "hippos", workout: tennis }];
  const result = await redoStaleBurns(records, { hippos: burnBasis(tennis), gators: null }, async () => {
    throw new Error("asked");
  });
  assert.deepEqual(result, { workouts: [tennis], redone: {}, failed: null });
  assert.equal(redoneBurnNotice(result, (side) => names[side]), null);
});
