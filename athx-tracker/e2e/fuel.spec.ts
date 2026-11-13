import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";
import type { Settings } from "../lib/domain.ts";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
}

test("together is purple", async ({ page }) => {
  await signIn(page);
  const sessions = page.locator("section").filter({ has: page.getByRole("heading", { name: "Sessions" }) });
  await expect(sessions.getByRole("columnheader", { name: "This week" })).toBeVisible();
  await expect(sessions.getByRole("columnheader", { name: "Last 7 D" })).toBeVisible();
  const bars = sessions.getByRole("row", { name: /^Together/ }).locator(".h-full");
  await expect(bars).toHaveCount(2);
  for (const bar of await bars.all()) await expect(bar).toHaveCSS("background-color", "rgb(109, 40, 217)");
});

test("fuel switches today, yesterday, the rolling week, last week, and overall", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00"));
  await signIn(page);
  const fuel = page.getByRole("group", { name: "Fuel range" });
  await expect(fuel.getByRole("button", { name: "Fuel for today" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("against the daily target")).toHaveCount(0);
  await expect(page.getByText(/kcal under target/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Fuel" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Hippos fuel" }).getByText("Expenditure", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Gators fuel" }).getByText("Expenditure", { exact: true })).toBeVisible();
  await expect(page.getByText("Add a bodyweight in Setup to estimate calories burned.")).toHaveCount(2);

  await fuel.getByRole("button", { name: "Fuel for yesterday" }).click();
  await expect(fuel.getByRole("button", { name: "Fuel for yesterday" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("against the daily target")).toHaveCount(0);

  await fuel.getByRole("button", { name: "Fuel for the last 7 days" }).click();
  await expect(fuel.getByRole("button", { name: "Fuel for the last 7 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/Daily average of days with a meal/)).toHaveCount(0);
  await expect(page.getByText("4 Nov to 10 Nov, complete days")).toBeVisible();

  const lastWeek = fuel.getByRole("button", { name: "Fuel for last week" });
  await lastWeek.click();
  await expect(lastWeek).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("2 Nov to 8 Nov, complete days")).toBeVisible();

  await fuel.getByRole("button", { name: "Fuel overall" }).click();
  await expect(fuel.getByRole("button", { name: "Fuel overall" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText(/Daily average across every day with a meal/)).toHaveCount(0);

  // The section tab stays the only control named exactly Today.
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveCount(1);
});

test("calorie breakdown expands with mouse, keyboard, and touch", async ({ page, browser }) => {
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
        macros: { calories: 500, protein: 35, carbs: 50, fat: 14, fiber: 10, alcohol: 10 },
      }),
    });
    if (!meal.ok) throw new Error("meal");
  });
  await page.reload();
  const hippos = page.getByRole("group", { name: "Hippos fuel" });
  await expect(hippos.getByText("500 / 2,000 kcal · 25% of target")).toBeVisible();
  await expect(hippos.getByText("14 / 70 g · 20% of target")).toBeVisible();
  const bar = hippos.getByRole("button", { name: "Calorie breakdown" });
  const labels = bar.locator("[data-fuel-labels]");
  const proteinSegment = bar.locator('[data-fuel-slice="protein"]:visible');
  const protein = labels.locator('[data-fuel-slice="protein"]');
  const carbs = labels.locator('[data-fuel-slice="carbs"]');
  const fat = labels.locator('[data-fuel-slice="fat"]');
  await expect(bar).toHaveAttribute("aria-expanded", "false");
  await proteinSegment.hover();
  await expect(labels).toBeVisible();
  await expect(protein).toHaveAttribute("data-active", "");
  await expect(labels.locator("[data-fuel-slice]")).toHaveText([
    "Protein28%", "Carbs36%", "Fat25%", "Other11%",
  ]);
  await expect(bar).toHaveAccessibleDescription(/Protein 28%, Carbs 36%, Fat 25%, Other 11%/);
  await expect(hippos.getByText(/% of kcal$/)).toHaveText(["~28% of kcal", "~36% of kcal", "~25% of kcal"]);
  await fat.hover();
  await expect(fat).toHaveAttribute("data-active", "");
  await hippos.getByText("Expenditure", { exact: true }).hover();
  await expect(labels).toBeHidden();

  await bar.focus();
  await page.keyboard.press("Enter");
  await expect(bar).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  await expect(protein).toHaveAttribute("data-active", "");
  await fat.hover();
  await page.keyboard.press("ArrowLeft");
  await expect(carbs).toHaveAttribute("data-active", "");
  await expect(hippos.getByRole("status")).toHaveText("Carbs, 36% selected");
  await page.keyboard.press("Escape");
  await expect(labels).toBeHidden();
  await expect(bar).toBeFocused();

  const mobile = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 320, height: 812 },
    storageState: await page.context().storageState(),
    serviceWorkers: "block",
  });
  try {
    const phone = await mobile.newPage();
    await phone.goto(page.url());
    const card = phone.getByRole("group", { name: "Hippos fuel" });
    const touchBar = card.getByRole("button", { name: "Calorie breakdown" });
    const touchLabels = touchBar.locator("[data-fuel-labels]");
    await touchBar.locator('[data-fuel-slice="carbs"]:visible').tap();
    await expect(touchLabels.locator('[data-fuel-slice="carbs"]')).toHaveAttribute("data-active", "");
    await expect(touchLabels.getByText("11%", { exact: true })).toBeInViewport();
    const touchFat = touchLabels.locator('[data-fuel-slice="fat"]');
    await touchFat.tap();
    await expect(touchFat).toHaveAttribute("data-active", "");
    await phone.getByRole("button", { name: "Fuel for today" }).tap();
    await expect(touchLabels).toBeHidden();
    await touchBar.tap({ position: { x: 12, y: 5 } });
    await expect(touchLabels).toBeVisible();
    await touchBar.locator("svg").tap();
    await expect(touchLabels).toBeHidden();
  } finally {
    await mobile.close();
  }
  await expect(hippos.getByText(/under/)).toHaveCount(0);
});

