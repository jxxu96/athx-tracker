import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

// A gym with no signal. The app has to open, and what is logged has to wait
// on the phone and send itself, rather than fail or be lost.

test.use({ serviceWorkers: "allow" });

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
}

async function clear(page: Page) {
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

async function session(page: Page, title: string) {
  await page.evaluate(async (title) => {
    const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const response = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(), kind: "workout", athlete: "gators", day, title,
        category: "Tennis", customCategory: "", seconds: 3600, notes: "", segments: [],
        fatigue: 0, transition: 0, goal: null, context: "solo", lifts: [],
      }),
    });
    if (!response.ok) throw new Error(await response.text());
  }, title);
}

/** Whether the worker holds a copy of the journal page yet. */
const kept = (page: Page) =>
  page.evaluate(async () => {
    for (const key of await caches.keys()) {
      if (await (await caches.open(key)).match("/")) return true;
    }
    return false;
  });

test.afterEach(async ({ page, context }) => {
  await context.setOffline(false);
  await clear(page);
});

test("the journal opens without a connection, and a meal saved there sends itself later", async ({ page, context }) => {
  await signIn(page);
  await clear(page);
  await session(page, "Kept for offline");
  await page.reload();
  await expect.poll(() => kept(page), { timeout: 15_000 }).toBe(true);
  // The worker keeps each page as it loads, so this load is the copy.
  await page.reload();
  await expect(page.getByText("Kept for offline")).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Logged on the other phone after this one went out of signal.
  await session(page, "Logged elsewhere");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Kept for offline")).toBeVisible();
  await expect(page.getByText("Logged elsewhere")).toHaveCount(0);

  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Meal", exact: true }).click();
  await page.getByLabel("Meal", { exact: true }).fill("Offline oats");
  await page.getByLabel("Calories (kcal)").fill("400");
  await page.getByLabel("Protein (g)").fill("20");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Saved on this phone")).toBeVisible();
  await expect(page.getByRole("button", { name: "1 waiting to send. Send now" })).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("A waiting entry was sent")).toBeVisible();
  await expect(page.getByRole("button", { name: /waiting to send/ })).toHaveCount(0);
  const names = await page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return (data.records as { name?: string; title?: string }[]).map((record) => record.name ?? record.title).sort();
  });
  expect(names).toEqual(["Kept for offline", "Logged elsewhere", "Offline oats"]);
});

test("signing out leaves no copy of the journal behind", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect.poll(() => kept(page), { timeout: 15_000 }).toBe(true);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Setup", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Passphrase")).toBeVisible();
  await expect.poll(() => kept(page)).toBe(false);
  // Signed back in for the cleanup.
  await signIn(page);
});
