import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// One sign-in's end. The phone's clock moves towards it; the end stays put.
const END = Date.parse("2026-12-01T15:00:00.000Z");

/** The estimator reports a sign-in ending at end, and the phone's clock reads left before it. */
async function endsIn(page: Page, left: number | null, end = END) {
  if (left !== null) await page.clock.setFixedTime(end - left);
  const expiresAt = left === null ? null : new Date(end).toISOString();
  await page.unroute("**/api/estimator-login");
  await page.route("**/api/estimator-login", (route) => route.fulfill({ json: { claudeLoginExpiresAt: expiresAt } }));
}

const alert = (page: Page) => page.getByRole("dialog");

/** Reload and wait for the app to have heard, and to have had time to show anything. */
async function reloadAndAsk(page: Page) {
  const asked = page.waitForResponse("**/api/estimator-login");
  await page.reload();
  await asked;
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("athx.claude-login-warning"));
});

test("each warning before the Claude sign-in ends pops up once and goes with one click", async ({ page }) => {
  // Further out than the first warning: nothing.
  await endsIn(page, 9 * DAY);
  await reloadAndAsk(page);
  await expect(alert(page)).toHaveCount(0);

  // Inside seven days: the first warning, with the fix.
  await endsIn(page, 5 * DAY);
  await page.reload();
  await expect(alert(page).getByRole("heading")).toHaveText("Claude's sign-in ends in 5 days");
  await expect(alert(page)).toContainText("docker exec -it athx-estimator claude auth login");
  await alert(page).getByRole("button", { name: "Got it" }).click();
  await expect(alert(page)).toHaveCount(0);

  // Sent away stays away on this phone until the next warning is due.
  await reloadAndAsk(page);
  await expect(alert(page)).toHaveCount(0);

  await endsIn(page, 20 * HOUR);
  await page.reload();
  await expect(alert(page).getByRole("heading")).toHaveText("Claude's sign-in ends in 20 hours");
  // The close button is one click too.
  await alert(page).getByRole("button", { name: "Close" }).click();
  await expect(alert(page)).toHaveCount(0);

  // The last warning, then nothing more once it is sent away, even past the end.
  await endsIn(page, 6 * HOUR);
  await page.reload();
  await expect(alert(page).getByRole("heading")).toHaveText("Claude's sign-in ends in 6 hours");
  await page.keyboard.press("Escape");
  await expect(alert(page)).toHaveCount(0);
  await endsIn(page, -HOUR);
  await reloadAndAsk(page);
  await expect(alert(page)).toHaveCount(0);
});

test("a new sign-in starts its warnings afresh, and an unknown end shows none", async ({ page }) => {
  await endsIn(page, 2 * DAY);
  await page.reload();
  await expect(alert(page).getByRole("heading")).toHaveText("Claude's sign-in ends in 2 days");
  await alert(page).getByRole("button", { name: "Got it" }).click();

  await endsIn(page, -2 * HOUR);
  await page.reload();
  await expect(alert(page).getByRole("heading")).toHaveText("Claude's sign-in may have ended");
  await alert(page).getByRole("button", { name: "Got it" }).click();

  // Signed in again: a new end, a month out, and its own first warning later.
  const renewed = END + 30 * DAY;
  await endsIn(page, 28 * DAY, renewed);
  await reloadAndAsk(page);
  await expect(alert(page)).toHaveCount(0);
  await endsIn(page, 6 * DAY, renewed);
  await page.reload();
  await expect(alert(page).getByRole("heading")).toHaveText("Claude's sign-in ends in 6 days");
  await alert(page).getByRole("button", { name: "Got it" }).click();

  // A token login, or an estimator that does not say: no popup at all.
  await endsIn(page, null);
  await reloadAndAsk(page);
  await expect(alert(page)).toHaveCount(0);
});
