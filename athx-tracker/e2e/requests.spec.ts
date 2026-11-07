import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
}

const log = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Requests" }) });

test("ideas are logged at the bottom of Today and kept out of the Log", async ({ page }) => {
  await signIn(page);
  const requests = log(page);
  await expect(page.getByRole("heading", { name: "Last session" })).toHaveCount(0);
  await expect(page.locator("main h2").last()).toHaveText("Requests");
  await expect(requests.getByText("Nothing asked for yet.")).toBeVisible();
  await expect(requests.getByRole("button", { name: "Add request" })).toBeDisabled();

  const idea = requests.getByRole("textbox", { name: "Request" });
  await idea.fill("  Show keybinds in Setup  ");
  await requests.getByRole("button", { name: "Add request" }).click();
  await expect(requests.getByText("Show keybinds in Setup", { exact: true })).toBeVisible();
  await expect(idea).toHaveValue("");

  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText("Show keybinds in Setup")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Today", exact: true }).click();
  await page.reload();
  await expect(log(page).getByText("Show keybinds in Setup")).toBeVisible();

  await log(page).getByRole("button", { name: "Mark done: Show keybinds in Setup" }).click();
  await expect(log(page).getByRole("heading", { name: "Done" })).toBeVisible();
  await expect(log(page).getByRole("button", { name: "Reopen: Show keybinds in Setup" })).toBeVisible();

  await log(page).getByRole("button", { name: "Delete: Show keybinds in Setup" }).click();
  await log(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(log(page).getByText("Nothing asked for yet.")).toBeVisible();
  await expect(log(page).getByText("Show keybinds in Setup")).toHaveCount(0);
});
