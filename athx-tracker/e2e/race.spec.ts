import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";
import { DEFAULT_SETTINGS, METCON } from "../lib/domain.ts";
import { FIELD_DATA } from "../lib/field-data.ts";

type Lift = { name: string; kg: number; sets: number; reps: number };
type Segment = {
  name: string; unit: string; completed: number; target: number; seconds: number;
  block: "metcon" | "endurance";
};
type Session = {
  athlete: "hippos" | "gators";
  day?: string;
  category: string;
  seconds?: number;
  lifts?: Lift[];
  segments?: Segment[];
};

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
}

async function log(page: Page, sessions: Session[]) {
  await page.evaluate(async (sessions) => {
    for (const session of sessions) {
      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(), kind: "workout", athlete: session.athlete, day: session.day ?? "2026-10-20",
          title: session.category, category: session.category, customCategory: "",
          seconds: session.seconds ?? 0, notes: "", segments: session.segments ?? [],
          fatigue: 10, transition: 0, goal: null, context: "solo", lifts: session.lifts ?? [],
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    }
  }, sessions);
}

const piece = (name: string, completed: number, unit: string, seconds: number): Segment => ({
  name, unit, completed, target: completed, seconds, block: "endurance",
});
/** The whole circuit at these splits, in METCON's order. */
const circuit = (splits: number[]): Segment[] =>
  METCON.map((station, index) => ({
    name: station.name, unit: station.unit, completed: station.target, target: station.target,
    seconds: splits[index], block: "metcon",
  }));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

async function audit(page: Page, context: string) {
  // Let the theme's colour transitions land before reading contrast.
  await page.waitForTimeout(500);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const described = violations.map(
    (v) => `${context}: ${v.id} (${v.impact}) — ${v.help} [${v.nodes.length}]`,
  );
  expect(described, described.join("\n")).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // An empty journal and the settings as they come, so no other spec's
  // sessions leak into these numbers.
  await page.evaluate(async (settings) => {
    const data = await fetch("/api/records").then((r) => r.json());
    for (const record of data.records as { id: string }[]) {
      await fetch("/api/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id }),
      });
    }
    const { revision } = await fetch("/api/settings").then((r) => r.json());
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings, revision }),
    });
  }, DEFAULT_SETTINGS);
});

test("with nothing logged, each part of the estimate says what it needs", async ({ page }) => {
  await page.reload();
  const strength = page.getByRole("group", { name: "Strength estimate" });
  await expect(strength).toContainText(
    "Still to log: Hippos shoulder to overhead, back squat and deadlift; Gators shoulder to overhead, back squat and deadlift.",
  );
  await expect(page.getByRole("group", { name: "Endurance estimate" })).toContainText(
    "Still to log: a run for Hippos and Gators; a SkiErg piece for Hippos and Gators, each 1 km or longer.",
  );
  await expect(page.getByRole("group", { name: "MetCon X estimate" })).toContainText(
    "Log the circuit with a split at each station to estimate it.",
  );
});

