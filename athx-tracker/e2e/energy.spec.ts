import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

// How each athlete feels, out of 10: each tap on Today logs one more, at
// breakfast, lunch or dinner, and a check-in is corrected in the Log like a
// weigh-in.

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

/**
 * A check-in saved straight to the server, a number of days back from the
 * phone's today. A null timing is one from before timings, read by its time.
 */
async function checkIn(
  page: Page,
  athlete: string,
  level: number,
  daysAgo: number,
  { timing = "Breakfast", time = "08:00" }: { timing?: string | null; time?: string } = {},
) {
  await page.evaluate(async ({ athlete, level, daysAgo, timing, time }) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const response = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), kind: "energy", athlete, day, time, ...(timing ? { timing } : {}), level }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, { athlete, level, daysAgo, timing, time });
}

const saved = (page: Page) =>
  page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return (data.records as { kind: string; athlete: string; level: number; timing?: string; time?: string }[])
      .filter((record) => record.kind === "energy");
  });

/** The phone's clock held at a time of day, today, and the page opened again on it. */
async function clockAt(page: Page, hour: number, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  await page.clock.setFixedTime(date);
  await page.reload();
}

const nav = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();

const card = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Energy", exact: true }) });

const timings = (page: Page) => card(page).getByRole("group", { name: "Timing" });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await reset(page);
  await page.reload();
});

test.afterEach(async ({ page }) => {
  await reset(page);
});

test("each tap logs one more check-in at the clock's timing, and another timing is its own", async ({ page }) => {
  await clockAt(page, 8, 15);
  const energy = card(page);
  await expect(timings(page).getByRole("button", { name: "Breakfast" })).toHaveAttribute("aria-pressed", "true");
  const hippos = energy.getByRole("group", { name: "Hippos energy at breakfast today" });
  await expect(energy.getByText("Not logged at breakfast today")).toHaveCount(2);

  await hippos.getByRole("button", { name: "Log 7 out of 10" }).click();
  await expect(energy.getByText("Today 7/10 · 08:15", { exact: true })).toBeVisible();
  await expect.poll(() => saved(page)).toEqual([
    expect.objectContaining({ athlete: "hippos", timing: "Breakfast", time: "08:15", level: 7 }),
  ]);
  // The buttons log rather than choose, so none stays pressed.
  await expect(hippos.getByRole("button", { name: "Log 7 out of 10" })).not.toHaveAttribute("aria-pressed");

  // A second tap adds a check-in; it does not change the first.
  await page.clock.setFixedTime(new Date(new Date().setHours(8, 40, 0, 0)));
  await hippos.getByRole("button", { name: "Log 5 out of 10" }).click();
  await expect(energy.getByText("Today 7, 5 · avg 6/10", { exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page)).map(({ level, time }) => `${level} ${time}`).sort())
    .toEqual(["5 08:40", "7 08:15"]);

  // Lunch is its own. It is not lunchtime, so it takes no time of day.
  await timings(page).getByRole("button", { name: "Lunch" }).click();
  await expect(energy.getByText("Not logged at lunch today")).toHaveCount(2);
  await energy.getByRole("group", { name: "Hippos energy at lunch today" }).getByRole("button", { name: "Log 9 out of 10" }).click();
  await expect(energy.getByText("Today 9/10", { exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page)).length).toBe(3);
  // Today's cell weighs breakfast and lunch the same: (6 + 9) / 2.
  await expect(energy.getByRole("row", { name: /^Hippos/ }).getByRole("cell").nth(6)).toHaveText("7.5");

  // Gators is untouched, and it all survives a reload, which goes back to the clock's timing.
  await page.reload();
  await expect(timings(page).getByRole("button", { name: "Breakfast" })).toHaveAttribute("aria-pressed", "true");
  await expect(card(page).getByText("Today 7, 5 · avg 6/10", { exact: true })).toBeVisible();
  await expect(card(page).getByText("Not logged at breakfast today")).toHaveCount(1);

  // Folded, the box keeps the timing's mean.
  await card(page).getByRole("button", { name: "Collapse Energy" }).click();
  await expect(card(page).getByText("Today at breakfast: Hippos 6 · Gators —")).toBeVisible();
});

test("the timing follows a meal's hours, and B, L and D choose it as they do a meal's sitting", async ({ page }) => {
  // The afternoon counts as lunch, late evening as dinner and before dawn as breakfast.
  for (const [hour, minute, timing] of [
    [9, 0, "Breakfast"], [12, 30, "Lunch"], [15, 30, "Lunch"], [19, 0, "Dinner"], [23, 0, "Dinner"], [2, 0, "Breakfast"],
  ] as const) {
    await clockAt(page, hour, minute);
    await expect(timings(page).getByRole("button", { name: timing })).toHaveAttribute("aria-pressed", "true");
  }

  for (const [key, timing] of [["d", "Dinner"], ["l", "Lunch"], ["b", "Breakfast"], ["d", "Dinner"]]) {
    await page.keyboard.press(key);
    await expect(timings(page).getByRole("button", { name: timing })).toHaveAttribute("aria-pressed", "true");
  }
  // Y moves the day and keeps the timing.
  await page.keyboard.press("y");
  await expect(card(page).getByRole("button", { name: "Energy yesterday" })).toHaveAttribute("aria-pressed", "true");
  await card(page).getByRole("group", { name: "Gators energy at dinner yesterday" }).getByRole("button", { name: "Log 3 out of 10" }).click();
  await expect.poll(() => saved(page)).toEqual([expect.objectContaining({ athlete: "gators", timing: "Dinner", level: 3 })]);
});

