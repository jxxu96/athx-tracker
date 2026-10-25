import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, formatTime, projectWorkout } from "../lib/domain.ts";
import { PASSPHRASE } from "../playwright.config.ts";

// These cover the paths that have actually broken. Every bug that reached the
// user in this app was wiring or rendering, which the unit tests cannot see:
// a panel asking for something it gave no way to provide, a preset writing
// over what had been typed, a control showing one theme while the page showed
// another.

const CATEGORIES = ["MetCon", "Strength", "Endurance", "Mixed", "Solidcore", "Tennis", "YTW", "Other"];

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

/**
 * Today repeats the last session's athlete, type and date, so a locator that
 * finds an entry does not prove the Log is showing. This waits for something
 * only the Log has, which matters most for assertions that something is
 * absent: those pass or fail on whichever page happens to be up.
 */
const openLog = async (page: Page) => {
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(
    page.locator("select").filter({ has: page.locator('option[value="workout"]') }),
  ).toHaveCount(1);
};

const typeSelect = (page: Page) =>
  page.locator("select").filter({ has: page.locator('option[value="Tennis"]') });

const elapsed = (page: Page) => page.getByLabel(/elapsed time$/);

// The title field is labelled "Session" and the lift load by its unit.
const title = (page: Page) => page.getByLabel("Session", { exact: true });

const formatButton = (page: Page, name: "Hippos" | "Gators" | "Pairs") =>
  page.getByRole("group", { name: "Format" }).getByRole("button", { name });

const athlete = (page: Page, name: string) =>
  page.getByRole("group", { name: "Logging for" }).getByRole("button", { name });

const sessions = (page: Page) =>
  page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return (data.records as { athlete: string; context: string; day: string }[])
      .map((record) => `${record.athlete}:${record.context}:${record.day}`)
      .sort();
  });

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
  // And with the settings as they come. Clearing only the journal left the
  // bodyweight another spec file had set, and these files run in name order,
  // so whether a spec saw one depended on which letter its file started with.
  await page.evaluate(async (settings) => {
    const { revision } = await fetch("/api/settings").then((r) => r.json());
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings, revision }),
    });
  }, DEFAULT_SETTINGS);
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
  await page.getByRole("button", { name: "YTW 15m" }).click();
  await expect(typeSelect(page)).toHaveValue("YTW");
  await expect(elapsed(page).first()).toHaveValue("15:00");
  await expect(title(page)).toHaveValue("YTW");

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
  await openLog(page);
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

test("the session boxes take the colour of who is training", async ({ page }) => {
  await openSession(page);
  const colors = await page.evaluate(() => {
    const read = (name: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return { hippos: read("--athlete-hippos-ink"), gators: read("--athlete-gators-ink") };
  });
  const card = page.locator("form section").first();
  const ring = () => card.evaluate((el) => getComputedStyle(el).backgroundImage);

  await expect(formatButton(page, "Hippos")).toHaveAttribute("data-athlete-outline", "hippos");
  await expect(athlete(page, "Hippos")).toHaveAttribute("data-athlete-outline", "hippos");
  await expect(card).toHaveAttribute("data-athlete-outline", "hippos");
  await expect(formatButton(page, "Pairs")).not.toHaveAttribute("data-athlete-outline");
  const pink = await ring();
  expect(pink).toContain(colors.hippos);
  expect(pink).not.toContain(colors.gators);

  await formatButton(page, "Pairs").click();
  await expect(formatButton(page, "Pairs")).toHaveAttribute("data-athlete-outline", "both");
  await expect(card).toHaveAttribute("data-athlete-outline", "both");
  const split = await ring();
  expect(split).toContain(colors.hippos);
  expect(split).toContain(colors.gators);

  await formatButton(page, "Gators").click();
  await expect(formatButton(page, "Gators")).toHaveAttribute("data-athlete-outline", "gators");
  await expect(formatButton(page, "Pairs")).not.toHaveAttribute("data-athlete-outline");
  await expect(card).toHaveAttribute("data-athlete-outline", "gators");
  const green = await ring();
  expect(green).toContain(colors.gators);
  expect(green).not.toContain(colors.hippos);
});

test("format names who is training and matches the switch", async ({ page }) => {
  // The journal opens on Hippos. Solo and Pairs name who is training.
  await expect(athlete(page, "Hippos")).toHaveAttribute("aria-pressed", "true");
  await athlete(page, "Both").click();
  await openSession(page);
  await expect(formatButton(page, "Pairs")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/elapsed time$/)).toHaveCount(2);

  await formatButton(page, "Gators").click();
  await expect(formatButton(page, "Gators")).toHaveAttribute("aria-pressed", "true");
  await expect(athlete(page, "Gators")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/elapsed time$/)).toHaveCount(1);

  await athlete(page, "Hippos").click();
  await expect(formatButton(page, "Hippos")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/elapsed time$/)).toHaveCount(1);

  await formatButton(page, "Pairs").click();
  await expect(athlete(page, "Both")).toHaveAttribute("aria-pressed", "true");
  await expect(formatButton(page, "Pairs")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/elapsed time$/)).toHaveCount(2);
});

