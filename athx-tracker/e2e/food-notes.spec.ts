import { expect, test } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

test("food notes typed in Setup are kept after a reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  const openSetup = () =>
    page.getByRole("navigation", { name: "Sections" })
      .getByRole("button", { name: "Setup", exact: true })
      .click();

  await openSetup();
  const notes = "Yogurt means Fage Total 0% plain, 170 g cup";
  await page.getByLabel("Notes").fill(notes);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("button", { name: "Save settings" })).toBeEnabled();

  await page.reload();
  await openSetup();
  await expect(page.getByLabel("Notes")).toHaveValue(notes);
});