test("an open card turns to lunch at 11:00 by itself, and opens for it", async ({ page }) => {
  await checkIn(page, "hippos", 7, 0);
  await checkIn(page, "gators", 5, 0);
  const date = new Date();
  date.setHours(10, 59, 30, 0);
  await page.clock.install({ time: date });
  await page.reload();
  // Both have checked in at breakfast, so it opens folded.
  await expect(card(page).getByText("Today at breakfast: Hippos 7 · Gators 5")).toBeVisible();

  // Nothing else redraws the page across the hour.
  await page.clock.runFor(60_000);
  await expect(card(page).getByRole("button", { name: "Collapse Energy" })).toBeVisible();
  await expect(timings(page).getByRole("button", { name: "Lunch" })).toHaveAttribute("aria-pressed", "true");
  await expect(card(page).getByText("Not logged at lunch today")).toHaveCount(2);
});

test("the last seven days weigh each timing of a day the same, and average the days that have one", async ({ page }) => {
  await checkIn(page, "gators", 6, 2);
  await checkIn(page, "gators", 8, 2, { timing: "Dinner", time: "19:00" });
  // Three at lunch and one at breakfast is (9 + 3) / 2, not (9 + 9 + 9 + 3) / 4.
  for (const time of ["12:00", "12:30", "13:00"]) await checkIn(page, "gators", 9, 1, { timing: "Lunch", time });
  await checkIn(page, "gators", 3, 1);
  // Eight days back is outside the week, and stays out of the average.
  await checkIn(page, "gators", 1, 8);
  await page.reload();

  const gators = card(page).getByRole("row", { name: /^Gators/ });
  // An empty day reads "none" to a screen reader, under a dot drawn for the eye.
  // The average is over days: (7 + 6) / 2.
  await expect(gators.getByRole("cell")).toHaveText([/none/, /none/, /none/, /none/, "7", "6", /none/, "6.5"]);
});

test("the server keeps every check-in, two for one timing included", async ({ page }) => {
  // Two at breakfast, one of them from before timings, which its 08:00 puts there.
  await checkIn(page, "hippos", 3, 0);
  await checkIn(page, "hippos", 8, 0, { timing: null, time: "08:00" });
  await checkIn(page, "hippos", 3, 0);
  await checkIn(page, "gators", 5, 0);
  const kept = (await saved(page)).map(({ athlete, level }) => `${athlete} ${level}`).sort();
  expect(kept).toEqual(["gators 5", "hippos 3", "hippos 3", "hippos 8"]);
});

test("a check-in is corrected where it stands in the log, and replaces nothing", async ({ page }) => {
  // Saved before the page opens, so the phone holds it too.
  await checkIn(page, "gators", 3, 1);
  await clockAt(page, 8);
  await card(page).getByRole("group", { name: "Gators energy at breakfast today" }).getByRole("button", { name: "Log 5 out of 10" }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(2);

  await nav(page, "Log");
  await page.getByRole("combobox", { name: "Filter by entry type" }).selectOption("energy");
  const entry = page.getByRole("listitem").filter({ hasText: "Energy 5/10" });
  await expect(entry).toContainText("08:00 · Gators · breakfast check-in");
  await entry.getByRole("button", { name: "Edit entry" }).click();
  await expect(page.getByRole("group", { name: "Timing" }).getByRole("button", { name: "Breakfast" }))
    .toHaveAttribute("aria-pressed", "true");
  await page.getByRole("group", { name: "Gators energy" }).getByRole("button", { name: "8 out of 10" }).click();
  await page.getByRole("group", { name: "Date" }).getByRole("button", { name: "Yesterday" }).click();
  await page.getByLabel("Time of day").fill("06:30");
  await page.getByRole("button", { name: "Save check-in" }).click();
  await expect(page.getByText("Entry updated", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Energy 8/10" })).toContainText("06:30 · Gators · breakfast check-in");
  await expect(page.getByRole("heading", { name: "Yesterday" })).toBeVisible();
  // Yesterday's breakfast already had one, which stays beside it.
  await expect(page.getByRole("listitem").filter({ hasText: "Energy 3/10" })).toHaveCount(1);
  await expect.poll(async () => (await saved(page)).map(({ level }) => level).sort()).toEqual([3, 8]);

  // Its timing changes too.
  await page.getByRole("listitem").filter({ hasText: "Energy 8/10" }).getByRole("button", { name: "Edit entry" }).click();
  await page.getByRole("group", { name: "Timing" }).getByRole("button", { name: "Dinner" }).click();
  await page.getByRole("button", { name: "Save check-in" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Energy 8/10" })).toContainText("06:30 · Gators · dinner check-in");
  await expect.poll(async () => (await saved(page)).map(({ timing }) => timing).sort()).toEqual(["Breakfast", "Dinner"]);

  // Moved to yesterday, today is open again.
  await nav(page, "Today");
  await expect(card(page).getByText("Not logged at breakfast today")).toHaveCount(2);
});
