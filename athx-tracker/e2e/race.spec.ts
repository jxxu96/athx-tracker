import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";
import { DEFAULT_SETTINGS, METCON } from "../lib/domain.ts";

type Lift = { name: string; kg: number; sets: number; reps: number };
type Segment = {
  name: string; unit: string; completed: number; target: number; seconds: number;
  block: "metcon" | "endurance";
};
type Session = {
  athlete: "hippos" | "gators";
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
          id: crypto.randomUUID(), kind: "workout", athlete: session.athlete, day: "2026-10-20",
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

test("the first box estimates all three zones from what is logged", async ({ page }) => {
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

  // Hippos 45 + 70 + 90, Gators 80 + 109 + 149.
  const strength = page.getByRole("group", { name: "Strength estimate" });
  await expect(strength).toContainText("543 kg");
  await expect(strength.getByRole("row", { name: /^Hippos/ })).toHaveText(/Hippos\s*45\s*70\s*90\s*205/);
  await expect(strength.getByRole("row", { name: /^Gators/ })).toHaveText(/Gators\s*80\s*109\s*149\s*338/);
  await expect(strength.getByRole("row", { name: /^Combined/ })).toHaveText(/Combined\s*125\s*179\s*239\s*543/);
  await expect(strength).toContainText("Hippos 38%");
  await expect(strength).toContainText("Gators 62%");
  await expect(strength).toContainText("S2OH counts Hippos' overhead press and Gators' split jerk.");
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
