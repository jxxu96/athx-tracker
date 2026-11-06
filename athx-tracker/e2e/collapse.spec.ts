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
  await expect(fuel.getByRole("button", { name: "Fuel for yesterday" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(fuel.getByRole("button", { name: "Collapse Fuel" })).toBeVisible();
});

test("the days to go are a chip in the header, read out in full", async ({ page }) => {
  await signIn(page);
  const header = page.locator("header");
  await expect(header.getByText(/^\d+ d$/)).toBeVisible();
  await expect(header.getByText(/^\d+ days? to ATHX New York, /)).toBeAttached();
  // Today no longer spends a box on it, so Fuel leads.
  await expect(page.getByRole("button", { name: /^(Expand|Collapse) ATHX New York$/ })).toHaveCount(0);
  await expect(page.locator("main section").first().getByRole("heading", { name: "Fuel" })).toBeVisible();
});

test("the race box folds to where each zone stands", async ({ page }) => {
  await signIn(page);
  await page.getByRole("heading", { name: "Race-day estimate" }).click();
  await expect(page.getByRole("heading", { name: "Race-day estimate" })).toHaveCount(0);
  await expect(page.getByText(/^Race-day estimate: Strength .* · Endurance .* · MetCon X /)).toBeVisible();
});