test("pairs writes both people and one person writes a solo session", async ({ page }) => {
  await athlete(page, "Both").click();
  await openSession(page);
  await page.getByRole("button", { name: "Tennis 60m" }).click();
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("Sessions saved")).toBeVisible();

  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  await expect.poll(() => sessions(page)).toEqual([
    `gators:pairs:${today}`,
    `hippos:pairs:${today}`,
  ]);

  await openSession(page);
  await formatButton(page, "Hippos").click();
  await page.getByRole("button", { name: "Tennis 60m" }).click();
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("Session saved")).toBeVisible();
  await expect.poll(() => sessions(page)).toEqual([
    `gators:pairs:${today}`,
    `hippos:pairs:${today}`,
    `hippos:solo:${today}`,
  ]);
});

test("the date is today, yesterday, or a day from the calendar", async ({ page }) => {
  await athlete(page, "Gators").click();
  await openSession(page);
  const dates = page.getByRole("group", { name: "Date" });
  await expect(dates.getByRole("button", { name: "Today", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await dates.getByRole("button", { name: "Yesterday", exact: true }).click();
  await expect(dates.getByRole("button", { name: "Yesterday", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const picked = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 3);
    return {
      day: new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date),
      dataDay: date.toLocaleDateString(),
    };
  });
  await dates.getByRole("button", { name: "Calendar", exact: true }).click();
  const tomorrow = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toLocaleDateString();
  });
  await expect(page.locator(`[data-day="${tomorrow}"]`)).toBeDisabled();
  await page.locator(`[data-day="${picked.dataDay}"]`).click();
  await expect(dates.getByRole("button", { name: /^Calendar/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Tennis 60m" }).click();
  await page.getByRole("button", { name: "Save session" }).click();
  await expect.poll(() => sessions(page)).toEqual([`gators:solo:${picked.day}`]);
});

test("pairs on an open edit stays one record", async ({ page }) => {
  await athlete(page, "Gators").click();
  await openSession(page);
  await page.getByRole("button", { name: "Tennis 60m" }).click();
  await page.getByRole("button", { name: "Save session" }).click();
  await openLog(page);
  await page.getByLabel("Edit entry").click();
  await expect(formatButton(page, "Gators")).toHaveAttribute("aria-pressed", "true");
  await formatButton(page, "Pairs").click();
  await expect(formatButton(page, "Pairs")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/elapsed time$/)).toHaveCount(1);
  await page.getByRole("button", { name: "Update session" }).click();
  await expect.poll(async () =>
    (await sessions(page)).map((row) => row.split(":").slice(0, 2).join(":")),
  ).toEqual(["gators:pairs"]);
});

test("an Other session is logged under the name you give it", async ({ page }) => {
  await athlete(page, "Gators").click();
  await openSession(page);
  await typeSelect(page).selectOption("Other");
  await page.getByLabel("What was it?").fill("Hiking");
  await elapsed(page).first().fill("90:00");
  await page.getByRole("button", { name: "Save session" }).click();

  await openLog(page);
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

  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByText(finish)).toBeVisible();

  await openLog(page);
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
  await openLog(page);
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
  await openLog(page);
  const row = page.getByRole("listitem").filter({ hasText: "Tennis" });
  await expect(row).toBeVisible();
  await expect(row.getByText(/kcal/)).toHaveCount(0);

  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByLabel(/^Bodyweight/).nth(1).fill("185");
  await page.getByRole("button", { name: "Save settings" }).click();

  // 7 MET for tennis, 185 lb, an hour: about 620 kcal, to the nearest ten.
  await openLog(page);
  await expect(page.getByText(/· Tennis · 60:00 · ~620 kcal/)).toBeVisible();

  // And on the panel that puts the last session in front of you.
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByText(/60:00 · ~620 kcal/)).toBeVisible();
});

