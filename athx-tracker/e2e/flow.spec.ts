import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

// The second round of logging and layout changes: lifts that start at real
// sets and reps and offer last time's, time boxes for a number pad, a missed
// day's energy, who a phone logs for, Setup in the header and kept across
// tabs, the theme in Setup, and Fuel's complete-day averages and overshoot.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
}

/** An empty journal, before and after, so nothing leaks either way. */
async function reset(page: Page) {
  await page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    for (const record of data.records as { id: string }[]) {
      await fetch("/api/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id }),
      });
    }
  });
}

/** The phone's day, a number of days back, the way the app writes a day. */
const dayAgo = (page: Page, days: number) =>
  page.evaluate((days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }, days);

async function post(page: Page, record: Record<string, unknown>) {
  await page.evaluate(async (record) => {
    const response = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), ...record }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, record);
}

const records = (page: Page) =>
  page.evaluate(async () => (await fetch("/api/records").then((r) => r.json())).records as Record<string, unknown>[]);

const nav = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();

const gear = (page: Page) => page.locator("header").getByRole("button", { name: "Setup", exact: true });

const lifts = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Lifts" }) }).first();

async function openStrength(page: Page) {
  await nav(page, "Session");
  await page.locator("select").filter({ has: page.locator('option[value="Tennis"]') }).selectOption("Strength");
}

const workout = (day: string, lift: { name: string; kg: number; sets: number; reps: number }) => ({
  kind: "workout", athlete: "hippos", day, title: "Lifts", category: "Strength", customCategory: "",
  seconds: 0, notes: "", segments: [], fatigue: 10, transition: 0, goal: null, context: "solo", lifts: [lift],
});

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await reset(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await reset(page);
});

test("a chosen lift starts at its usual sets and reps, and saves what it shows", async ({ page }) => {
  await openStrength(page);
  const picker = lifts(page).getByLabel("Lift", { exact: true });
  const sets = lifts(page).getByRole("textbox", { name: "Sets", exact: true });
  const reps = lifts(page).getByRole("textbox", { name: "Reps", exact: true });
  await expect(sets).toHaveValue("");
  await picker.selectOption("Split jerk");
  await expect(sets).toHaveValue("3");
  await expect(reps).toHaveValue("1");
  // Untouched defaults follow the lift; typed ones stay.
  await picker.selectOption("Deadlift");
  await expect(reps).toHaveValue("3");
  await reps.fill("4");
  await picker.selectOption("Back squat");
  await expect(reps).toHaveValue("4");

  await lifts(page).getByRole("textbox", { name: "lb", exact: true }).fill("225");
  await reps.fill("");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Back squat: add the sets and reps.");
  await reps.fill("5");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("Session saved", { exact: true })).toBeVisible();
  const saved = (await records(page)).find((record) => record.kind === "workout") as { lifts: unknown[] };
  expect(saved.lifts).toEqual([{ name: "Back squat", kg: 102.06, sets: 3, reps: 5 }]);
});

test("a lift offers the athlete's last time at it, and Use copies it", async ({ page }) => {
  await post(page, workout(await dayAgo(page, 3), { name: "Deadlift", kg: 130, sets: 3, reps: 3 }));
  await post(page, workout(await dayAgo(page, 1), { name: "Deadlift", kg: 140, sets: 2, reps: 3 }));
  await page.reload();
  await openStrength(page);
  await lifts(page).getByLabel("Lift", { exact: true }).selectOption("Deadlift");
  const use = lifts(page).getByRole("button", { name: "Use Hippos' last Deadlift: 308.6 lb 2×3, Yesterday" });
  await expect(use).toBeVisible();
  await use.click();
  await expect(lifts(page).getByRole("textbox", { name: "lb", exact: true })).toHaveValue("308.6");
  await expect(lifts(page).getByRole("textbox", { name: "Sets", exact: true })).toHaveValue("2");
  await expect(lifts(page).getByRole("textbox", { name: "Reps", exact: true })).toHaveValue("3");
  // A lift with no history offers nothing.
  await lifts(page).getByLabel("Lift", { exact: true }).selectOption("Split jerk");
  await expect(lifts(page).getByRole("button", { name: /^Use / })).toHaveCount(0);
});

