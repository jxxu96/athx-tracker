import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PASSPHRASE } from "../playwright.config.ts";

const initial = {
  name: "Chicken and rice", calories: 600, protein: 40, carbs: 65, fat: 20,
  assumptions: "200 g cooked rice and one tablespoon of oil.", confidence: "medium",
};
const revised = {
  ...initial, calories: 500, protein: 40, carbs: 40, fat: 20,
  assumptions: "150 g cooked rice; one tablespoon of oil.",
};
const final = {
  ...initial, calories: 410, protein: 40, carbs: 40, fat: 10,
  assumptions: "150 g cooked rice and no added oil. Fat comes from the chicken.",
};
type EstimateRequest = {
  description: string;
  refinement?: { previous: typeof initial; replies: string[] };
};

async function openMeal(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await page.getByLabel("Meal description").fill("Chicken and rice");
}

async function firstEstimate(page: Page) {
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("600");
  await page.getByRole("button", { name: "Reply to estimate" }).click();
}

test("replying twice carries corrections forward and saves the revised meal", async ({ page }) => {
  const requests: EstimateRequest[] = [];
  await page.route("**/api/estimate", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { estimate: [initial, revised, final][requests.length - 1] } });
  });
  await openMeal(page);
  await firstEstimate(page);
  const dialog = page.getByRole("dialog", { name: "Refine estimate" });
  await expect(dialog.getByText(initial.assumptions)).toBeVisible();
  await page.getByLabel("Your reply").fill("It was 150 g cooked rice.");
  await dialog.getByRole("button", { name: "Send & re-estimate" }).click();
  await expect(dialog.getByText(revised.assumptions)).toBeVisible();
  await page.getByLabel("Your reply").fill("No oil. Why is there still fat?");
  await dialog.getByRole("button", { name: "Send & re-estimate" }).click();
  await expect(dialog.getByText(final.assumptions)).toBeVisible();
  expect(requests[0]).toEqual({ description: "Chicken and rice" });
  expect(requests[2].refinement?.replies).toEqual([
    "It was 150 g cooked rice.", "No oil. Why is there still fat?",
  ]);
  expect(requests[2].refinement?.previous.assumptions).toBe(revised.assumptions);
  await dialog.getByRole("button", { name: "Back to meal" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("410");
  await expect(page.getByLabel("Assumptions")).toHaveValue(final.assumptions);
  const assumptionsBox = await page.getByLabel("Assumptions").boundingBox();
  const mealBox = await page.getByLabel("Meal", { exact: true }).boundingBox();
  expect(assumptionsBox!.y).toBeLessThan(mealBox!.y);
  const saved = page.waitForRequest((request) => request.url().endsWith("/api/records") && request.method() === "POST");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  const record = (await saved).postDataJSON();
  expect(record.macros.calories).toBe(410);
  expect(record.assumptions).toBe(final.assumptions);
  await expect(page.getByText(/^Meals? saved/)).toBeVisible();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await expect(page.getByLabel("Meal description")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Reply to estimate" })).toHaveCount(0);
});

test("a failed reply preserves the draft, supports retry, and does not offer a zero-macro queue", async ({ page }) => {
  let calls = 0;
  let finish: (() => void) | undefined;
  await page.route("**/api/estimate", async (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill({ json: { estimate: initial } });
    if (calls === 2) {
      await new Promise<void>((resolve) => { finish = resolve; });
      return route.fulfill({ status: 502, json: { error: "Estimator unavailable." } });
    }
    return route.fulfill({ json: { estimate: final } });
  });
  await openMeal(page);
  await firstEstimate(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Send & re-estimate" })).toBeDisabled();
  await page.getByLabel("Your reply").fill("No oil");
  await dialog.getByRole("button", { name: "Send & re-estimate" }).click();
  await expect(dialog.getByRole("button", { name: "Re-estimating…", exact: true })).toBeDisabled();
  await expect(page.locator('button[type="submit"]')).toBeDisabled();
  await expect.poll(() => Boolean(finish)).toBe(true);
  finish!();
  await expect(dialog.getByRole("alert")).toContainText("Your current estimate and reply have been kept");
  await expect(page.getByLabel("Your reply")).toHaveValue("No oil");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("600");
  await expect(page.getByRole("button", { name: "Save and estimate in background", includeHidden: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Send & re-estimate" }).click();
  await expect(dialog.getByText(final.assumptions)).toBeVisible();
  await expect(page.getByLabel("Your reply")).toHaveValue("");
});

test("starting a fresh estimate clears the earlier conversation", async ({ page }) => {
  const requests: EstimateRequest[] = [];
  await page.route("**/api/estimate", async (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { estimate: requests.length < 3 ? initial : final } });
  });
  await openMeal(page);
  await firstEstimate(page);
  await page.getByLabel("Your reply").fill("No oil");
  await page.getByRole("button", { name: "Send & re-estimate" }).click();
  await expect(page.getByLabel("Your reply")).toHaveValue("");
  await page.getByRole("button", { name: "Back to meal" }).click();
  await page.getByLabel("Meal description").fill("A different meal");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("410");
  expect(requests[2]).toEqual({ description: "A different meal" });
  await page.getByRole("button", { name: "Reply to estimate" }).click();
  await expect(page.getByRole("log").getByText("No oil", { exact: true })).toHaveCount(0);
});

test("a saved meal reopens with its figures as the estimate to reply to", async ({ page }) => {
  const requests: EstimateRequest[] = [];
  await page.route("**/api/estimate", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { estimate: final, provider: "claude" } });
  });
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  const id = await page.evaluate(async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const meal = {
      id: crypto.randomUUID(), kind: "meal", athlete: "gators", day: today,
      name: "Saved chicken rice", meal: "Dinner", source: "manual", assumptions: "",
      macros: { calories: 600, protein: 40, carbs: 65, fat: 20 },
    };
    await fetch("/api/records", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meal),
    });
    return meal.id;
  });
  await page.reload();
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: "Saved chicken rice" }).getByLabel("Edit entry").click();
  await expect(page.getByLabel("Meal description")).toHaveValue("Saved chicken rice");
  await page.getByRole("button", { name: "Reply to estimate" }).click();
  const dialog = page.getByRole("dialog", { name: "Refine estimate" });
  await page.getByLabel("Your reply").fill("No oil");
  await dialog.getByRole("button", { name: "Send & re-estimate" }).click();
  await expect(dialog.getByText(final.assumptions)).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].description).toBe("Saved chicken rice");
  expect(requests[0].refinement?.previous).toMatchObject({
    name: "Saved chicken rice", calories: 600, protein: 40, carbs: 65, fat: 20,
  });
  expect(requests[0].refinement?.replies).toEqual(["No oil"]);
  await dialog.getByRole("button", { name: "Back to meal" }).click();
  await page.getByRole("button", { name: "Update meal" }).click();
  await expect.poll(() => page.evaluate(async (wanted) => {
    const { records } = await fetch("/api/records").then((r) => r.json());
    const saved = (records as { id: string; macros: { calories: number }; source: string; estimator?: string }[])
      .filter((record) => record.id === wanted);
    return saved.map((record) => ({ calories: record.macros.calories, source: record.source, estimator: record.estimator }));
  }, id)).toEqual([{ calories: 410, source: "grok", estimator: "claude" }]);
});

test("the reply dialog fits a phone and remains accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/estimate", (route) => route.fulfill({ json: { estimate: initial } }));
  await openMeal(page);
  await firstEstimate(page);
  await page.waitForTimeout(500);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "test-results/meal-refinement-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reply to estimate" })).toBeFocused();
});