test("squats with no clock still show a burn", async ({ page }) => {
  await athlete(page, "Gators").click();
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByLabel(/^Bodyweight/).nth(1).fill("185");
  await page.getByRole("button", { name: "Save settings" }).click();

  await openSession(page);
  await typeSelect(page).selectOption("Strength");
  await page
    .locator("select")
    .filter({ has: page.locator('option[value="Back squat"]') })
    .first()
    .selectOption("Back squat");
  await page.getByRole("textbox", { name: "lb", exact: true }).fill("135");
  await page.getByRole("textbox", { name: "Sets", exact: true }).fill("3");
  await page.getByRole("textbox", { name: "Reps", exact: true }).fill("5");
  await page.getByRole("button", { name: "Save session" }).click();

  // 3x5 with no clock, 185 lb. Six minutes at 6 MET rounds to 50.
  await openLog(page);
  await expect(page.getByText(/Strength · — · ~50 kcal/)).toBeVisible();
});

test("one session holds lifts, a part-finished MetCon with loads, and a run", async ({ page }) => {
  await athlete(page, "Gators").click();
  await openSession(page);
  await typeSelect(page).selectOption("Mixed");

  // Weights switched here are remembered, and the boxes read in the new unit.
  await page.getByRole("group", { name: "Weight unit" }).getByRole("button", { name: "kg" }).click();

  await page
    .locator("select")
    .filter({ has: page.locator('option[value="Deadlift"]') })
    .first()
    .selectOption("Deadlift");
  await page.getByLabel("kg", { exact: true }).fill("100");

  await page.getByRole("button", { name: "ATHX circuit" }).click();
  await page.getByLabel("Done (cal)").first().fill("40");
  await page.getByLabel("Done (reps)").first().fill("20");
  await page.getByLabel("Gators DB ground to overhead load").fill("12.5");
  await page.getByLabel(/stopped at the time cap/).check();

  await page.getByRole("button", { name: "Endurance" }).click();
  await page.getByLabel("Covered (m)").fill("1000");
  await elapsed(page).fill("30:00");
  await page.getByRole("button", { name: "Save session" }).click();

  const saved = await page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    const settings = await fetch("/api/settings").then((r) => r.json());
    return { record: data.records[0], unit: settings.settings.weightUnit };
  });
  expect(saved.unit).toBe("kg");
  expect(saved.record.category).toBe("Mixed");
  expect(saved.record.capHit).toBe(true);
  expect(saved.record.lifts[0].kg).toBe(100);
  const g2oh = saved.record.segments.find((s: { name: string }) => s.name === "DB ground to overhead");
  expect(g2oh.kg).toBe(12.5);
  expect(g2oh.completed).toBe(20);
  const run = saved.record.segments.find((s: { block?: string }) => s.block === "endurance");
  expect(run).toMatchObject({ name: "Run", completed: 1000, target: 1000 });

  await openLog(page);
  const entry = page.getByRole("listitem").filter({ hasText: "Strength + MetCon + Endurance" });
  await expect(entry).toBeVisible();
  await expect(entry.getByText(/time cap hit/)).toBeVisible();
  await expect(entry.getByText(/DB ground to overhead 12\.5 kg/)).toBeVisible();
});

