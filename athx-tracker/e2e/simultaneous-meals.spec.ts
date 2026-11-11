import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

// Several meals estimated at once, in one tab or in two: each answer lands on
// the meal it was asked for, and no meal is written over by another.

const answers: Record<string, { name: string; calories: number }> = {
  "Chicken and rice bowl": { name: "Chicken rice bowl", calories: 650 },
  "Salmon and potatoes": { name: "Salmon plate", calories: 540 },
};
const estimate = (description: string) => ({
  ...answers[description], protein: 40, carbs: 50, fat: 20,
  assumptions: `Read from: ${description}.`, confidence: "medium",
});

const section = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true });
const drafts = (page: Page) => page.getByRole("region", { name: "Drafts" });
// A meal set aside mid-estimate stays mounted, out of sight, with the same
// labels as the one on screen.
const shown = (page: Page) => page.locator("form").filter({ visible: true });
const notice = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const header = (page: Page) => page.getByRole("group", { name: "Logging for" });
const meals = async (page: Page, names: string[]) =>
  ((await page.evaluate(async () => (await fetch("/api/records").then((r) => r.json())).records)) as {
    id: string; name: string; athlete: string; macros: { calories: number };
  }[]).filter((record) => names.includes(record.name));

function gate() {
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(section(page, "Today")).toHaveAttribute("aria-current", "page");
}

