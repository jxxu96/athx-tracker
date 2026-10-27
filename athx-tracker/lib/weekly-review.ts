import { addDays, daysBetween, isMeal, isWorkout, weekStart } from "./client.ts";
import { averageMacros } from "./fuel.ts";
import { categoryName, isDistanceUnit, segmentBlock, sumMacros, toMetres, type RecordItem, type Workout } from "./domain.ts";

export type ReviewAthlete = "hippos" | "gators";
export type ReviewWindow = { start: string; end: string };

/** Compare the same weekdays for the current week; past weeks use all seven days. */
export function reviewWindows(selectedWeek: string, today: string) {
  const start = weekStart(selectedWeek);
  const end = addDays(start, Math.min(6, Math.max(0, daysBetween(start, today))));
  return { current: { start, end }, previous: { start: addDays(start, -7), end: addDays(end, -7) } };
}

function liftedKg(workout: Workout) {
  return workout.lifts.reduce((sum, lift) => sum + (lift.detail?.length
    ? lift.detail.reduce((total, set) => total + set.kg * set.reps, 0)
    : lift.kg * lift.sets * lift.reps), 0);
}

export function reviewPeriod(records: RecordItem[], athlete: ReviewAthlete, window: ReviewWindow) {
  const entries = records.filter((record) => record.athlete === athlete && record.day >= window.start && record.day <= window.end);
  const workouts = entries.filter(isWorkout);
  const meals = entries.filter(isMeal);
  const knownMeals = meals.filter((meal) => meal.source !== "queued");
  const daysWithMeals = new Set(knownMeals.map((meal) => meal.day)).size;
  const mix = new Map<string, number>();
  let metres = 0;
  for (const workout of workouts) {
    const category = categoryName(workout);
    mix.set(category, (mix.get(category) ?? 0) + 1);
    for (const segment of workout.segments) {
      if (segmentBlock(workout, segment) === "endurance" && isDistanceUnit(segment.unit))
        metres += toMetres(segment.completed, segment.unit);
    }
  }
  return {
    sessions: workouts.length,
    // Only observed clocks/splits, with no double counting or estimated lift time.
    seconds: workouts.reduce((sum, workout) => sum + Math.max(workout.seconds, workout.segments.reduce((total, segment) => total + segment.seconds, 0)), 0),
    untimed: workouts.filter((workout) => workout.seconds === 0 && workout.segments.every((segment) => segment.seconds === 0)).length,
    metres,
    liftedKg: workouts.reduce((sum, workout) => sum + liftedKg(workout), 0),
    mix: [...mix].map(([name, count]) => ({ name, count })),
    average: averageMacros(sumMacros(knownMeals), daysWithMeals),
    daysWithMeals,
    meals: knownMeals.length,
    pendingMeals: meals.length - knownMeals.length,
  };
}
