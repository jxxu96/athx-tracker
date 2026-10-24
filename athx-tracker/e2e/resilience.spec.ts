import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

// A phone in a gym loses signal mid-save. What must not happen is losing the
// entry, or quietly writing it twice when you try again.

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
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
  await page.reload();
}

const count = (page: Page) =>
  page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return data.total as number;
  });

test("a save that half fails does not duplicate on the retry", async ({ page }) => {
  await signIn(page);
  await page.getByRole("group", { name: "Logging for" })
    .getByRole("button", { name: "Both" }).click();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page.getByRole("button", { name: "Tennis 60m" }).click();

  // The second athlete's save fails, the first having already landed.
  let posts = 0;
  await page.route("**/api/records", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      if (posts === 2) return route.abort("internetdisconnected");
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save session" }).click();
  await expect.poll(() => count(page)).toBe(1);

  // Signal returns and you press save again, with the form still filled in.
  await page.unroute("**/api/records");
  await page.getByRole("button", { name: "Save session" }).click();
  // Wait for the submit to finish before counting. Polling for a number the
  // total passes through on its way somewhere worse proves nothing: a retry
  // that duplicates reads 2 for a moment before it reads 3.
  await expect(page.getByText("Sessions saved")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await count(page)).toBe(2);
});

// The day an entry belongs to is the day the person is having, not the day in
// New York. These run the browser in zones far from the server's.
for (const timezoneId of ["Pacific/Kiritimati", "Pacific/Niue"]) {
  test.describe(`in ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("the session date is the device's day", async ({ page }) => {
      await signIn(page);
      const onDevice = await page.evaluate(() =>
        new Intl.DateTimeFormat("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
      );
      await page.getByRole("button", { name: "Session", exact: true }).click();
      await expect(
        page.getByRole("group", { name: "Date" }).getByRole("button", { name: "Today", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      // Today has to be this phone's day. A zone ahead of the server used to
      // file the session on the server's date instead.
      await page.getByRole("button", { name: "Tennis 60m" }).click();
      await page.getByRole("button", { name: "Save session" }).click();
      await expect(page.getByText("Sessions saved")).toBeVisible();
      await expect.poll(async () =>
        page.evaluate(async () => {
          const data = await fetch("/api/records").then((r) => r.json());
          return (data.records as { day: string }[]).map((record) => record.day).sort();
        }),
      ).toEqual([onDevice, onDevice]);
    });
  });
}

test("the estimator test says why a provider failed", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Setup", exact: true }).click();

  // Reachable, but both CLIs fall over — which is the only way this has ever
  // failed, and the reason used to live in a log on the server.
  await page.route("**/api/estimate", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ready", detail: "estimator reachable" }),
      });
    }
    return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "No estimator could answer — claude: exit 1 not logged in",
      }),
    });
  });

  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText(/claude: exit 1 not logged in/)).toBeVisible();
});

test("the estimator test confirms a working one", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  await page.route("**/api/estimate", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ready", detail: "reachable" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ estimate: { calories: 105 } }),
    });
  });
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText(/Working\. A test banana came back as 105 kcal\./)).toBeVisible();
});

test("the log draws a windowful, however much is loaded", async ({ page }) => {
  await signIn(page);
  // Each entry is around twenty elements. Drawing a whole journal at once is
  // tens of thousands of them, which is how a phone stops responding.
  await page.evaluate(async () => {
    for (let i = 0; i < 120; i += 1) {
      await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          kind: "meal",
          athlete: i % 2 ? "gators" : "hippos",
          day: new Date(Date.now() - i * 43200000).toISOString().slice(0, 10),
          name: `Seeded meal ${i}`,
          meal: "Lunch",
          macros: { calories: 455, protein: 30, carbs: 50, fat: 15 },
          source: "manual",
          assumptions: "",
        }),
      });
    }
  });
  await page.reload();

  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText("120 entries")).toBeVisible();
  await expect(page.getByText("Showing 100 of 120.")).toBeVisible();
  expect(await page.getByLabel("Delete entry").count()).toBe(100);

  await page.getByRole("button", { name: "Show more" }).click();
  expect(await page.getByLabel("Delete entry").count()).toBe(120);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
});

test("an oversized request is refused before it is read", async ({ page }) => {
  await signIn(page);
  // The cap exists so a huge body is not pulled into memory before anyone
  // decides it is too big. No valid entry comes near it, so without its own
  // answer the schema would refuse the same thing and the cap could vanish
  // unnoticed.
  const statuses = await page.evaluate(async () => {
    const huge = "x".repeat(300_000);
    const send = (path: string, body: unknown) =>
      fetch(path, {
        method: path.includes("settings") ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.status);
    return {
      records: await send("/api/records", { id: "x", notes: huge }),
      settings: await send("/api/settings", { settings: { huge }, revision: 0 }),
      estimate: await send("/api/estimate", { description: huge }),
    };
  });
  expect(statuses.records).toBe(413);
  expect(statuses.settings).toBe(413);
  expect(statuses.estimate).toBe(413);
});

test("a body within the cap is judged on its contents", async ({ page }) => {
  await signIn(page);
  // The cap must not become the answer to everything: something small and
  // wrong is still a 400.
  const status = await page.evaluate(() =>
    fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "not-a-uuid", kind: "meal" }),
    }).then((r) => r.status),
  );
  expect(status).toBe(400);
});
