import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PASSPHRASE } from "../playwright.config.ts";

async function meals(page: Page) {
  return page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return data.records as { id: string; name: string; source: string; macros: {
      calories: number; protein: number; carbs: number; fat: number;
    } }[];
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
});

test("a mismatched meal must be corrected before it is saved or updated", async ({ page }) => {
  await expect(page.getByText(/From macros:/)).toHaveCount(0);
  await page.getByLabel("Meal", { exact: true }).fill("Calorie check bowl");
  await page.getByLabel("Calories (kcal)").fill("900");
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByLabel("Carbs (g)").fill("50");
  await page.getByLabel("Fat (g)").fill("15");
  await expect(page.getByRole("status").filter({ hasText: "From macros:" })).toContainText("From macros: 455 kcal");
  await expect(page.getByText("Protein 120 + carbs 200 + fat 135 kcal")).toBeVisible();
  await expect(page.getByText(/Total is 445 kcal above/)).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations).toEqual([]);
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Calories must be within 10 kcal");
  expect((await meals(page)).some((meal) => meal.name === "Calorie check bowl")).toBe(false);

  await page.getByRole("button", { name: "Use macro total" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("455");
  await expect(page.getByText("Calories match.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(async () => (await meals(page)).find((meal) => meal.name === "Calorie check bowl")?.macros.calories).toBe(455);

  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByText("Calorie check bowl", { exact: true }).locator("..").locator("..").getByLabel("Edit entry").click();
  await page.getByLabel("Protein (g)").fill("40");
  await expect(page.getByText(/Total is 40 kcal below/)).toBeVisible();
  await page.getByRole("button", { name: "Update meal" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("495 kcal");
  await page.getByRole("button", { name: "Use macro total" }).click();
  await page.getByRole("button", { name: "Update meal" }).click();
  await expect.poll(async () => (await meals(page)).find((meal) => meal.name === "Calorie check bowl")?.macros.calories).toBe(495);
});

test("a small rounding difference can be saved and invalid input has no misleading total", async ({ page }) => {
  await page.getByLabel("Meal", { exact: true }).fill("Rounded meal");
  await page.getByLabel("Calories (kcal)").fill("460");
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByLabel("Carbs (g)").fill("50");
  await page.getByLabel("Fat (g)").fill("nope");
  await expect(page.getByText(/From macros:/)).toHaveCount(0);
  await page.getByLabel("Fat (g)").fill("15");
  await expect(page.getByText("Calories match within 10 kcal for rounding.")).toBeVisible();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(async () => (await meals(page)).find((meal) => meal.name === "Rounded meal")?.macros.calories).toBe(460);
});

test("the API refuses a mismatch even when the form is bypassed", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/records", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), kind: "meal", athlete: "gators",
        day: "2026-10-23", name: "Mismatch", meal: "Lunch", source: "manual", assumptions: "",
        macros: { calories: 900, protein: 30, carbs: 50, fat: 15 } }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(result.status).toBe(400);
  expect(result.body.error).toContain("macro total (455 kcal)");
  expect((await meals(page)).some((meal) => meal.name === "Mismatch")).toBe(false);
});

test("editing an estimate rechecks calories and saves the correction as manual", async ({ page }) => {
  await page.route("**/api/estimate", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ estimate: { name: "Estimated bowl", calories: 190,
      protein: 12, carbs: 13, fat: 10, assumptions: "One bowl", confidence: "medium" } }),
  }));
  await page.getByPlaceholder("Two eggs, 80 g oats with milk, banana, flat white").fill("One bowl");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByText("Calories match.", { exact: true })).toBeVisible();
  await page.getByLabel("Fat (g)").fill("20");
  await expect(page.getByText(/Total is 90 kcal below/)).toBeVisible();
  await page.getByRole("button", { name: "Use macro total" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("280");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(async () => {
    const saved = (await meals(page)).find((meal) => meal.name === "Estimated bowl");
    return saved ? { source: saved.source, calories: saved.macros.calories } : null;
  }).toEqual({ source: "manual", calories: 280 });
});
