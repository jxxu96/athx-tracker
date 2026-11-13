import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, METCON, RECENT_LIMIT, type Meal, type RecordItem, type Workout } from "../lib/domain.ts";
import { PASSPHRASE } from "../playwright.config.ts";
import { chooseTheme } from "./theme.ts";

// A Wednesday afternoon, so how long ago each session was does not depend on
// the day the suite runs.
const NOW = new Date(2026, 9, 28, 15, 0, 0);

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "", kind: "workout", athlete: "gators", day: "2026-10-28", title: "Training", category: "Strength", customCategory: "",
  seconds: 0, notes: "", segments: [], fatigue: 10, transition: 0, goal: null, context: "solo", lifts: [], ...over,
});
const meal = (over: Partial<Meal> = {}): Meal => ({
  id: "", kind: "meal", athlete: "hippos", day: "2026-10-27", name: "Lunch", meal: "Lunch", source: "manual", assumptions: "",
  macros: { calories: 600, protein: 40, carbs: 60, fat: 20 }, ...over,
});

async function seed(page: Page, records: RecordItem[]) {
  await page.evaluate(async (records) => {
    for (const record of records) {
      const response = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...record, id: crypto.randomUUID() }) });
      if (!response.ok) throw new Error(await response.text());
    }
  }, records);
  await page.reload();
}

const card = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "ATHX Lite running order" }) });
/** One athlete's cell on a workout's row: the pill, and the load under it. */
const cell = (page: Page, name: RegExp, athlete: "hippos" | "gators") =>
  card(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name }) })
    .getByRole("cell")
    .nth(athlete === "hippos" ? 1 : 2);
const pill = (page: Page, name: RegExp, athlete: "hippos" | "gators") =>
  cell(page, name, athlete).locator("[data-recency]");
/** The days in the last 7 under the pill, on the rows that count against twice a week. */
const week = (page: Page, name: RegExp, athlete: "hippos" | "gators") =>
  cell(page, name, athlete).locator("[data-week]");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
  await page.evaluate(async (settings) => {
    const { records } = await fetch("/api/records").then((response) => response.json());
    for (const record of records) await fetch("/api/records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id }) });
    const { revision } = await fetch("/api/settings").then((response) => response.json());
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings, revision }) });
  }, DEFAULT_SETTINGS);
});

/** The circuit with only the opening row and the ground to overhead done: the rest was not reached. */
const halfCircuit = METCON.map((station, index) => ({
  name: station.name, unit: station.unit, target: station.target, block: "metcon" as const,
  completed: index < 2 ? station.target : 0,
  seconds: index < 2 ? 120 : 0,
}));