test("gators' protein bar marks a soft goal at 80% of bodyweight", async ({ page }) => {
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
            gators: { ...current.settings.targets.gators, calories: 2200, protein: 200, carbs: 220, fat: 80 },
          },
          // 185 lb. 80% of that is 148 g, which is 74% of the 200 g target.
          bodyweight: { ...current.settings.bodyweight, gators: 185 / 2.20462262 },
        },
      }),
    });
    if (!saved.ok) throw new Error("settings");
    const meal = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(), kind: "meal", athlete: "gators", day: today,
        name: "Gators breakfast", meal: "Breakfast", source: "manual", assumptions: "",
        macros: { calories: 600, protein: 40, carbs: 50, fat: 20 },
      }),
    });
    if (!meal.ok) throw new Error("meal");
  });
  await page.reload();
  const gators = page.getByRole("group", { name: "Gators fuel" });
  const notch = gators.getByRole("img", { name: "Soft protein goal, 148 g" });
  await expect(notch).toBeVisible();
  await expect(notch).toHaveAttribute("style", /left:\s*74%/);
  await expect(page.getByRole("group", { name: "Hippos fuel" }).getByRole("img", { name: /Soft protein goal/ })).toHaveCount(0);
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
  await expect(hippos.getByText("620 kcal", { exact: true })).toHaveCount(0);
  await expect(gators.getByText("620 kcal", { exact: true })).toBeVisible();
  await expect(gators.getByText("Add a bodyweight in Setup")).toHaveCount(0);
});