test("a run can be logged in metres, kilometres, or miles", async ({ page }) => {
  await athlete(page, "Gators").click();
  await openSession(page);
  await typeSelect(page).selectOption("Endurance");
  const units = page.getByRole("group", { name: "Distance unit" });
  const distanceUnit = (name: "meters" | "kilometers" | "miles") =>
    units.getByRole("button", { name, exact: true });
  await expect(distanceUnit("meters")).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Distance (m)").fill("5000");
  await distanceUnit("kilometers").click();
  await expect(page.getByLabel("Distance (km)")).toHaveValue("5");
  await distanceUnit("miles").click();
  await expect(page.getByLabel("Distance (mi)")).toHaveValue("3.11");
  await page.getByLabel("Distance (mi)").fill("3");
  await page.getByLabel("Time", { exact: true }).fill("24:00");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("Session saved", { exact: true })).toBeVisible();

  const saved = await page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return data.records[0];
  });
  expect(saved.segments[0]).toMatchObject({ name: "Run", unit: "mi", completed: 3, target: 3 });

  await openLog(page);
  const entry = page.getByRole("listitem").filter({ hasText: "Run 3 mi" });
  await expect(entry).toBeVisible();
  await entry.getByLabel("Edit entry").click();
  await expect(
    page.getByRole("group", { name: "Distance unit" }).getByRole("button", { name: "miles", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Distance (mi)")).toHaveValue("3");
});

test("circuit loads start at the standard weight, and reopening keeps it", async ({ page }) => {
  // Logging for both: the column nobody touched must not become a session
  // just because the form filled its weights in.
  await athlete(page, "Both").click();
  await openSession(page);
  await expect(typeSelect(page)).toHaveValue("MetCon");
  // Settings outlive each spec, so say which unit this one is in.
  const unitSwitch = page.getByRole("group", { name: "Weight unit" });
  await unitSwitch.getByRole("button", { name: "lb" }).click();
  const g2oh = page.getByLabel("Gators DB ground to overhead load");
  const hippos = page.getByLabel("Hippos DB ground to overhead load");
  await expect(g2oh).toHaveValue("35"); // 15 kg is 33.1 lb, on the 5 lb rack
  await expect(hippos).toHaveValue("15"); // 7.5 kg is 16.5 lb
  // Switching offers the other rack's standard, not a conversion of this one.
  await unitSwitch.getByRole("button", { name: "kg" }).click();
  await expect(g2oh).toHaveValue("15");
  await expect(hippos).toHaveValue("7.5");
  await unitSwitch.getByRole("button", { name: "lb" }).click();
  await expect(g2oh).toHaveValue("35");

  const gators = page.locator("li").filter({ hasText: "DB ground to overhead" }).locator("div.rounded-lg").nth(1);
  await gators.getByLabel("Done (reps)").fill("30");
  await page.getByRole("button", { name: "Save session" }).click();

  const read = () =>
    page.evaluate(async () => (await fetch("/api/records").then((r) => r.json())).records);
  await expect.poll(async () => (await read()).length).toBe(1);
  const [saved] = await read();
  expect(saved.athlete).toBe("gators");
  const station = (record: { segments: { name: string; kg?: number }[] }, name: string) =>
    record.segments.find((s) => s.name === name)!;
  const kg = station(saved, "DB ground to overhead").kg;
  expect(kg).toBeCloseTo(35 / 2.20462262, 2);
  // Never reached, so the standard weight in its box was not carried.
  expect(station(saved, "Sandbag squats").kg).toBeUndefined();

  // Reopen and save untouched: the same 35 lb, and not a gram of drift.
  await openLog(page);
  await page.getByLabel("Edit entry").first().click();
  await expect(g2oh).toHaveValue("35");
  await expect(page.getByLabel("Gators Sandbag squats load")).toHaveValue("");
  await page.getByRole("button", { name: "Update session" }).click();
  await expect.poll(async () => station((await read())[0], "DB ground to overhead").kg).toBe(kg);
});

test("an older entry with no loads is not given any when edited", async ({ page }) => {
  await page.evaluate(async () => {
    await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "3f1a5f2e-9c4b-4d7a-8e21-6b0c9d5a1299", kind: "workout", athlete: "gators",
        day: "2026-10-20", title: "Old circuit", category: "MetCon", seconds: 600, notes: "",
        segments: [{ name: "DB ground to overhead", unit: "reps", completed: 30, target: 30, seconds: 120 }],
        fatigue: 10, transition: 0, goal: null, context: "solo", lifts: [],
      }),
    });
  });
  await page.reload();
  await openLog(page);
  await page.getByLabel("Edit entry").first().click();
  await expect(page.getByLabel("Gators DB ground to overhead load")).toHaveValue("");
  await page.getByRole("button", { name: "Update session" }).click();
  const record = await page.evaluate(async () =>
    (await fetch("/api/records").then((r) => r.json())).records[0],
  );
  expect(record.segments[0].kg).toBeUndefined();
});
