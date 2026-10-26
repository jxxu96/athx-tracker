import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";
import { DEFAULT_SETTINGS } from "../lib/domain.ts";

/** Pounds as the session form stores them. */
const kg = (lb: number) => Math.round((lb / 2.20462262) * 100) / 100;

type Lift = { name: string; kg: number; sets: number; reps: number };

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
}

async function logLifts(page: Page, sessions: { athlete: string; day: string; lifts: Lift[] }[]) {
  await page.evaluate(async (sessions) => {
    for (const { athlete, day, lifts } of sessions) {
      const response = await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(), kind: "workout", athlete, day, title: "Lifts",
          category: "Strength", customCategory: "", seconds: 0, notes: "", segments: [],
          fatigue: 10, transition: 0, goal: null, context: "solo", lifts,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
    }
  }, sessions);
}

const openProgress = (page: Page) =>
  page.getByRole("navigation", { name: "Sections" })
    .getByRole("button", { name: "Progress", exact: true })
    .click();

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // An empty journal and the settings as they come, so no other spec's
  // sessions or targets leak into these numbers.
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

test("each main lift shows its start, latest, best and target", async ({ page }) => {
  await logLifts(page, [
    { athlete: "gators", day: "2026-03-02", lifts: [{ name: "Split jerk", kg: kg(135), sets: 5, reps: 3 }] },
    {
      athlete: "gators",
      day: "2026-04-06",
      lifts: [
        // The warm-up is not the day's figure.
        { name: "Split jerk", kg: kg(95), sets: 2, reps: 3 },
        { name: "Split jerk", kg: kg(160), sets: 1, reps: 1 },
        // A different lift, which must not stand in for the back squat.
        { name: "Front squat", kg: kg(200), sets: 3, reps: 3 },
      ],
    },
    { athlete: "gators", day: "2026-05-04", lifts: [{ name: "Split jerk", kg: kg(150), sets: 4, reps: 2 }] },
  ]);
  await page.reload();
  await openProgress(page);

  const jerk = page.getByRole("group", { name: "Gators split jerk" });
  await expect(jerk.getByRole("definition")).toContainText([
    "135 lb", "5×3", // start
    "150 lb", "4×2", // latest
    "160 lb", "1×1", // best
    "175 lb", "15 lb to go", // target
  ]);
  await expect(jerk.getByText("+25 lb since start · 91% of target · 3 sessions")).toBeVisible();
  await expect(jerk).toContainText("79.4 kg");
  await expect(jerk).toContainText("6.8 kg");
  const total = page.getByRole("group", { name: "Gators total" });
  await expect(total).toContainText("725 lb");
  await expect(total).toContainText("328.9 kg");
  await expect(total).toContainText("Overhead press, back squat and deadlift");
  const order = await jerk.locator("[data-progress-mark]").evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        mark: node.getAttribute("data-progress-mark"),
        x: node.getBoundingClientRect().left,
      }))
      .sort((a, b) => a.x - b.x)
      .map((item) => item.mark),
  );
  expect(order).toEqual(["start", "latest", "best", "target"]);

  // Gators' other targets are there before anything is logged against them.
  await expect(page.getByRole("group", { name: "Gators overhead press" }))
    .toContainText("Not logged yet · target 135 lb");
  await expect(
    page.getByRole("group", { name: "Gators overhead press" }).locator("[data-progress-mark]"),
  ).toHaveAttribute("data-progress-mark", "target");
  await expect(page.getByRole("group", { name: "Gators back squat" }))
    .toContainText("Not logged yet · target 255 lb");
  await expect(page.getByRole("group", { name: "Gators deadlift" }))
    .toContainText("Not logged yet · target 335 lb");
  await expect(page.getByRole("group", { name: "Hippos split jerk" }))
    .toContainText("Not logged yet · no target");
});

test("a filled-in Progress tab is usable without sight, in both themes", async ({ page }) => {
  // The accessibility spec sees this tab empty, which draws none of the
  // figures, keys or meters.
  await logLifts(page, [
    { athlete: "gators", day: "2026-03-02", lifts: [{ name: "Deadlift", kg: kg(225), sets: 3, reps: 5 }] },
    { athlete: "gators", day: "2026-04-06", lifts: [{ name: "Deadlift", kg: kg(275), sets: 3, reps: 3 }] },
    { athlete: "hippos", day: "2026-04-06", lifts: [{ name: "Back squat", kg: kg(95), sets: 5, reps: 5 }] },
  ]);
  await page.reload();
  await openProgress(page);
  await expect(page.getByRole("group", { name: "Gators deadlift" })).toContainText("2 sessions");
  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    // Let colour transitions land before contrast is read.
    await page.waitForTimeout(500);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const described = violations.map(
      (v) => `${theme}: ${v.id} (${v.impact}) — ${v.help} [${v.nodes.length}]`,
    );
    expect(described, described.join("\n")).toEqual([]);
  }
});

