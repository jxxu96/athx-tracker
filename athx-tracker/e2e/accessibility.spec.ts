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

  test("Energy, once logged and while logging another, is usable without sight in both themes", async ({ page }) => {
    // Lunchtime, with Hippos logged at every timing and Gators at breakfast
    // only: Hippos' row keeps a level and offers Log another, Gators' is
    // empty, and the timings carry filled and hollow dots.
    const date = new Date();
    date.setHours(12, 30, 0, 0);
    await page.clock.setFixedTime(date);
    const ids = await page.evaluate(async () => {
      const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const made: string[] = [];
      for (const [athlete, timing, level] of [
        ["hippos", "Breakfast", 7], ["hippos", "Lunch", 6], ["hippos", "Dinner", 5], ["gators", "Breakfast", 6],
      ] as const) {
        const id = crypto.randomUUID();
        const response = await fetch("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, kind: "energy", athlete, day, timing, level }),
        });
        if (!response.ok) throw new Error(await response.text());
        made.push(id);
      }
      return made;
    });
    try {
      for (const theme of ["Light", "Dark"]) {
        await page.getByRole("button", { name: "Setup", exact: true }).click();
        await page.getByRole("button", { name: theme, exact: true }).click();
        await page.getByRole("button", { name: "Today", exact: true }).click();
        await page.reload();
        const another = page.getByRole("button", { name: "Log another for Hippos at lunch today" });
        await expect(another).toBeVisible();
        await audit(page, `${theme} theme, Energy logged`);
        await another.click();
        await expect(page.getByText("Tap a level to log another")).toBeVisible();
        await audit(page, `${theme} theme, Energy logging another`);
      }
    } finally {
      await page.evaluate(async (ids) => {
        for (const id of ids)
          await fetch("/api/records", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
      }, ids);
    }
  });

  test("both themes carry enough contrast", async ({ page }) => {
    // The theme is chosen in Setup now, and Today is audited in each.
    for (const theme of ["Light", "Dark"]) {
      await page.getByRole("button", { name: "Setup", exact: true }).click();
      await page.getByRole("button", { name: theme, exact: true }).click();
      await audit(page, `${theme} theme, Setup`);
      await page.getByRole("button", { name: "Today", exact: true }).click();
      await audit(page, `${theme} theme, Today`);
    }
  });
});
