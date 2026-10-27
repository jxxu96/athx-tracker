import { bodyweightOn, type BodyweightHistory } from "./bodyweight.ts";
import { SEX, type Settings } from "./domain.ts";

type Person = "hippos" | "gators";

/**
 * Resting energy, in kcal a day, from Mifflin and St Jeor's equation (Am J
 * Clin Nutr 1990;51:241-7): 10 x kg + 6.25 x cm - 5 x age, plus 5 for a man
 * or minus 161 for a woman. It is what a body spends at rest. Everyday
 * movement and digesting food come on top of it, and training is counted on
 * its own, so resting plus training is less than a day's whole spend.
 * Null when anything is missing, rather than a figure that looks measured.
 */
export function restingEnergy(input: {
  kg: number;
  cm: number;
  age: number;
  sex: "female" | "male";
}) {
  const { kg, cm, age, sex } = input;
  if (!(kg > 0) || !(cm > 0) || !(age > 0)) return null;
  return 10 * kg + 6.25 * cm - 5 * age + (sex === "male" ? 5 : -161);
}

/** Whole years on a day from a birth year, which is right to within one. */
export function ageOn(birthYear: number, day: string) {
  if (!(birthYear > 0)) return 0;
  return Number(day.slice(0, 4)) - birthYear;
}

/** One athlete's resting energy on a day, at the weight in force that day. */
export function restingOn(
  settings: Pick<Settings, "height" | "birthYear">,
  history: BodyweightHistory,
  athlete: Person,
  day: string,
) {
  return restingEnergy({
    kg: bodyweightOn(history, athlete, day),
    cm: settings.height?.[athlete] ?? 0,
    age: ageOn(settings.birthYear?.[athlete] ?? 0, day),
    sex: SEX[athlete],
  });
}
