import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";
import { DEFAULT_SETTINGS } from "../lib/domain.ts";

// A session burned what it burned at the weight of its own day. One number
// in Setup, applied to every session ever logged, rewrote them all whenever
// it changed.

const LB = 2.20462262;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
}

/** An empty journal and the settings as they come, before and after, so nothing leaks either way. */
async function reset(page: Page) {
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
}

async function setup(page: Page, change: Record<string, unknown>) {
  await page.evaluate(async (change) => {
    const current = await fetch("/api/settings").then((r) => r.json());
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: current.revision, settings: { ...current.settings, ...change } }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, change);
}

/** An hour of tennis for Gators, a number of days back from the phone's today. */
async function tennis(page: Page, daysAgo: number) {
  await page.evaluate(async (daysAgo) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const response = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(), kind: "workout", athlete: "gators", day,
        title: daysAgo ? "Earlier tennis" : "Tennis today", category: "Tennis", customCategory: "",
        seconds: 3600, notes: "", segments: [], fatigue: 0, transition: 0, goal: null,
        context: "solo", lifts: [],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, daysAgo);
}

const nav = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();

const openLog = async (page: Page) => {
  await nav(page, "Log");
  await expect(page.locator("select").filter({ has: page.locator('option[value="workout"]') })).toHaveCount(1);
};

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await reset(page);
  await page.reload();
});

test.afterEach(async ({ page }) => {
  await reset(page);
});

test("a new bodyweight is a weigh-in, and an earlier session keeps the burn it had", async ({ page }) => {
  // 185 lb from before weigh-ins were dated, and an hour of tennis three days ago.
  await setup(page, { bodyweight: { hippos: 0, gators: 185 / LB } });
  await tennis(page, 3);
  await page.reload();

  await nav(page, "Setup");
  const weight = page.getByLabel(/^Bodyweight/).nth(1);
  await expect(weight).toHaveValue("185");
  await weight.fill("200");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();

  // 7 MET for tennis at 185 lb, an hour: about 620, as before the change.
  await openLog(page);
  await expect(page.getByRole("listitem").filter({ hasText: "Earlier tennis" })).toContainText("~620 kcal");
  await expect(page.getByRole("listitem").filter({ hasText: "Bodyweight 200 lb" })).toContainText("Gators · weigh-in");

  // A session today burns at the new weight: 200 lb for the hour is about 670.
  await tennis(page, 0);
  await page.getByRole("button", { name: "Refresh from the server" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Tennis today" })).toContainText("~670 kcal");
  await expect(page.getByRole("listitem").filter({ hasText: "Earlier tennis" })).toContainText("~620 kcal");

  // Setup shows the latest weight, and an unchanged save logs nothing new.
  await nav(page, "Setup");
  await expect(weight).toHaveValue("200");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved", { exact: true }).first()).toBeVisible();
  const weighIns = await page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return (data.records as { kind: string }[]).filter((record) => record.kind === "bodyweight").length;
  });
  expect(weighIns).toBe(1);
});

test("a weigh-in is corrected where it stands in the log", async ({ page }) => {
  await nav(page, "Setup");
  await page.getByLabel(/^Bodyweight/).nth(1).fill("201");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();

  await openLog(page);
  const entry = page.getByRole("listitem").filter({ hasText: "Bodyweight 201 lb" });
  await entry.getByRole("button", { name: "Edit entry" }).click();
  await page.getByLabel("Bodyweight (lb)").fill("199.5");
  await page.getByRole("group", { name: "Date" }).getByRole("button", { name: "Yesterday" }).click();
  await page.getByLabel("Time of day").fill("06:30");
  await page.getByRole("button", { name: "Save weigh-in" }).click();
  await expect(page.getByText("Entry updated", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Bodyweight 199.5 lb" })).toContainText("06:30 · Gators · weigh-in");
  await expect(page.getByRole("heading", { name: "Yesterday" })).toBeVisible();
});

test("expenditure counts resting energy once there is a height and a birth year", async ({ page }) => {
  await setup(page, { bodyweight: { hippos: 0, gators: 80 } });
  await page.reload();
  const gators = page.getByRole("group", { name: "Gators fuel" });
  await expect(gators).toContainText("Add a height and birth year in Setup");

  // 70.9 in is 180.1 cm. Mifflin-St Jeor for a man: 10 x 80 + 6.25 x 180.1 - 5 x age + 5.
  await nav(page, "Setup");
  await page.getByLabel("Height (in)").nth(1).fill("70.9");
  await page.getByLabel("Birth year").nth(1).fill("1996");
  const age = new Date().getFullYear() - 1996;
  const resting = Math.round((800 + 6.25 * 70.9 * 2.54 - 5 * age + 5) / 10) * 10;
  const shown = String(resting).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  await expect(page.getByText(`Resting energy ~${shown} kcal a day`)).toBeVisible();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();

  await nav(page, "Today");
  await expect(gators).toContainText(`~${shown}kcal`);
  await expect(gators).toContainText(`Resting ~${shown} · training ~0`);
  await expect(gators).toContainText("Everyday movement and digestion are not in this");
});
