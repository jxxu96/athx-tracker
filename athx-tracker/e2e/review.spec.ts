import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, METCON, type RecordItem, type Workout, type Meal } from "../lib/domain.ts";
import { addDays, weekStart } from "../lib/client.ts";
import { PASSPHRASE } from "../playwright.config.ts";

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "", kind: "workout", athlete: "hippos", day: "2026-10-19", title: "ATHX practice", category: "MetCon", customCategory: "",
  seconds: 1000, notes: "", fatigue: 10, transition: 0, goal: null, context: "pairs", lifts: [],
  segments: METCON.map((station) => ({ name: station.name, unit: station.unit, target: station.target, completed: station.target, seconds: 100, block: "metcon", ...(station.kg ? { kg: station.kg.hippos } : {}) })), ...over,
});
const meal = (over: Partial<Meal> = {}): Meal => ({
  id: "", kind: "meal", athlete: "hippos", day: "2026-10-19", name: "Lunch", meal: "Lunch", source: "manual", assumptions: "",
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
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Progress", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
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

test("benchmarks compare matching circuits and station splits, keeping capped and other loads separate", async ({ page }) => {
  const base = workout();
  await seed(page, [base,
    workout({ day: "2026-10-20", seconds: 982, segments: base.segments.map((s, i) => i === 1 ? { ...s, seconds: 82 } : s) }),
    workout({ day: "2026-10-21", seconds: 800, segments: base.segments.map((s, i) => i === 1 ? { ...s, kg: 10 } : s) }),
    workout({ day: "2026-10-22", seconds: 1500, capHit: true, segments: base.segments.map((s, i) => i === 6 ? { ...s, completed: 0, seconds: 0 } : s) }),
  ]);
  await page.getByRole("button", { name: "ATHX benchmarks", exact: true }).click();
  const completed = page.getByRole("region", { name: "ATHX circuit · pairs · Completed", exact: true });
  const matching = completed.filter({ hasText: "0:18 faster" });
  await expect(matching).toContainText("16:22");
  await expect(matching).toContainText("16:40");
  await expect(completed).toHaveCount(2);
  await expect(page.getByRole("region", { name: "ATHX circuit · pairs · Time cap" })).toContainText("86% of the work");
  await page.getByRole("button", { name: "Stations", exact: true }).click();
  await page.getByLabel("ATHX station").selectOption("DB ground to overhead");
  await expect(page.getByRole("region", { name: "DB ground to overhead · pairs · Completed" }).filter({ hasText: "1:22" })).toContainText("1:40");
  await page.getByRole("group", { name: "Benchmark athlete" }).getByRole("button", { name: "Gators" }).click();
  await expect(page.getByText("No timed attempts at this station yet.", { exact: false })).toBeVisible();
});

test("weekly review compares equal weekdays and supports historical weeks with nutrition and training", async ({ page }) => {
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const start = weekStart(today);
  const previousDay = addDays(today, -7);
  await seed(page, [
    workout({ day: previousDay, seconds: 1000 }),
    workout({ day: today, seconds: 900 }),
    workout({ day: today, category: "Strength", segments: [], seconds: 0, lifts: [{ name: "Back squat", kg: 60, sets: 2, reps: 5 }] }),
    meal({ day: today }), meal({ day: today }), meal({ day: previousDay }),
    meal({ day: today, source: "queued", macros: { calories: 0, protein: 0, carbs: 0, fat: 0 } }),
    // Must not leak into the previous comparison on an incomplete current week.
    workout({ day: addDays(start, -1), athlete: "gators" }),
  ]);
  await page.getByRole("button", { name: "Weekly review", exact: true }).click();
  const hippos = page.getByRole("region", { name: "Hippos weekly review" });
  await expect(hippos.getByRole("row", { name: "Sessions 2 1", exact: true })).toBeVisible();
  await expect(hippos).toContainText("1:40 faster (15:00)");
  await expect(hippos.getByRole("row", { name: "Calories kcal/day 1,200 600 +600", exact: true })).toBeVisible();
  await expect(hippos).toContainText("Estimates pending: 1 selected, 0 previous");
  await expect(page.getByText(/comparison uses the same weekdays/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Next week", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /done logging/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Previous week", exact: true }).click();
  await expect(page.getByText("Weeks run Monday to Sunday.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "This week", exact: true }).click();
  await expect(hippos.getByRole("row", { name: "Sessions 2 1", exact: true })).toBeVisible();
});

test("new Progress views fit a phone and are accessible in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  await seed(page, [workout({ day: today }), meal({ day: today })]);
  for (const view of ["ATHX benchmarks", "Weekly review"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    for (const theme of ["Light", "Dark"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      await page.waitForTimeout(500);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(violations.map((item) => `${item.id}: ${item.help}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.screenshot({ path: `.playwright/${view === "Weekly review" ? "weekly" : "benchmarks"}.png`, fullPage: true });
  }
});
