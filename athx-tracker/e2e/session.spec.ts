import { expect, test, type Page } from "@playwright/test";
import { formatTime, projectWorkout } from "../lib/domain.ts";
import { PASSPHRASE } from "../playwright.config.ts";

// These cover the paths that have actually broken. Every bug that reached the
// user in this app was wiring or rendering, which the unit tests cannot see:
// a panel asking for something it gave no way to provide, a preset writing
// over what had been typed, a control showing one theme while the page showed
// another.

const CATEGORIES = ["MetCon", "Strength", "Endurance", "Solidcore", "Tennis", "Other"];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session" })).toBeVisible();
}

const openSession = async (page: Page) => {
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await expect(page.getByRole("group", { name: "Session presets" })).toBeVisible();
};

const typeSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator('option[value="Tennis"]') });

const elapsed = (page: Page) => page.getByLabel(/elapsed time$/);

// The title field is labelled "Session" and the lift load by its unit.
const title = (page: Page) => page.getByLabel("Session", { exact: true });

const formatSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator('option[value="pairs"]') });

const athlete = (page: Page, name: string) =>
  page.getByRole("group", { name: "Logging for" }).getByRole("button", { name });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  // Each spec starts with an empty journal. Sharing one meant a spec looking
  // for "a Tennis session" found the one another spec had saved, and failed
  // over the suite rather than over the app.
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
  await page.reload();
});

test("no category asks for a station it gives you no way to add", async ({ page }) => {
  await openSession(page);
  for (const category of CATEGORIES) {
    await typeSelect(page).selectOption(category);
    const emptyPanel = page.getByText("No stations yet");
    if (await emptyPanel.isVisible()) {
      await expect(
        page.getByRole("button", { name: "Station", exact: true }),
        `${category} shows an empty station panel with no way to fill it`,
      ).toBeVisible();
    }
  }
});

test("a preset fills in the session in one tap", async ({ page }) => {
  await openSession(page);
  await page.getByRole("button", { name: "Tennis 60m" }).click();
  await expect(typeSelect(page)).toHaveValue("Tennis");
  await expect(elapsed(page).first()).toHaveValue("60:00");
  await expect(title(page)).toHaveValue("Tennis");
});

test("a second preset corrects the first rather than leaving it behind", async ({ page }) => {
  await openSession(page);
  await page.getByRole("button", { name: "Solidcore 50m" }).click();
  await expect(title(page)).toHaveValue("Solidcore");
  await page.getByRole("button", { name: "Tennis 60m" }).click();
  // The bug: this saved a tennis session called Solidcore.
  await expect(title(page)).toHaveValue("Tennis");
  await expect(elapsed(page).first()).toHaveValue("60:00");
});

test("a preset does not write over what you typed", async ({ page }) => {
  await openSession(page);
  await title(page).fill("Doubles with Sam");
  await elapsed(page).first().fill("38:00");
  await page.getByRole("button", { name: "Solidcore 50m" }).click();
  await expect(title(page)).toHaveValue("Doubles with Sam");
  await expect(elapsed(page).first()).toHaveValue("38:00");
});

test("a session with nothing timed can still be saved", async ({ page }) => {
  await page.getByRole("button", { name: "Gators", exact: true }).first().click();
  await openSession(page);
  await typeSelect(page).selectOption("Strength");
  await page
    .locator("select")
    .filter({ has: page.locator('option[value="Deadlift"]') })
    .first()
    .selectOption("Deadlift");
  await page.getByLabel("lb", { exact: true }).first().fill("140");
  await page.getByRole("button", { name: "Save session" }).click();
  await page.getByRole("button", { name: "Log", exact: true }).click();
  // Not recorded, which is not a time of zero.
  await expect(page.getByText(/Strength · —/)).toBeVisible();
});

test("the theme buttons change the page, not just themselves", async ({ page }) => {
  const body = page.locator("body");
  await page.getByRole("button", { name: "Light" }).click();
  await expect(body).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(body).toHaveCSS("background-color", "rgb(10, 10, 10)");
  // The choice has to survive a reload, with no flash of the other theme.
  await page.reload();
  await expect(body).toHaveCSS("background-color", "rgb(10, 10, 10)");
});

test("a theme chosen in one tab follows into the other", async ({ page, context }) => {
  // The bug: the second tab's control moved to Dark while its page stayed
  // white, because only the tab doing the choosing applied it.
  await page.getByRole("button", { name: "Light" }).click();
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );

  await page.getByRole("button", { name: "Dark" }).click();
  await expect(second.locator("body")).toHaveCSS(
    "background-color",
    "rgb(10, 10, 10)",
  );
  await second.close();
});

test("the format follows the switch at the top", async ({ page }) => {
  // It sat at Pairs whatever the switch said, so a solo session claimed
  // otherwise unless you noticed the dropdown.
  await athlete(page, "Both").click();
  await openSession(page);
  await expect(formatSelect(page)).toHaveValue("pairs");

  await athlete(page, "Gators").click();
  await expect(formatSelect(page)).toHaveValue("solo");

  await athlete(page, "Both").click();
  await expect(formatSelect(page)).toHaveValue("pairs");
});

