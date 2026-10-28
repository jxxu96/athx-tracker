import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

// Half a meal typed when the phone locks, or the app is swiped away, has to
// be there when it opens again; and what was set aside has to be findable.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
  // An empty journal, so nothing another spec saved is in the way.
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

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true }).click();

const mealName = (page: Page) => page.getByLabel("Meal", { exact: true });
const drafts = (page: Page) => page.getByRole("region", { name: "Drafts" });
const kept = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("athx-drafts") ?? '{"drafts":[]}').drafts.length as number);

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("a meal typed and left is there when the app opens again", async ({ page }) => {
  await tab(page, "Meal");
  await mealName(page).fill("Half typed bowl");
  await page.getByLabel("Calories (kcal)").fill("450");
  await expect(page.getByText("Kept as a draft on this phone as you type.")).toBeVisible();

  await page.reload();
  await tab(page, "Meal");
  await expect(mealName(page)).toHaveValue("Half typed bowl");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("450");
});

test("a meal set aside waits in Drafts, opens again, and can be deleted", async ({ page }) => {
  await tab(page, "Meal");
  await mealName(page).fill("First draft");
  await page.getByRole("button", { name: "New meal", exact: true }).click();
  await expect(mealName(page)).toHaveValue("");
  await expect(drafts(page).getByRole("button", { name: "Open draft: First draft" })).toBeVisible();

  await mealName(page).fill("Second draft");
  await drafts(page).getByRole("button", { name: "Open draft: First draft" }).click();
  await expect(mealName(page)).toHaveValue("First draft");
  // The one that was open is the one listed now.
  await expect(drafts(page).getByRole("button", { name: /^Open draft/ })).toHaveCount(1);
  await expect(drafts(page)).toContainText("Second draft");
  await expect(drafts(page)).toContainText(/Hippos · \w+ · Today \d{2}:\d{2}/);

  await drafts(page).getByRole("button", { name: "Delete draft: Second draft" }).click();
  await drafts(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(drafts(page)).toHaveCount(0);
  expect(await kept(page)).toBe(1);
});

test("saving a draft clears it, and so does discarding one", async ({ page }) => {
  await tab(page, "Meal");
  await mealName(page).fill("Saved from a draft");
  await page.getByLabel("Calories (kcal)").fill("500");
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true })).toBeVisible();
  expect(await kept(page)).toBe(0);

  await tab(page, "Meal");
  await expect(mealName(page)).toHaveValue("");
  await mealName(page).fill("Not wanted");
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(mealName(page)).toHaveValue("");
  await expect(drafts(page)).toHaveCount(0);
  expect(await kept(page)).toBe(0);

  // Typing and taking it all back out keeps nothing either.
  await mealName(page).fill("x");
  await mealName(page).fill("");
  expect(await kept(page)).toBe(0);
});

test("a session typed and left comes back, lifts and all", async ({ page }) => {
  await tab(page, "Session");
  await page.getByLabel("Session", { exact: true }).fill("Half logged session");
  await page.locator("select").filter({ has: page.locator('option[value="Tennis"]') }).selectOption("Strength");
  await page.locator("select").filter({ has: page.locator('option[value="Back squat"]') }).first().selectOption("Back squat");
  await page.getByRole("textbox", { name: "lb", exact: true }).fill("135");
  await page.getByRole("textbox", { name: "Sets", exact: true }).fill("3");

  await page.reload();
  await tab(page, "Session");
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue("Half logged session");
  await expect(page.getByRole("textbox", { name: "lb", exact: true })).toHaveValue("135");
  await expect(page.getByRole("textbox", { name: "Sets", exact: true })).toHaveValue("3");
});

test("an edit left unsaved comes back as that edit, and Cancel throws it away", async ({ page }) => {
  await page.evaluate(async () => {
    const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(), kind: "meal", athlete: "gators", day, name: "Logged oats",
        meal: "Breakfast", source: "manual", assumptions: "",
        macros: { calories: 300, protein: 12, carbs: 50, fat: 6 },
      }),
    });
  });
  await page.reload();
  await tab(page, "Log");
  await page.getByRole("listitem").filter({ hasText: "Logged oats" }).getByRole("button", { name: "Edit entry" }).click();
  await page.getByLabel("Calories (kcal)").fill("320");

  await page.reload();
  await tab(page, "Meal");
  await expect(page.getByText("unsaved changes restored")).toBeVisible();
  await expect(page.getByText(/Editing Logged oats/)).toBeVisible();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("320");

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(mealName(page)).toHaveValue("");
  expect(await kept(page)).toBe(0);
  await tab(page, "Log");
  await page.getByRole("listitem").filter({ hasText: "Logged oats" }).getByRole("button", { name: "Edit entry" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("300");
});

test("a draft the form cannot open is removed instead of breaking the app", async ({ page }) => {
  // A session draft whose lift rows are not lift rows, as an older form or a
  // damaged store could leave one.
  await page.evaluate(() => {
    localStorage.setItem("athx-drafts", JSON.stringify({
      drafts: [{
        id: "broken", kind: "session", editing: null, who: "hippos", summary: "Broken",
        detail: "Strength", updatedAt: Date.now(), state: { lifts: [{ name: 1 }] },
      }],
      open: { meal: null, session: "broken" },
    }));
  });
  await page.reload();
  await tab(page, "Session");
  await expect(page.getByText("A draft could not be opened, so it was removed.")).toBeVisible();
  await page.getByRole("button", { name: "Start afresh" }).click();
  await expect(page.getByRole("group", { name: "Session presets" })).toBeVisible();
  expect(await kept(page)).toBe(0);
  // The rest of the app never went anywhere.
  await tab(page, "Today");
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
});
