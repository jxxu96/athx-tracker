import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, RECENT_LIMIT, type Meal, type RecordItem, type Workout } from "../lib/domain.ts";
import { PASSPHRASE } from "../playwright.config.ts";

// A Wednesday afternoon, so which days are in the strip and the month does
// not depend on the day the suite runs.
const NOW = new Date(2026, 9, 28, 15, 0, 0);

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: "", kind: "workout", athlete: "hippos", day: "2026-10-28", title: "Training", category: "Strength", customCategory: "",
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

const panel = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Sessions" }) });
const days = (page: Page) => panel(page).getByRole("group", { name: "Days" });

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

test("the last seven days show what was done, and a day opens on its own", async ({ page }) => {
  await seed(page, [
    workout({ title: "Morning squats", time: "07:15", seconds: 2700, lifts: [{ name: "Back squat", kg: 100, sets: 5, reps: 5 }] }),
    workout({ title: "Tennis hit", athlete: "gators", category: "Tennis", day: "2026-10-26", seconds: 3600 }),
    workout({ title: "Pairs circuit", athlete: "team", category: "MetCon", context: "pairs", day: "2026-10-26", seconds: 1260 }),
    workout({ title: "Old run", category: "Endurance", day: "2026-10-20", seconds: 1500 }),
  ]);

  await expect(days(page).getByRole("button")).toHaveCount(7);
  await expect(days(page).getByRole("button", { name: "Wednesday 28 October, today: 1 session" })).toBeVisible();
  await expect(days(page).getByRole("button", { name: "Monday 26 October: 2 sessions" })).toBeVisible();
  await expect(days(page).getByRole("button", { name: "Thursday 22 October: no sessions" })).toBeVisible();
  await expect(panel(page).getByText("Last 7 days", { exact: true })).toBeVisible();
  await expect(panel(page).getByText("3 sessions on 2 of 7 days", { exact: true })).toBeVisible();

  // The whole week, newest first, with what each one was.
  const list = panel(page).getByRole("listitem");
  await expect(list).toHaveCount(3);
  await expect(list.nth(0)).toContainText("Morning squats");
  await expect(list.nth(0)).toContainText("07:15 · Hippos · Strength");
  await expect(list.nth(0)).toContainText("Back squat 220.5 lb 5×5");
  await expect(list.nth(0)).toContainText("45:00");
  await expect(panel(page).getByText("Old run")).toHaveCount(0);

  await days(page).getByRole("button", { name: /^Monday 26 October/ }).click();
  await expect(list).toHaveCount(2);
  await expect(panel(page).getByText("Morning squats")).toHaveCount(0);
  await expect(list.filter({ hasText: "Pairs circuit" })).toContainText("Together · MetCon · Pairs");
  // Choosing a day is not tapping the box, so it stays open.
  await expect(panel(page).getByRole("button", { name: "Collapse Sessions" })).toBeVisible();

  await panel(page).getByRole("button", { name: "Show all 7 days" }).click();
  await expect(list).toHaveCount(3);

  await panel(page).getByRole("button", { name: "Previous 7 days" }).click();
  await expect(panel(page).getByText("15 Oct – 21 Oct", { exact: true })).toBeVisible();
  await expect(list).toHaveCount(1);
  await expect(list).toContainText("Old run");
  await panel(page).getByRole("button", { name: "Next 7 days" }).click();
  await expect(panel(page).getByRole("button", { name: "Next 7 days" })).toBeDisabled();

  // The month, Monday first, with the days after today out of reach.
  await panel(page).getByRole("button", { name: "Month", exact: true }).click();
  await expect(panel(page).getByText("October 2026", { exact: true })).toBeVisible();
  await expect(days(page).getByRole("button")).toHaveCount(31);
  await expect(days(page).getByRole("button", { name: /^Thursday 29 October/ })).toBeDisabled();
  await expect(panel(page).getByText("Tap a day to see what was done.")).toBeVisible();
  await days(page).getByRole("button", { name: "Tuesday 20 October: 1 session" }).click();
  await expect(list).toHaveCount(1);
  await expect(list).toContainText("Old run");
  await days(page).getByRole("button", { name: /^Wednesday 21 October/ }).click();
  await expect(panel(page).getByText("No sessions on Wednesday 21 October.")).toBeVisible();
});

test("sessions older than what the phone holds are fetched, not shown as missing", async ({ page }) => {
  // More recent entries than the phone opens with, so an older session is
  // left out of its slice and has to be asked for.
  await seed(page, [
    workout({ title: "September tempo", category: "Endurance", day: "2026-09-10", seconds: 1800 }),
    ...Array.from({ length: RECENT_LIMIT + 5 }, () => meal()),
  ]);
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();

  await panel(page).getByRole("button", { name: "Month", exact: true }).click();
  const fetched = page.waitForRequest((request) =>
    request.url().includes("/api/records?from=2026-09-01&to=2026-09-30&kind=workout"),
  );
  await panel(page).getByRole("button", { name: "Previous month" }).click();
  await fetched;
  await days(page).getByRole("button", { name: "Thursday 10 September: 1 session" }).click();
  await expect(panel(page).getByRole("listitem")).toContainText("September tempo");
});

test("a range of entries is asked for with real dates in order and a known kind", async ({ page }) => {
  const status = (query: string) =>
    page.evaluate(async (query) => (await fetch(`/api/records?${query}`)).status, query);
  expect(await status("from=2026-10-02&to=2026-10-01")).toBe(400);
  expect(await status("from=2026-02-30&to=2026-03-01")).toBe(400);
  expect(await status("from=2026-10-01")).toBe(400);
  expect(await status("from=2026-10-01&to=2026-10-31&kind=nap")).toBe(400);
  expect(await status("from=2026-10-01&to=2026-10-31&kind=workout")).toBe(200);
});
