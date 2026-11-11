import { expect, test } from "@playwright/test";
import { FAVICON_EVERY_MS } from "../components/favicon-flip.tsx";

// The tab icon takes turns: the hippo, then the gator, then the hippo again.

test("the tab icon swaps between the hippo and the gator every five seconds", async ({ page, request }) => {
  const gator = await request.get("/favicon-gator.svg");
  expect(gator.ok()).toBe(true);
  expect(gator.headers()["content-type"]).toContain("image/svg+xml");

  await page.clock.install();
  // The sign-in page has the same layout, so no passphrase is needed to see it.
  await page.goto("/login");
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute("href", "/favicon.svg");

  await page.clock.runFor(FAVICON_EVERY_MS);
  await expect(icon).toHaveAttribute("href", "/favicon-gator.svg");

  await page.clock.runFor(FAVICON_EVERY_MS);
  await expect(icon).toHaveAttribute("href", "/favicon.svg");
});