test("pick day includes older meals, that day's targets, empty days and a retry", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  const original = await page.request.get("/api/settings").then((response) => response.json()) as {
    settings: Settings; revision: number;
  };
  const seeded = await page.evaluate(async (current) => {
    const oldTarget = { calories: 1800, protein: 120, carbs: 180, fat: 60 };
    const saved = await fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: current.revision,
        settings: {
          ...current.settings,
          targetHistory: {
            hippos: [{ until: "2020-12-31", macros: oldTarget }],
            gators: [{ until: "2020-12-31", macros: { ...oldTarget, calories: 2200 } }],
          },
        },
      }),
    });
    if (!saved.ok) throw new Error(await saved.text());
    const meal = (athlete: string, day: string, calories: number) => ({
      id: crypto.randomUUID(), kind: "meal", athlete, day,
      name: "Date picker test", meal: "Lunch", source: "manual", assumptions: "",
      macros: { calories, protein: 30, carbs: 40, fat: 15 },
    });
    const entries = [
      meal("hippos", "2020-01-02", 500),
      meal("hippos", "2020-01-02", 400),
      meal("gators", "2020-01-02", 1100),
      meal("hippos", "2020-01-04", 500),
      meal("hippos", "2020-01-05", 1500),
      // Push those meals outside the initial 400 entries.
      ...Array.from({ length: 400 }, () => meal("hippos", "2025-01-01", 100)),
    ];
    for (let i = 0; i < entries.length; i += 25) {
      await Promise.all(entries.slice(i, i + 25).map(async (entry) => {
        const response = await fetch("/api/records", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry),
        });
        if (!response.ok) throw new Error(await response.text());
      }));
    }
    return entries.map((entry) => entry.id);
  }, original);
  try {
    const recent = await page.request.get("/api/records?limit=400").then((response) => response.json());
    expect(recent.records.some((record: { day: string }) => record.day === "2020-01-02")).toBe(false);
    expect((await page.request.get("/api/records?day=2020-02-30")).status()).toBe(400);
    await page.reload();
    const ranges = page.getByRole("group", { name: "Fuel range" });
    await expect(ranges.getByRole("button")).toHaveText(["Today", "Yesterday", "7 days", "Last Week", "Overall", "Pick day"]);
    await ranges.getByRole("button", { name: "Pick day for fuel" }).click();
    const date = page.getByLabel("Fuel day", { exact: true });
    await date.fill("2020-01-02");
    const hippos = page.getByRole("group", { name: "Hippos fuel" });
    const gators = page.getByRole("group", { name: "Gators fuel" });
    await expect(hippos.getByText("900 / 1,800 kcal · 50% of target")).toBeVisible();
    await expect(hippos.getByText("60 / 120 g · 50% of target")).toBeVisible();
    await expect(gators.getByText("1,100 / 2,200 kcal · 50% of target")).toBeVisible();
    await expect(page.getByText("2 Jan 2020", { exact: true })).toBeVisible();
    await expect(page.getByText("against that day's targets")).toHaveCount(0);
    await expect(ranges.getByRole("button", { name: "Pick day for fuel" })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("fuel-day-mobile.png"), fullPage: true });

    const custom = page.getByRole("checkbox", { name: "Custom window" });
    await custom.check();
    const start = page.getByLabel("Start date", { exact: true });
    const end = page.getByLabel("End date", { exact: true });
    await expect(start).toHaveValue("2020-01-02");
    await expect(end).toHaveValue("2020-01-02");
    await end.fill("2020-01-04");
    await expect(page.getByText("2 Jan 2020 to 4 Jan 2020", { exact: true })).toBeVisible();
    await expect(hippos.getByText("1,400 kcal eaten · 2 of 3 days")).toBeVisible();
    await expect(hippos.getByText(/700 \/ 1,800 kcal/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await custom.uncheck();
    await expect(end).toHaveCount(0);
    await expect(hippos.getByText("900 / 1,800 kcal · 50% of target")).toBeVisible();

    await ranges.getByRole("button", { name: "Fuel overall" }).click();
    await expect(date).toHaveCount(0);
    await ranges.getByRole("button", { name: "Pick day for fuel" }).click();
    await expect(date).toHaveValue("2020-01-02");
    await expect(hippos.getByText("900 / 1,800 kcal · 50% of target")).toBeVisible();

    await page.getByRole("button", { name: "Refresh from the server" }).click();
    await expect(page.getByRole("button", { name: "Refresh from the server" })).toBeEnabled();
    await expect(hippos.getByText("900 / 1,800 kcal · 50% of target")).toBeVisible();

    await page.route("**/api/records?day=2020-01-03", (route) => route.abort("failed"));
    await date.fill("2020-01-03");
    await expect(page.getByRole("alert").filter({ hasText: "Could not load this day" })).toBeVisible();
    await expect(hippos).toHaveCount(0);
    await page.unroute("**/api/records?day=2020-01-03");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(hippos.getByText("No meals logged.")).toBeVisible();
    await expect(gators.getByText("No meals logged.")).toBeVisible();
    await ranges.getByRole("button", { name: "Fuel for today" }).click();
    await expect(ranges.getByRole("button", { name: "Fuel for today" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("against the daily target")).toHaveCount(0);
  } finally {
    for (const id of seeded) {
      await page.request.delete("/api/records", { data: { id } });
    }
    const { revision } = await page.request.get("/api/settings").then((response) => response.json());
    await page.request.put("/api/settings", { data: { revision, settings: original.settings } });
  }
});