test("the race-day estimate covers all three zones from what is logged", async ({ page }) => {
  const gators = [120, 90, 60, 90, 60, 120, 160];
  // Hippos is quicker at the bench press, on dumbbells half the weight.
  const hippos = [240, 90, 45, 180, 120, 120, 240];
  await log(page, [
    {
      athlete: "hippos", category: "Strength",
      lifts: [
        { name: "Overhead press", kg: 40, sets: 3, reps: 5 },
        { name: "Back squat", kg: 70, sets: 2, reps: 2 },
        { name: "Deadlift", kg: 90, sets: 1, reps: 3 },
      ],
    },
    {
      athlete: "gators", category: "Strength",
      lifts: [
        { name: "Split jerk", kg: 80, sets: 1, reps: 1 },
        { name: "Back squat", kg: 100, sets: 3, reps: 5 },
        { name: "Deadlift", kg: 140, sets: 3, reps: 5 },
        // A different lift, which must not stand in for the deadlift.
        { name: "Romanian deadlift", kg: 180, sets: 3, reps: 5 },
      ],
    },
    { athlete: "hippos", category: "Endurance", segments: [piece("Run", 2.4, "km", 840)] },
    { athlete: "gators", category: "Endurance", segments: [piece("Run", 2400, "m", 720)] },
    { athlete: "hippos", category: "Mixed", segments: [piece("Ski erg", 1000, "m", 300)] },
    { athlete: "gators", category: "Mixed", segments: [piece("Ski erg", 2000, "m", 420)] },
    { athlete: "gators", category: "MetCon", seconds: sum(gators) + 60, segments: circuit(gators) },
    { athlete: "hippos", category: "MetCon", seconds: sum(hippos), segments: circuit(hippos) },
  ]);
  await page.reload();

  // Hippos 40 + 70 + 90, Gators 80 + 100 + 140: fives count at their load, never carried up.
  const strength = page.getByRole("group", { name: "Strength estimate" });
  await expect(strength).toContainText("520 kg");
  await expect(strength.getByRole("row", { name: /^Hippos/ })).toHaveText(/Hippos\s*40\s*70\s*90\s*200/);
  await expect(strength.getByRole("row", { name: /^Gators/ })).toHaveText(/Gators\s*80\s*100\s*140\s*320/);
  await expect(strength.getByRole("row", { name: /^Combined/ })).toHaveText(/Combined\s*120\s*170\s*230\s*520/);
  await expect(strength).toContainText("Hippos 38%");
  await expect(strength).toContainText("Gators 62%");
  await expect(strength).toContainText("S2OH counts Hippos' overhead press and Gators' split jerk.");
  // 2026 allowed no jerks, so Gators has nothing to be placed on yet.
  await expect(strength).toContainText(
    "A percentile against 2026's 264 mixed Lite pairs needs a strict press for Gators: that season allowed no jerks.",
  );
  await expect(strength).not.toContainText("Still to log");

  const endurance = page.getByRole("group", { name: "Endurance estimate" });
  await expect(endurance).toContainText("3,000 m SkiErg");
  await expect(endurance).toContainText("Run 2.4 km · Hippos 14:00 · Gators 12:00");
  await expect(endurance).toContainText(
    "SkiErg from 12:00 · Hippos 1,000 m in 5:00 · Gators 2,000 m in 7:00",
  );

  // 715 s of stations for the pair, and Gators' clock shows 10 s at each of the six changes.
  const metcon = page.getByRole("group", { name: "MetCon X estimate" });
  await expect(metcon).toContainText("12:55");
  await expect(metcon).toContainText("Hippos takes DB bench press, Gators the rest; the carry is 30 m each.");
  await expect(metcon).toContainText("Includes 1:00 moving between stations.");

  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    await audit(page, `${theme} theme`);
  }
});

test("a best older than the loaded slice is in the estimate without loading it", async ({ page }) => {
  // The app opens with the latest 400 entries. Hippos' deadlift sits behind
  // them, and the server works the estimate out over the whole journal.
  await log(page, [
    { athlete: "hippos", category: "Strength", lifts: [{ name: "Deadlift", kg: 90, sets: 1, reps: 3 }] },
  ]);
  await page.evaluate(async () => {
    const meals = Array.from({ length: 400 }, () => ({
      id: crypto.randomUUID(), kind: "meal", athlete: "hippos", day: "2026-10-25",
      name: "Seeded meal", meal: "Lunch", source: "manual", assumptions: "",
      macros: { calories: 400, protein: 30, carbs: 40, fat: 12 },
    }));
    for (let i = 0; i < meals.length; i += 25) {
      await Promise.all(meals.slice(i, i + 25).map((meal) =>
        fetch("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(meal),
        })));
    }
  });
  await page.reload();

  const strength = page.getByRole("group", { name: "Strength estimate" });
  await expect(strength.getByRole("row", { name: /^Hippos/ })).toHaveText(/Hippos\s*—\s*—\s*90\s*—/);
  await expect(strength).toContainText("Still to log: Hippos shoulder to overhead and back squat;");
  await expect(page.getByText(/Using the latest/)).toHaveCount(0);
});