test("a target set in Setup is what Progress measures against", async ({ page }) => {
  await logLifts(page, [
    { athlete: "hippos", day: "2026-03-02", lifts: [{ name: "Deadlift", kg: kg(135), sets: 3, reps: 5 }] },
  ]);
  await page.reload();
  await page.getByRole("button", { name: "Setup", exact: true }).click();

  const hippos = page.getByRole("group", { name: "Hippos", exact: true });
  await hippos.getByLabel("Deadlift (lb)").fill("185");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();

  // Stored in kilograms, like every other weight.
  const stored = await page.evaluate(async () =>
    (await fetch("/api/settings").then((r) => r.json())).settings.liftTargets,
  );
  expect(stored.hippos.deadlift).toBe(kg(185));
  expect(stored.gators.splitJerk).toBeCloseTo(175 / 2.20462262, 6);

  await openProgress(page);
  const deadlift = page.getByRole("group", { name: "Hippos deadlift" });
  await expect(deadlift.getByRole("definition")).toContainText(["135 lb", "185 lb", "50 lb to go"]);
  await expect(deadlift).toContainText("83.9 kg");
  await expect(deadlift).toContainText("22.7 kg");
  await expect(deadlift.getByText("73% of target")).toBeVisible();

  // The unit switch carries the targets across with it.
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByRole("button", { name: "kg", exact: true }).click();
  await expect(page.getByRole("group", { name: "Gators", exact: true }).getByLabel("Split jerk (kg)"))
    .toHaveValue("79.4");
});

test("a start older than the loaded slice is in the figures without loading it", async ({ page }) => {
  // The app opens with the latest 400 entries. The first split jerk sits
  // behind them, and the server works Progress out over the whole journal.
  await logLifts(page, [
    { athlete: "gators", day: "2025-01-06", lifts: [{ name: "Split jerk", kg: kg(115), sets: 3, reps: 3 }] },
  ]);
  await page.evaluate(async () => {
    const meals = Array.from({ length: 400 }, () => ({
      id: crypto.randomUUID(), kind: "meal", athlete: "hippos", day: "2026-05-01",
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
  await openProgress(page);

  await expect(page.getByRole("group", { name: "Gators split jerk" }).getByRole("definition").first())
    .toHaveText("115 lb");
  await expect(page.getByText(/Using the latest/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Include the full journal" })).toHaveCount(0);
});

test("each lift shows the max its sets predict and the volume of each week", async ({ page }) => {
  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  await logLifts(page, [
    { athlete: "gators", day: today, lifts: [{ name: "Deadlift", kg: kg(225), sets: 3, reps: 5 }] },
  ]);
  await page.reload();
  await openProgress(page);
  const deadlift = page.getByRole("group", { name: "Gators deadlift" });
  // Five at 225 predicts 225 x 36 / 32 for one, the race estimate's line.
  await expect(deadlift).toContainText("Estimated max ~253 lb, from 225 lb × 5");
  // Three sets of five at 225 lb.
  await expect(deadlift).toContainText("this week 3,375");
  await expect(deadlift.getByRole("img", { name: /^Gators deadlift weekly volume/ })).toBeVisible();
});

test("a session that beats a lift's best says so when it is saved", async ({ page }) => {
  const yesterday = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  });
  await logLifts(page, [
    { athlete: "gators", day: yesterday, lifts: [{ name: "Back squat", kg: kg(185), sets: 3, reps: 5 }] },
  ]);
  await page.reload();
  await page.getByRole("group", { name: "Logging for" }).getByRole("button", { name: "Gators" }).click();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page.locator("select").filter({ has: page.locator('option[value="Tennis"]') }).selectOption("Strength");
  await page
    .locator("select")
    .filter({ has: page.locator('option[value="Back squat"]') })
    .first()
    .selectOption("Back squat");
  await page.getByRole("textbox", { name: "lb", exact: true }).fill("195");
  await page.getByRole("textbox", { name: "Sets", exact: true }).fill("3");
  await page.getByRole("textbox", { name: "Reps", exact: true }).fill("5");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("New best", { exact: true })).toBeVisible();
  await expect(page.getByText("Back squat 195 lb × 5, up from 185 lb × 5")).toBeVisible();
});
