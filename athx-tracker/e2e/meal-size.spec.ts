import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PASSPHRASE } from "../playwright.config.ts";

type SavedMeal = {
  kind: "meal"; athlete: string; name: string; source: string; assumptions: string;
  macros: { calories: number; protein: number; carbs: number; fat: number; alcohol?: number; fiber?: number };
};

async function meals(page: Page) {
  return page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return (data.records as { kind: string }[]).filter((record) => record.kind === "meal") as SavedMeal[];
  });
}

const loggingFor = (page: Page, name: "Hippos" | "Gators" | "Both") =>
  page.getByRole("group", { name: "Logging for" }).getByRole("button", { name });
const dish = (page: Page, n: number) => page.getByRole("group", { name: `Dish ${n}`, exact: true });
const mealSize = (page: Page) => page.getByLabel("Meal size", { exact: true });
const mealSizeBox = (page: Page) => page.getByLabel("Meal size (%)");

async function noViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
});

test("a whole meal resizes with the bar a dish has, and takes a size typed past it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loggingFor(page, "Hippos").click();
  await page.getByLabel("Meal", { exact: true }).fill("Resized bowl");
  await page.getByLabel("Calories (kcal)").fill("800");
  await page.getByLabel("Protein (g)").fill("40");
  await page.getByLabel("Carbs (g)").fill("80");
  await page.getByLabel("Fiber (g)").fill("6");
  await page.getByLabel("Fat (g)").fill("30");

  // There from the start, at 100% and quiet, sliding from 0 to 200.
  const card = page.getByRole("region", { name: "Meal figures" });
  await expect(mealSizeBox(page)).toHaveValue("100");
  await expect(mealSize(page)).toHaveAttribute("min", "0");
  await expect(mealSize(page)).toHaveAttribute("max", "200");
  await expect(card).not.toContainText("of 800 kcal");

  await mealSize(page).fill("50");
  await expect(mealSizeBox(page)).toHaveValue("50");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("400");
  await expect(page.getByLabel("Protein (g)")).toHaveValue("20");
  await expect(page.getByLabel("Carbs (g)")).toHaveValue("40");
  await expect(page.getByLabel("Fiber (g)")).toHaveValue("3");
  await expect(page.getByLabel("Fat (g)")).toHaveValue("15");
  await expect(card).toContainText("of 800 kcal");

  // The left end is the smallest size there is, and the right end 200%.
  await mealSize(page).fill("0");
  await expect(mealSizeBox(page)).toHaveValue("1");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("8");
  await mealSize(page).fill("200");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("1600");

  // Typed past the slider's end, the figures follow and the slider stays at its end.
  await mealSizeBox(page).fill("350");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("2800");
  await expect(page.getByLabel("Protein (g)")).toHaveValue("140");
  await expect(mealSize(page)).toHaveValue("200");

  // A figure typed at a size is that figure at the size shown.
  await page.getByLabel("Calories (kcal)").fill("3500");
  await mealSizeBox(page).fill("50");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("500");
  await expect(page.getByLabel("Protein (g)")).toHaveValue("20");
  await expect(card).toContainText("of 1000 kcal");

  await noViolations(page);
  await card.screenshot({ path: "test-results/meal-size-mobile.png" });

  // The size outlives a reload.
  await page.reload();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await expect(mealSizeBox(page)).toHaveValue("50");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("500");
  await expect(page.getByRole("region", { name: "Meal figures" })).toContainText("of 1000 kcal");

  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page)).filter((meal) => meal.name === "Resized bowl").map(({ macros, assumptions }) => ({ macros, assumptions })),
  ).toEqual([{
    macros: { calories: 500, protein: 20, carbs: 40, fat: 15, alcohol: 0, fiber: 3 },
    assumptions: "Scaled to 50% of 1000 kcal.",
  }]);
});