test("the pair's Strength is placed among 2026's mixed Lite pairs, live", async ({ page }) => {
  await log(page, [
    {
      athlete: "gators", category: "Strength",
      lifts: [
        { name: "Overhead press", kg: 54.43, sets: 1, reps: 1 },
        { name: "Split jerk", kg: 57, sets: 1, reps: 1 },
        { name: "Back squat", kg: 65, sets: 1, reps: 2 },
        { name: "Deadlift", kg: 102, sets: 1, reps: 3 },
      ],
    },
    {
      athlete: "hippos", category: "Strength",
      lifts: [
        { name: "Overhead press", kg: 32, sets: 1, reps: 1 },
        { name: "Back squat", kg: 41, sets: 1, reps: 2 },
        { name: "Deadlift", kg: 71, sets: 1, reps: 3 },
      ],
    },
  ]);
  await page.reload();

  // On 2026's lifts: Hippos 32 + 40 + 67, Gators 54 + 63 + 96.
  const field = FIELD_DATA.strength;
  const ahead = field.filter((kg) => kg < 352).length;
  const share = Math.round((100 * (ahead + field.filter((kg) => kg === 352).length / 2)) / field.length);
  const strength = page.getByRole("group", { name: "Strength estimate" });
  await expect(strength).toContainText(
    new RegExp(`${share}(st|nd|rd|th) percentile · ahead of ${ahead} of 2026's ${field.length} mixed Lite pairs`),
  );
  await expect(strength).toContainText("352 kg on that season's lifts (strict press, 3RM squat, 5RM deadlift)");
  await expect(strength).not.toContainText("needs a strict press");

  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    await audit(page, `${theme} theme`);
  }
});

test("Progress measures each zone from its first estimate to its goal, Strength's from the lift targets", async ({ page }) => {
  const lifts = (kg: number) => [
    { name: "Overhead press", kg, sets: 1, reps: 1 },
    { name: "Back squat", kg, sets: 1, reps: 2 },
    { name: "Deadlift", kg, sets: 1, reps: 3 },
  ];
  await log(page, [
    { athlete: "hippos", category: "Strength", day: "2026-10-01", lifts: lifts(40) },
    { athlete: "gators", category: "Strength", day: "2026-10-05", lifts: lifts(60) },
    { athlete: "gators", category: "Strength", day: "2026-10-20", lifts: lifts(80) },
  ]);
  await page.evaluate(async () => {
    const { settings, revision } = await fetch("/api/settings").then((r) => r.json());
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          ...settings,
          // Each the rep max its window asks for. Gators' split jerk is the higher, so it is the S2OH goal.
          liftTargets: {
            hippos: { splitJerk: 0, overheadPress: 0, pushPress: 40, backSquat: 72, deadlift: 90 },
            gators: { splitJerk: 80, overheadPress: 60, backSquat: 108, deadlift: 144 },
          },
          raceGoals: { endurance: 0, metcon: 900 },
        },
        revision,
      }),
    });
  });
  await page.reload();

  // 120 + 180 on 5 Oct, 120 + 240 now. The goal is 40 + 72 + 90 and
  // 80 + 108 + 144: 60 of the 234 kg from start to goal.
  const strength = page.getByRole("group", { name: "Strength progress" });
  await expect(strength).toContainText("360\u00a0kg");
  await expect(strength).toContainText("26%");
  await expect(strength).toContainText("Start 300\u00a0kg · Mon 5 Oct");
  await expect(strength).toContainText("Goal 534\u00a0kg");
  await expect(page.getByRole("group", { name: "Endurance progress" })).toContainText(
    "No estimate yet",
  );
  await expect(page.getByRole("group", { name: "Endurance progress" })).toContainText(
    "No goal in Setup",
  );
  await expect(page.getByRole("group", { name: "MetCon X progress" })).toContainText("Goal 15:00");

  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    await audit(page, `${theme} theme`);
  }
});