test("choosing the format yourself pins it against the switch", async ({ page }) => {
  await athlete(page, "Both").click();
  await openSession(page);
  await formatSelect(page).selectOption("solo");
  await athlete(page, "Gators").click();
  await expect(formatSelect(page)).toHaveValue("solo");
});

test("an Other session is logged under the name you give it", async ({ page }) => {
  await athlete(page, "Gators").click();
  await openSession(page);
  await typeSelect(page).selectOption("Other");
  await page.getByLabel("What was it?").fill("Hiking");
  await elapsed(page).first().fill("90:00");
  await page.getByRole("button", { name: "Save session" }).click();

  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText(/· Hiking ·/)).toBeVisible();
  await expect(page.getByText(/· Other ·/)).toHaveCount(0);
});

test("the name field belongs to Other alone", async ({ page }) => {
  await athlete(page, "Gators").click();
  await openSession(page);
  await typeSelect(page).selectOption("Other");
  await expect(page.getByLabel("What was it?")).toBeVisible();
  await page.getByLabel("What was it?").fill("Hiking");

  await typeSelect(page).selectOption("Tennis");
  await expect(page.getByLabel("What was it?")).toHaveCount(0);

  // And it is not quietly carried along either: a name typed and then
  // abandoned must not ride into the record of a session it does not describe.
  await elapsed(page).first().fill("60:00");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const data = await fetch("/api/records").then((r) => r.json());
        return data.records.map(
          (r: { category: string; customCategory: string }) =>
            `${r.category}:${r.customCategory}`,
        );
      }),
    )
    .toContain("Tennis:");
});

test("a partial session shows its finish on the log, and an untimed one does not", async ({ page }) => {
  await athlete(page, "Gators").click();
  await openSession(page);
  await typeSelect(page).selectOption("Tennis");
  await page.getByRole("button", { name: "Station", exact: true }).click();
  await page
    .locator("select")
    .filter({ has: page.locator('option[value="Row"]') })
    .selectOption("Row");
  await page.getByLabel("Target").fill("30");
  await page.getByLabel("Done (reps)").fill("15");
  await page.getByLabel("Time", { exact: true }).fill("2:00");
  await elapsed(page).fill("5:00");
  await page.getByRole("button", { name: "Save session" }).click();

  // Same estimate the log is built from: observed 5:00 kept, the unfinished
  // half of the station extended at the pace just held, with the stored
  // fatigue allowance. Not a second copy of that arithmetic.
  const projected = projectWorkout(
    [{ name: "Row", unit: "reps", completed: 15, target: 30, seconds: 120 }],
    300,
    10,
    0,
  );
  const finish = `At this pace, the whole session is about ${formatTime(projected!.estimate)}.`;

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByText(finish)).toBeVisible();

  await page.getByRole("button", { name: "Log", exact: true }).click();
  const partial = page.getByRole("listitem").filter({ hasText: "Tennis" });
  await expect(partial.getByText(finish)).toBeVisible();

  await openSession(page);
  await typeSelect(page).selectOption("Strength");
  await page
    .locator("select")
    .filter({ has: page.locator('option[value="Deadlift"]') })
    .first()
    .selectOption("Deadlift");
  await page.getByLabel("lb", { exact: true }).first().fill("140");
  await page.getByRole("button", { name: "Save session" }).click();
  await page.getByRole("button", { name: "Log", exact: true }).click();
  const untimed = page.getByRole("listitem").filter({ hasText: "Strength" });
  await expect(untimed.getByText(/· —/)).toBeVisible();
  await expect(untimed.getByText(/whole session/)).toHaveCount(0);
  await expect(page.getByText(finish)).toBeVisible();
});

test("the full-workout scenario is no longer in the form", async ({ page }) => {
  await openSession(page);
  for (const category of CATEGORIES) {
    await typeSelect(page).selectOption(category);
    await expect(page.getByText("Full-workout scenario")).toHaveCount(0);
    await expect(page.getByText("Fatigue allowance on unperformed work")).toHaveCount(0);
  }
});

test("a session reports what it burned, once it can", async ({ page }) => {
  await athlete(page, "Gators").click();
  await openSession(page);
  await page.getByRole("button", { name: "Tennis 60m" }).click();
  await page.getByRole("button", { name: "Save session" }).click();

  // Without a bodyweight there is nothing to compute from, and a figure is
  // withheld rather than invented.
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText(/· Tennis ·/)).toBeVisible();
  await expect(page.getByText(/kcal/)).toHaveCount(0);

  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByLabel(/^Bodyweight/).nth(1).fill("185");
  await page.getByRole("button", { name: "Save settings" }).click();

  // 7 MET for tennis, 185 lb, an hour: about 620 kcal, to the nearest ten.
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText(/· Tennis · 60:00 · ~620 kcal/)).toBeVisible();

  // And on the panel that puts the last session in front of you.
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByText(/60:00 · ~620 kcal/)).toBeVisible();
});