test("a time box takes digits from the number pad and puts the colon in", async ({ page }) => {
  await nav(page, "Session");
  const elapsed = page.getByLabel("Hippos elapsed time");
  await expect(elapsed).toHaveAttribute("inputmode", "numeric");
  await elapsed.pressSequentially("2530");
  await expect(elapsed).toHaveValue("25:30");
  await elapsed.fill("1:05");
  await expect(elapsed).toHaveValue("1:05");
});

test("energy can be set for a missed day, which takes no time of day", async ({ page }) => {
  const energy = page.locator("section").filter({ has: page.getByRole("heading", { name: "Energy", exact: true }) });
  // The section tab stays the only control named exactly Today.
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveCount(1);
  await energy.getByRole("group", { name: "Energy date" }).getByRole("button", { name: "Energy yesterday" }).click();
  await expect(energy.getByText("Not logged yesterday")).toHaveCount(2);
  await energy.getByRole("group", { name: "Hippos energy yesterday" }).getByRole("button", { name: "6 out of 10" }).click();
  await expect(energy.getByText("Yesterday 6/10", { exact: true })).toBeVisible();
  await expect.poll(async () => (await records(page)).filter((record) => record.kind === "energy")).toEqual([
    expect.objectContaining({ athlete: "hippos", day: await dayAgo(page, 1), level: 6 }),
  ]);
  const saved = (await records(page)).find((record) => record.kind === "energy");
  expect(saved).not.toHaveProperty("time");
});

test("energy opens folded once both have checked in today", async ({ page }) => {
  const today = await dayAgo(page, 0);
  await post(page, { kind: "energy", athlete: "hippos", day: today, time: "07:00", level: 7 });
  await post(page, { kind: "energy", athlete: "gators", day: today, time: "07:00", level: 5 });
  await page.reload();
  const energy = page.locator("section").filter({ has: page.getByRole("heading", { name: "Energy", exact: true }) });
  await expect(energy.getByText("Today: Hippos 7 · Gators 5")).toBeVisible();
  await expect(energy.getByRole("button", { name: "Expand Energy" })).toBeVisible();
});

test("a phone opens on whoever it last logged for", async ({ page }) => {
  const loggingFor = page.locator("header").getByRole("group", { name: "Logging for" });
  await expect(loggingFor.getByRole("button", { name: "Hippos" })).toHaveAttribute("aria-pressed", "true");
  await loggingFor.getByRole("button", { name: "Gators" }).click();
  await page.reload();
  await expect(loggingFor.getByRole("button", { name: "Gators" })).toHaveAttribute("aria-pressed", "true");
  await loggingFor.getByRole("button", { name: "Hippos" }).click();
});

test("five tabs below, Setup on the gear, and what is typed there waits for Save or Discard", async ({ page }) => {
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("button")).toHaveText([
    "Today", "Session", "Meal", "Progress", "Log",
  ]);
  await gear(page).click();
  await expect(gear(page)).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No unsaved changes")).toBeVisible();
  const name = page.getByLabel("Name", { exact: true });
  await name.fill("ATHX Somewhere");
  await expect(page.getByRole("status").filter({ hasText: /^Unsaved changes$/ })).toBeVisible();

  await nav(page, "Today");
  await expect(gear(page)).toHaveAccessibleDescription("Unsaved changes");
  await gear(page).click();
  await expect(name).toHaveValue("ATHX Somewhere");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(name).not.toHaveValue("ATHX Somewhere");
  await expect(page.getByText("No unsaved changes")).toBeVisible();
  await expect(gear(page)).not.toHaveAttribute("aria-describedby", /./);
});

test("the theme is chosen in Setup, and the browser's bar takes it", async ({ page }) => {
  const themeColor = () => page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute("content"));
  await expect(page.locator("header").getByRole("button", { name: "Light" })).toHaveCount(0);
  expect(await themeColor()).toBe("#0a0a0a");
  await gear(page).click();
  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await themeColor()).toBe("#ffffff");
  // Applied at once, and not something Setup holds to be saved.
  await expect(page.getByText("No unsaved changes")).toBeVisible();
  await page.reload();
  expect(await themeColor()).toBe("#ffffff");
  await gear(page).click();
  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  expect(await themeColor()).toBe("#0a0a0a");
});