test("every race workout is in order, with each of your loads and when you last did it", async ({ page }) => {
  await seed(page, [
    workout({ day: "2026-10-26", lifts: [{ name: "Split jerk", kg: 80, sets: 3, reps: 1 }] }),
    workout({ day: "2026-10-24", lifts: [{ name: "Push press", kg: 70, sets: 3, reps: 3 }] }),
    workout({ athlete: "hippos", day: "2026-10-19", lifts: [{ name: "Back squat", kg: 70, sets: 3, reps: 5 }] }),
    workout({ day: "2026-10-08", lifts: [{ name: "Deadlift", kg: 160, sets: 3, reps: 3 }] }),
    workout({
      athlete: "hippos", category: "Endurance", seconds: 900,
      segments: [{ name: "Run", unit: "km", completed: 2.4, target: 2.4, seconds: 900, block: "endurance" }],
    }),
    // Together is both of yours.
    workout({
      athlete: "team", category: "Endurance", context: "pairs", day: "2026-10-27",
      segments: [
        { name: "Run", unit: "km", completed: 2.4, target: 2.4, seconds: 900, block: "endurance" },
        { name: "Ski erg", unit: "m", completed: 2000, target: 2000, seconds: 480, block: "endurance" },
      ],
    }),
    workout({ category: "MetCon", day: "2026-10-22", segments: halfCircuit }),
  ]);

  const order = await card(page).getByRole("rowheader").allTextContents();
  const names = [
    "Strength", "Shoulder to overhead", "Back squat", "Deadlift",
    "Endurance", "Run", "SkiErg",
    "MetCon X", ...METCON.map((station) => station.name),
  ];
  expect(order.map((text, index) => text.startsWith(names[index]))).toEqual(names.map(() => true));
  await expect(card(page)).toContainText("10 min refuel");
  await expect(card(page)).toContainText("30 min recovery");
  await expect(card(page).getByRole("rowheader", { name: /^Shoulder to overhead/ })).toContainText("1RM · 0–5 min");
  await expect(card(page).getByRole("rowheader", { name: /^Run/ })).toContainText("2.4 km each");

  // Green within 5 days, yellow within 14, red past that or never.
  await expect(pill(page, /^Shoulder to overhead/, "gators")).toHaveText(/2d ago/);
  await expect(pill(page, /^Shoulder to overhead/, "gators")).toHaveAttribute("data-recency", "fresh");
  await expect(pill(page, /^Shoulder to overhead/, "gators")).toContainText("Last done 2 days ago, Mon 26 Oct");
  await expect(pill(page, /^Back squat/, "hippos")).toHaveText(/9d ago/);
  await expect(pill(page, /^Back squat/, "hippos")).toHaveAttribute("data-recency", "due");
  await expect(pill(page, /^Deadlift/, "gators")).toHaveText(/20d ago/);
  await expect(pill(page, /^Deadlift/, "gators")).toHaveAttribute("data-recency", "stale");
  await expect(pill(page, /^Deadlift/, "hippos")).toHaveText(/Never/);
  await expect(pill(page, /^Deadlift/, "hippos")).toHaveAttribute("data-recency", "stale");
  await expect(pill(page, /^Run/, "hippos")).toHaveText(/Today/);
  await expect(pill(page, /^Run/, "gators")).toHaveText(/1d ago/);
  await expect(pill(page, /^SkiErg/, "hippos")).toHaveText(/1d ago/);
  await expect(pill(page, /^SkiErg/, "gators")).toHaveText(/1d ago/);

  // A row is a row, at either end of the circuit; a station left at zero was not reached.
  await expect(pill(page, /^Opening row/, "gators")).toHaveText(/6d ago/);
  await expect(pill(page, /^Closing row/, "gators")).toHaveText(/6d ago/);
  await expect(pill(page, /^DB ground to overhead/, "gators")).toHaveAttribute("data-recency", "due");
  await expect(pill(page, /^DB bench press/, "gators")).toHaveText(/Never/);

  // The lifts, the run and the rows count the last 7 days against twice; the rest do not.
  await expect(week(page, /^Shoulder to overhead/, "gators")).toHaveAttribute("data-twice", "met");
  await expect(week(page, /^Shoulder to overhead/, "gators")).toHaveText(/2×/);
  await expect(week(page, /^Shoulder to overhead/, "gators")).toContainText("Done on 2 of the last 7 days");
  await expect(week(page, /^Back squat/, "hippos")).toHaveAttribute("data-week", "0");
  await expect(week(page, /^Back squat/, "hippos")).toContainText("Not done in the last 7 days");
  // Today's run and Together's yesterday make two for Hippos; Together's alone is one for Gators.
  await expect(week(page, /^Run/, "hippos")).toHaveAttribute("data-twice", "met");
  await expect(week(page, /^Run/, "hippos")).toHaveText(/2×/);
  await expect(week(page, /^Run/, "gators")).toHaveAttribute("data-twice", "short");
  await expect(week(page, /^Run/, "gators")).toHaveText(/1×/);
  await expect(week(page, /^Opening row/, "gators")).toHaveAttribute("data-week", "1");
  await expect(week(page, /^Closing row/, "gators")).toHaveAttribute("data-week", "1");
  await expect(week(page, /^SkiErg/, "gators")).toHaveCount(0);
  await expect(week(page, /^DB ground to overhead/, "gators")).toHaveCount(0);
  await expect(week(page, /^Burpees over bench/, "hippos")).toHaveCount(0);

  // Each of you carries your own load, in the unit at the top.
  await expect(cell(page, /^DB ground to overhead/, "hippos")).toContainText("16.5 lb");
  await expect(cell(page, /^DB ground to overhead/, "gators")).toContainText("33.1 lb");
  await expect(cell(page, /^DB bench press/, "gators")).toContainText("33.1 lb / DB");
  await page.getByRole("group", { name: "Weight unit" }).getByRole("button", { name: "kg", exact: true }).click();
  await expect(cell(page, /^Sandbag carry/, "hippos")).toContainText("20 kg");
  await expect(cell(page, /^Sandbag carry/, "gators")).toContainText("30 kg");

  await card(page).getByRole("button", { name: "Collapse ATHX Lite running order" }).click();
  await expect(card(page)).toContainText("Not done in 14 days: Hippos 9 · Gators 6");
});

