import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

// The unlabelled form fields were found by accident, when a selector could not
// reach them for the same reason a screen reader could not announce them. This
// checks the whole class rather than waiting to trip over the next one.

const TABS = ["Today", "Session", "Meal", "Progress", "Log", "Setup"] as const;

async function audit(page: Page, context: string) {
  // These controls animate their colours, and a colour read halfway through a
  // transition is not a colour anyone sees. Let them land first, or the audit
  // reports contrast failures against values that existed for 150ms.
  await page.waitForTimeout(500);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const described = violations.map(
    (v) => `${context}: ${v.id} (${v.impact}) — ${v.help} [${v.nodes.length}]`,
  );
  expect(described, described.join("\n")).toEqual([]);
}

test("the sign-in page is usable without sight", async ({ page }) => {
  await page.goto("/login");
  await audit(page, "login");
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Open journal" }).click();
    await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  });

  for (const tab of TABS) {
    test(`the ${tab} tab is usable without sight`, async ({ page }) => {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await audit(page, tab);
    });
  }

  test("both themes carry enough contrast", async ({ page }) => {
    for (const theme of ["Light", "Dark"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      await audit(page, `${theme} theme`);
    }
  });
});
