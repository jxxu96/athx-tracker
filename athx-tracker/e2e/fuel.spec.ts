import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session" })).toBeVisible();
}

test("fuel switches today, yesterday, the last week, and overall", async ({ page }) => {
  await signIn(page);
  const fuel = page.getByRole("group", { name: "Fuel range" });
  await expect(fuel.getByRole("button", { name: "Fuel for today" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Today, against the daily target.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fuel" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Hippos fuel" }).getByText("Expenditure", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Gators fuel" }).getByText("Expenditure", { exact: true })).toBeVisible();
  await expect(page.getByText("Add a bodyweight in Setup to estimate calories burned.")).toHaveCount(2);

  await fuel.getByRole("button", { name: "Fuel for yesterday" }).click();
  await expect(page.getByText("Yesterday, against the daily target.")).toBeVisible();

  await fuel.getByRole("button", { name: "Fuel for the last 7 days" }).click();
  await expect(page.getByText(/Daily average of days with a meal/)).toBeVisible();

  await fuel.getByRole("button", { name: "Fuel overall" }).click();
  await expect(
    page.getByText(/Daily average across every day with a meal/),
  ).toBeVisible();

  // The section tab stays the only control named exactly Today.
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveCount(1);
});

test("a macro shows the percent of its target", async ({ page }) => {
  await signIn(page);
  await page.evaluate(async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const current = await fetch("/api/settings").then((response) => response.json());
    const saved = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: current.revision,
        settings: {
          ...current.settings,
          targets: {
            ...current.settings.targets,
            hippos: { calories: 2000, protein: 140, carbs: 200, fat: 70 },
          },
        },
      }),
    });
    if (!saved.ok) throw new Error("settings");
    const meal = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(), kind: "meal", athlete: "hippos", day: today,
        name: "Half breakfast", meal: "Breakfast", source: "manual", assumptions: "",
        macros: { calories: 500, protein: 35, carbs: 50, fat: 14 },
      }),
    });
    if (!meal.ok) throw new Error("meal");
  });
  await page.reload();
  const hippos = page.getByRole("group", { name: "Hippos fuel" });
  await expect(hippos.getByText("500 / 2,000 kcal · 25%")).toBeVisible();
  await expect(hippos.getByText("14 / 70 g · 20%")).toBeVisible();
  await expect(hippos.getByText(/under/)).toHaveCount(0);
});

test("each person's expenditure sits under that person", async ({ page }) => {
  await signIn(page);
  await page.evaluate(async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const current = await fetch("/api/settings").then((response) => response.json());
    const saved = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: current.revision,
        settings: {
          ...current.settings,
          // 185 lb, the same weight the session burn uses for ~620 kcal an hour of tennis.
          bodyweight: { hippos: 0, gators: 185 / 2.20462262 },
        },
      }),
    });
    if (!saved.ok) throw new Error("settings");
    const session = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(), kind: "workout", athlete: "gators", day: today,
        title: "Gators tennis", category: "Tennis", seconds: 3600, notes: "",
        segments: [], fatigue: 0, transition: 0, goal: null, context: "solo", lifts: [],
      }),
    });
    if (!session.ok) throw new Error("session");
  });
  await page.reload();
  const hippos = page.getByRole("group", { name: "Hippos fuel" });
  const gators = page.getByRole("group", { name: "Gators fuel" });
  await expect(hippos.getByText("Add a bodyweight in Setup to estimate calories burned.")).toBeVisible();
  await expect(hippos.getByText("~620")).toHaveCount(0);
  await expect(gators.getByText("~620")).toBeVisible();
  await expect(gators.getByText("Add a bodyweight in Setup")).toHaveCount(0);
});