test("the week's average leaves today out, and a bar past its target shows by how much", async ({ page }) => {
  const settings = await page.evaluate(async () => fetch("/api/settings").then((r) => r.json())) as {
    settings: Record<string, unknown> & { targets: Record<string, unknown> };
    revision: number;
  };
  const meal = (day: string, calories: number) => ({
    kind: "meal", athlete: "hippos", day, name: "Meal", meal: "Lunch",
    macros: { calories, protein: 30, carbs: 40, fat: 10 }, source: "manual", assumptions: "",
  });
  try {
    await page.evaluate(async ({ settings, revision }) => {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision,
          settings: { ...settings, targets: { ...settings.targets, hippos: { calories: 2000, protein: 130, carbs: 220, fat: 65 } } },
        }),
      });
    }, settings);
    await post(page, meal(await dayAgo(page, 1), 1800));
    await post(page, meal(await dayAgo(page, 0), 3000));
    await page.reload();
    const hippos = page.getByRole("group", { name: "Hippos fuel" });
    // Today is over target: the bar holds the overshoot, striped, past a tick.
    await expect(hippos.getByText(/^3,000 \/ 2,000 kcal · 150%$/)).toBeVisible();
    await expect(hippos.locator("[data-fuel-over]")).toHaveCount(1);
    await expect(hippos.locator("[data-fuel-target]")).toHaveCount(1);
    await page.getByRole("group", { name: "Fuel range" }).getByRole("button", { name: "Fuel for the last 7 days" }).click();
    await expect(page.getByText(/, complete days$/)).toBeVisible();
    await expect(hippos.getByText(/^avg 1,800 \/ 2,000 kcal · 90%$/)).toBeVisible();
    await expect(hippos.locator("[data-fuel-over]")).toHaveCount(0);
  } finally {
    await page.evaluate(async (original) => {
      const current = await fetch("/api/settings").then((r) => r.json());
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: current.revision, settings: original }),
      });
    }, settings.settings);
  }
});

test("Progress draws bodyweight, a lift week by week, and protein against the target", async ({ page }) => {
  const settings = await page.evaluate(async () => fetch("/api/settings").then((r) => r.json())) as {
    settings: Record<string, unknown> & { targets: Record<string, unknown> };
    revision: number;
  };
  try {
    await page.evaluate(async ({ settings, revision }) => {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision,
          settings: { ...settings, targets: { ...settings.targets, hippos: { calories: 2000, protein: 100, carbs: 220, fat: 65 } } },
        }),
      });
    }, settings);
    for (const [days, kg] of [[9, 62], [5, 62.4], [1, 61.8]] as const)
      await post(page, { kind: "bodyweight", athlete: "hippos", day: await dayAgo(page, days), kg });
    await post(page, workout(await dayAgo(page, 14), { name: "Deadlift", kg: 70, sets: 3, reps: 3 }));
    await post(page, workout(await dayAgo(page, 1), { name: "Deadlift", kg: 75, sets: 3, reps: 3 }));
    await post(page, {
      kind: "meal", athlete: "hippos", day: await dayAgo(page, 2), name: "Meal", meal: "Lunch",
      macros: { calories: 600, protein: 90, carbs: 40, fat: 10 }, source: "manual", assumptions: "",
    });
    await page.reload();
    await nav(page, "Progress");
    const card = page.locator("section", { has: page.getByRole("heading", { name: "Hippos" }) });
    await expect(card.getByText(/7-day average \d/)).toBeVisible();
    await expect(card.getByText("Best 3RM each week")).toBeVisible();
    await expect(card.getByText(/^Protein, % of target by week/)).toBeVisible();
    await expect(card.locator(".recharts-surface")).toHaveCount(3);
    // Every value is in a table too, for reading without hovering.
    await card.getByText("Values", { exact: true }).first().click();
    await expect(card.getByRole("columnheader", { name: "7-day average (lb)" })).toBeVisible();
  } finally {
    await page.evaluate(async (original) => {
      const current = await fetch("/api/settings").then((r) => r.json());
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: current.revision, settings: original }),
      });
    }, settings.settings);
  }
});
