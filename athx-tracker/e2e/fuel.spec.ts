import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session" })).toBeVisible();
}

test("fuel switches today, yesterday, the last week, and overall", async ({ page }) => {
  await signIn(page);
  const fuel = page.getByRole("group", { name: "Fuel range" });
  await expect(fuel.getByRole("button", { name: "Fuel for today" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Today, against the daily target.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fuel" })).toBeVisible();
  await expect(page.getByText("Expenditure", { exact: true })).toBeVisible();

  await fuel.getByRole("button", { name: "Fuel for yesterday" }).click();
  await expect(page.getByText("Yesterday, against the daily target.")).toBeVisible();

  await fuel.getByRole("button", { name: "Fuel for the last 7 days" }).click();
  await expect(page.getByText(/Daily average of days with a meal/)).toBeVisible();

  await fuel.getByRole("button", { name: "Fuel overall" }).click();
  await expect(
    page.getByText(/Daily average across every day with a meal/),
  ).toBeVisible();

  // The section tab stays the only control named exactly Today.
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveCount(1);
});