test("the running order comes before Sessions on Today", async ({ page }) => {
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  const order = headings.indexOf("ATHX Lite running order");
  expect(order).toBeGreaterThanOrEqual(0);
  expect(order).toBeLessThan(headings.indexOf("Sessions"));
});

test("a last time older than the phone's recent slice is still the exact day", async ({ page }) => {
  // Newer meals fill the slice, so the phone does not hold the SkiErg session.
  await seed(page, [
    workout({
      category: "Endurance", day: "2026-09-10",
      segments: [{ name: "Ski erg", unit: "m", completed: 5000, target: 5000, seconds: 1260, block: "endurance" }],
    }),
    ...Array.from({ length: RECENT_LIMIT + 5 }, () => meal()),
  ]);
  await expect(pill(page, /^SkiErg/, "gators")).toHaveText(/48d ago/);
  await expect(pill(page, /^SkiErg/, "gators")).toHaveAttribute("data-recency", "stale");
  await expect(pill(page, /^SkiErg/, "hippos")).toHaveText(/Never/);
});

test("a week partly older than the phone's recent slice still counts every day of it", async ({ page }) => {
  // Newer meals fill the slice, so the phone holds only the newest days of the week.
  await seed(page, [
    workout({ day: "2026-10-22", lifts: [{ name: "Deadlift", kg: 160, sets: 3, reps: 3 }] }),
    workout({ day: "2026-10-23", lifts: [{ name: "Deadlift", kg: 160, sets: 3, reps: 3 }] }),
    ...Array.from({ length: RECENT_LIMIT + 5 }, () => meal({ day: "2026-10-28" })),
  ]);
  await expect(week(page, /^Deadlift/, "gators")).toHaveAttribute("data-week", "2");
  await expect(week(page, /^Deadlift/, "gators")).toHaveAttribute("data-twice", "met");
});

test("every colour reads in both themes", async ({ page }) => {
  await seed(page, [
    workout({ day: "2026-10-27", lifts: [{ name: "Deadlift", kg: 160, sets: 3, reps: 3 }] }),
    workout({ day: "2026-10-18", lifts: [{ name: "Back squat", kg: 120, sets: 3, reps: 3 }] }),
  ]);
  await expect(pill(page, /^Deadlift/, "gators")).toHaveAttribute("data-recency", "fresh");
  await expect(pill(page, /^Back squat/, "gators")).toHaveAttribute("data-recency", "due");
  for (const theme of ["Light", "Dark"] as const) {
    await chooseTheme(page, theme);
    await card(page).scrollIntoViewIfNeeded();
    // Let the theme's colour transitions land before reading contrast.
    await page.waitForTimeout(500);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const described = violations.map((v) => `${theme}: ${v.id} (${v.impact}) — ${v.help} [${v.nodes.length}]`);
    expect(described, described.join("\n")).toEqual([]);
  }
});
