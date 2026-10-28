import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
}

test("tapping a Today box folds it to one line and back", async ({ page }) => {
  await signIn(page);
  const sessions = page.locator("section").filter({ has: page.getByRole("heading", { name: "Sessions" }) });
  await expect(sessions.getByRole("table")).toBeVisible();

  await sessions.getByRole("columnheader", { name: "This week" }).click();
  await expect(sessions.getByRole("table")).toHaveCount(0);
  await expect(sessions.getByText(/^This week: Hippos \d+\/\d+ · Gators/)).toBeVisible();
  await expect(sessions.getByRole("button", { name: "Expand Sessions" })).toHaveAttribute("aria-expanded", "false");

  await sessions.click();
  await expect(sessions.getByRole("table")).toBeVisible();

  // The corner button works without a pointer.
  await sessions.getByRole("button", { name: "Collapse Sessions" }).press("Enter");
  await expect(sessions.getByRole("table")).toHaveCount(0);
});

test("a control inside a box does its job without folding it", async ({ page }) => {
  await signIn(page);
  const fuel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Fuel" }) });
  await fuel.getByRole("button", { name: "Fuel for yesterday" }).click();
  await expect(page.getByText("Yesterday, against the daily target.")).toBeVisible();
  await expect(fuel.getByRole("button", { name: "Collapse Fuel" })).toBeVisible();

  await page.getByText("How these are worked out").click();
  await expect(page.getByText(/Strength is the 2027 pairs score/)).toBeVisible();
});

test("the countdown box folds to the days left", async ({ page }) => {
  await signIn(page);
  await page.getByRole("heading", { name: "Race-day estimate" }).click();
  await expect(page.getByRole("heading", { name: "Race-day estimate" })).toHaveCount(0);
  await expect(page.getByText(/^\d+ days? to go$/)).toBeVisible();
});