test("a split meal resizes every dish together, each keeping its size against the rest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loggingFor(page, "Both").click();
  await page.getByRole("button", { name: "Split by dish" }).click();
  await dish(page, 1).getByLabel("Dish", { exact: true }).fill("Chicken curry");
  await dish(page, 1).getByLabel("Calories (kcal)").fill("800");
  await dish(page, 1).getByLabel("Protein (g)").fill("40");
  await page.getByRole("button", { name: "Add dish" }).click();
  await dish(page, 2).getByLabel("Dish", { exact: true }).fill("Garlic naan");
  await dish(page, 2).getByLabel("Calories (kcal)").fill("200");
  await dish(page, 2).getByLabel("Protein (g)").fill("6");

  await expect(mealSizeBox(page)).toHaveValue("100");
  await mealSizeBox(page).fill("50");
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("400");
  await expect(dish(page, 2).getByLabel("Calories (kcal)")).toHaveValue("100");
  await expect(dish(page, 1).getByLabel("Size (%)")).toHaveValue("50");
  await expect(dish(page, 2).getByLabel("Size (%)")).toHaveValue("50");
  await expect(page.getByRole("status", { name: "Shares" })).toContainText("Hippos · 250 kcal");

  // A dish resized on its own moves the meal's size, weighed by calories.
  await dish(page, 2).getByLabel("Size (%)").fill("100");
  await expect(mealSizeBox(page)).toHaveValue("60");
  await mealSize(page).fill("30");
  await expect(dish(page, 1).getByLabel("Size (%)")).toHaveValue("25");
  await expect(dish(page, 2).getByLabel("Size (%)")).toHaveValue("50");
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("200");
  await expect(dish(page, 2).getByLabel("Calories (kcal)")).toHaveValue("100");

  await noViolations(page);
  await page.getByRole("status", { name: "Shares" }).locator("xpath=ancestor::section[1]")
    .screenshot({ path: "test-results/meal-size-split-mobile.png" });

  await mealSizeBox(page).fill("60");
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("400");
  await expect(dish(page, 2).getByLabel("Calories (kcal)")).toHaveValue("200");

  await page.getByLabel("Meal", { exact: true }).fill("Resized curry night");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meals saved for Hippos and Gators", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page))
      .filter((meal) => meal.name === "Resized curry night")
      .map(({ athlete, macros }) => [athlete, macros.calories])
      .sort(),
  ).toEqual([["gators", 300], ["hippos", 300]]);
});

test("a meal opened up into its items resizes each item, and an estimate puts it back at 100%", async ({ page }) => {
  const bowl = {
    name: "Chicken rice bowl", calories: 648, protein: 64, carbs: 57, fat: 16, fiber: 1, alcohol: 0, confidence: "medium",
    assumptions: [
      "Chicken breast, 150 g cooked [248 kcal, 47P, 0C, 5F]",
      "",
      "White rice, 200 g [260 kcal, 5P, 56C, 1F, 1 fiber]",
      "",
      "2 large eggs [140 kcal, 12P, 1C, 10F]",
    ].join("\n"),
  };
  await page.route("**/api/estimate", (route) => route.fulfill({ json: { estimate: bowl, provider: "codex" } }));
  await loggingFor(page, "Hippos").click();
  await page.getByLabel("Meal description").fill("Chicken, rice and 2 eggs");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  const card = page.getByRole("region", { name: "Meal figures" });
  await expect(card.getByLabel("Calories (kcal)")).toHaveValue("648");
  await page.getByRole("button", { name: "Expand into 3 items" }).click();
  const item = (n: number) => page.getByRole("group", { name: `Item ${n}`, exact: true });

  // A weighed item by its grams, and one with no weight by its own size.
  await mealSizeBox(page).fill("50");
  await expect(item(1).getByLabel("Grams")).toHaveValue("75");
  await expect(item(1).getByLabel("Calories (kcal)")).toHaveValue("124");
  await expect(item(2).getByLabel("Grams")).toHaveValue("100");
  await expect(item(2).getByLabel("Calories (kcal)")).toHaveValue("130");
  await expect(item(3).getByLabel("2 large eggs size (%)")).toHaveValue("50");
  await expect(item(3).getByLabel("Calories (kcal)")).toHaveValue("70");
  await expect(card.getByLabel("Calories (kcal)")).toHaveValue("324");
  await expect(card.getByLabel("Protein (g)")).toHaveValue("32");
  await expect(card).toContainText("of 648 kcal");

  // Back to one meal, it keeps its size and what 100% was.
  await page.getByRole("button", { name: "Collapse into one meal" }).click();
  await expect(card.getByLabel("Calories (kcal)")).toHaveValue("324");
  await expect(mealSizeBox(page)).toHaveValue("50");
  await expect(card).toContainText("of 648 kcal");
  await mealSizeBox(page).fill("100");
  await expect(card.getByLabel("Calories (kcal)")).toHaveValue("648");
  await expect(card.getByLabel("Protein (g)")).toHaveValue("64");

  // An estimate's figures are the meal at 100%.
  await mealSizeBox(page).fill("150");
  await expect(card.getByLabel("Calories (kcal)")).toHaveValue("972");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(card.getByLabel("Calories (kcal)")).toHaveValue("648");
  await expect(mealSizeBox(page)).toHaveValue("100");
  await expect(card).not.toContainText("of 648 kcal");
});