/** Deletes what a spec saved: every spec shares one journal. */
async function forget(page: Page, names: string[]) {
  const ids = (await meals(page, names)).map((record) => record.id);
  await page.evaluate(async (all) => {
    for (const id of all)
      await fetch("/api/records", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
  }, ids);
}

test("a meal set aside mid-estimate goes on estimating, and each answer lands on its own meal", async ({ page }) => {
  await signIn(page);
  const gates = new Map<string, ReturnType<typeof gate>>();
  const asked: string[] = [];
  await page.route("**/api/estimate", async (route) => {
    const { description } = route.request().postDataJSON() as { description: string };
    const held = gate();
    gates.set(description, held);
    asked.push(description);
    await held.waiting;
    await route.fulfill({ json: { estimate: estimate(description), provider: "codex" } });
  });

  await section(page, "Meal").click();
  await shown(page).getByLabel("Meal description").fill("Chicken and rice bowl");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect.poll(() => asked.length).toBe(1);

  // A new meal while the first estimates: the first waits in Drafts, still going.
  await page.getByRole("button", { name: "New meal", exact: true }).click();
  await expect(shown(page).getByLabel("Meal description")).toHaveValue("");
  await expect(shown(page).getByLabel("Meal description")).toBeEnabled();
  await expect(drafts(page).getByRole("button", { name: "Open draft: Chicken and rice bowl" })).toBeVisible();
  await expect(drafts(page)).toContainText("Estimating…");

  await shown(page).getByLabel("Meal description").fill("Salmon and potatoes");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect.poll(() => asked.length).toBe(2);

  // The first answer goes to the first meal, not to the one on screen.
  gates.get("Chicken and rice bowl")!.release();
  await expect(notice(page, "Meal estimate ready")).toContainText("Chicken rice bowl");
  await expect(drafts(page)).not.toContainText("Estimating…");
  await expect(shown(page).getByLabel("Meal description")).toHaveValue("Salmon and potatoes");
  await expect(shown(page).getByLabel("Calories (kcal)")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Estimating…", exact: true })).toBeDisabled();

  // Back to the first, with its answer; the second is set aside, still estimating.
  await notice(page, "Meal estimate ready").getByRole("button", { name: "View meal" }).click();
  await expect(shown(page).getByLabel("Meal description")).toHaveValue("Chicken and rice bowl");
  await expect(shown(page).getByLabel("Calories (kcal)")).toHaveValue("650");
  await expect(drafts(page).getByRole("button", { name: "Open draft: Salmon and potatoes" })).toBeVisible();
  await expect(drafts(page)).toContainText("Estimating…");

  gates.get("Salmon and potatoes")!.release();
  await expect(notice(page, "Meal estimate ready").filter({ hasText: "Salmon plate" })).toBeVisible();
  await expect(shown(page).getByLabel("Calories (kcal)")).toHaveValue("650");

  // Two saves, two meals, each with its own figures. Nothing was asked twice.
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(section(page, "Today")).toHaveAttribute("aria-current", "page");
  await section(page, "Meal").click();
  await drafts(page).getByRole("button", { name: "Open draft: Salmon plate" }).click();
  await expect(shown(page).getByLabel("Meal description")).toHaveValue("Salmon and potatoes");
  await expect(shown(page).getByLabel("Calories (kcal)")).toHaveValue("540");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(section(page, "Today")).toHaveAttribute("aria-current", "page");

  const saved = await meals(page, ["Chicken rice bowl", "Salmon plate"]);
  expect(saved.map((meal) => [meal.name, meal.macros.calories]).sort()).toEqual([
    ["Chicken rice bowl", 650],
    ["Salmon plate", 540],
  ]);
  expect(new Set(saved.map((meal) => meal.id)).size).toBe(2);
  expect(asked).toHaveLength(2);
  await forget(page, ["Chicken rice bowl", "Salmon plate"]);
});

test("another draft opened mid-estimate leaves the estimate running on its own meal", async ({ page }) => {
  await signIn(page);
  const pending = gate();
  let calls = 0;
  await page.route("**/api/estimate", async (route) => {
    calls++;
    await pending.waiting;
    await route.fulfill({ json: { estimate: estimate("Chicken and rice bowl"), provider: "codex" } });
  });
  await section(page, "Meal").click();
  await shown(page).getByLabel("Meal", { exact: true }).fill("Typed first");
  await page.getByRole("button", { name: "New meal", exact: true }).click();
  await shown(page).getByLabel("Meal description").fill("Chicken and rice bowl");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect.poll(() => calls).toBe(1);

  await drafts(page).getByRole("button", { name: "Open draft: Typed first" }).click();
  await expect(shown(page).getByLabel("Meal", { exact: true })).toHaveValue("Typed first");
  await expect(drafts(page)).toContainText("Estimating…");
  pending.release();
  await expect(notice(page, "Meal estimate ready")).toContainText("Chicken rice bowl");
  // Still on the meal that was opened, untouched by the answer.
  await expect(shown(page).getByLabel("Meal", { exact: true })).toHaveValue("Typed first");
  await expect(shown(page).getByLabel("Calories (kcal)")).toHaveValue("");

  await drafts(page).getByRole("button", { name: "Open draft: Chicken rice bowl" }).click();
  await expect(shown(page).getByLabel("Calories (kcal)")).toHaveValue("650");
  expect(calls).toBe(1);
});

test("a second tab starts its own meal, for its own athlete, and leaves the first tab's alone", async ({ page, context }) => {
  await signIn(page);
  await section(page, "Meal").click();
  await shown(page).getByLabel("Meal", { exact: true }).fill("Tab one oats");
  await shown(page).getByLabel("Calories (kcal)").fill("400");
  await shown(page).getByLabel("Protein (g)").fill("20");

  const second = await context.newPage();
  await second.goto("/");
  await section(second, "Meal").click();
  // Not the first tab's meal: a fresh form, with that meal listed as open there.
  await expect(shown(second).getByLabel("Meal", { exact: true })).toHaveValue("");
  const theirs = drafts(second).getByRole("button", { name: "Open draft: Tab one oats" });
  await expect(theirs).toBeVisible();
  await expect(drafts(second)).toContainText("Open in another tab");
  await expect(drafts(second).getByRole("button", { name: "Delete draft: Tab one oats" })).toHaveCount(0);
  await theirs.click();
  await expect(second.getByText("That meal is open in another tab.")).toBeVisible();
  await expect(shown(second).getByLabel("Meal", { exact: true })).toHaveValue("");

  // Switching athlete in the second tab does not move the first tab's meal.
  await header(second).getByRole("button", { name: "Gators" }).click();
  await shown(second).getByLabel("Meal", { exact: true }).fill("Tab two eggs");
  await shown(second).getByLabel("Calories (kcal)").fill("300");
  await shown(second).getByLabel("Protein (g)").fill("25");
  await expect(header(page).getByRole("button", { name: "Hippos" })).toHaveAttribute("aria-pressed", "true");
  await expect(shown(page).getByLabel("Meal", { exact: true })).toHaveValue("Tab one oats");

  await second.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(section(second, "Today")).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(section(page, "Today")).toHaveAttribute("aria-current", "page");
  const saved = await meals(page, ["Tab one oats", "Tab two eggs"]);
  expect(saved.map((meal) => [meal.name, meal.athlete]).sort()).toEqual([
    ["Tab one oats", "hippos"],
    ["Tab two eggs", "gators"],
  ]);
  expect(new Set(saved.map((meal) => meal.id)).size).toBe(2);
  await forget(second, ["Tab one oats", "Tab two eggs"]);
  await second.close();
});

test("a draft another tab had open opens here once that tab is closed", async ({ page, context }) => {
  await signIn(page);
  await section(page, "Meal").click();
  await shown(page).getByLabel("Meal", { exact: true }).fill("Left in a closed tab");

  const second = await context.newPage();
  await second.goto("/");
  await section(second, "Meal").click();
  await expect(drafts(second)).toContainText("Open in another tab");
  await page.close();

  // Drafts looks again when the tab comes back into view.
  await expect.poll(async () => {
    await second.evaluate(() => window.dispatchEvent(new Event("focus")));
    return drafts(second).textContent();
  }).not.toContain("Open in another tab");
  await drafts(second).getByRole("button", { name: "Open draft: Left in a closed tab" }).click();
  await expect(shown(second).getByLabel("Meal", { exact: true })).toHaveValue("Left in a closed tab");
  await second.getByRole("button", { name: "Discard draft" }).click();
});
