import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PASSPHRASE } from "../playwright.config.ts";

type SavedMeal = {
  id: string; kind: "meal"; athlete: string; name: string; source: string; assumptions: string;
  macros: { calories: number; protein: number; carbs: number; fat: number; alcohol?: number; fiber?: number };
  items?: { name: string; grams: number; nutrition?: { grams: number; macros: { calories: number } } }[];
};

async function meals(page: Page) {
  return page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return (data.records as { kind: string }[]).filter((record) => record.kind === "meal") as SavedMeal[];
  });
}

const loggingFor = (page: Page, name: "Hippos" | "Gators" | "Both") =>
  page.getByRole("group", { name: "Logging for" }).getByRole("button", { name });
const item = (page: Page, n: number) => page.getByRole("group", { name: `Item ${n}`, exact: true });
const dish = (page: Page, n: number) => page.getByRole("group", { name: `Dish ${n}`, exact: true });
const figures = (page: Page) => page.getByRole("region", { name: "Meal figures" });

/** The estimator's working, item by item, the way it is asked to write it. */
const BOWL = [
  "Chicken breast, 150 g cooked [248 kcal, 47P, 0C, 5F]",
  "USDA reference for grilled breast.",
  "",
  "White rice, 200 g [260 kcal, 5P, 56C, 1F, 1 fiber]",
  "",
  "2 large eggs [140 kcal, 12P, 1C, 10F]",
  "",
  "Assumed no sauce.",
].join("\n");
const bowl = {
  name: "Chicken rice bowl", calories: 648, protein: 64, carbs: 57, fat: 16, fiber: 1, alcohol: 0,
  confidence: "medium", assumptions: BOWL,
};

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
});

test("an estimated meal expands into its items, and changing an item changes the meal", async ({ page }) => {
  await page.route("**/api/estimate", (route) => route.fulfill({ json: { estimate: bowl, provider: "codex" } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await loggingFor(page, "Hippos").click();
  await page.getByLabel("Meal description").fill("Chicken, rice and 2 eggs");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("648");

  await page.getByRole("button", { name: "Expand into 3 items" }).click();
  await expect(item(page, 1).getByLabel("Item", { exact: true })).toHaveValue("Chicken breast");
  await expect(item(page, 1).getByLabel("Grams")).toHaveValue("150");
  await expect(item(page, 1).getByLabel("Calories (kcal)")).toHaveValue("248");
  await expect(item(page, 2).getByLabel("Fiber (g)")).toHaveValue("1");
  // A counted item keeps its count in its name, and has no weight to slide.
  await expect(item(page, 3).getByLabel("Item", { exact: true })).toHaveValue("2 large eggs");
  await expect(item(page, 3).getByLabel("Grams")).toHaveValue("");
  await expect(item(page, 3).getByRole("slider")).toHaveCount(0);
  // Opening it up changes nothing: the items add up to the meal, which is still the estimate's.
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("648");
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveAttribute("readonly", "");
  await expect(page.getByText("Answered by Codex")).toBeVisible();
  await expect(page.getByText(/saved as your own numbers/)).toHaveCount(0);
  await page.locator("form").screenshot({ path: "test-results/meal-items-mobile.png" });

  // A weighed item's figures move with its grams.
  await item(page, 1).getByRole("slider", { name: "Chicken breast weight" }).fill("300");
  await expect(item(page, 1).getByLabel("Grams")).toHaveValue("300");
  await expect(item(page, 1).getByLabel("Calories (kcal)")).toHaveValue("496");
  await expect(item(page, 1).getByLabel("Protein (g)")).toHaveValue("94");
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("896");
  await expect(figures(page).getByLabel("Protein (g)")).toHaveValue("111");
  await expect(page.getByText(/saved as your own numbers after your edit/)).toBeVisible();

  await page.getByRole("button", { name: "Remove 2 large eggs" }).click();
  await expect(item(page, 3)).toHaveCount(0);
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("756");

  await page.getByRole("button", { name: "Add item" }).click();
  await item(page, 3).getByLabel("Item", { exact: true }).fill("Hot sauce");
  await item(page, 3).getByLabel("Calories (kcal)").fill("5");
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("761");

  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .include("form")
    .analyze();
  expect(violations).toEqual([]);

  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true }).first()).toBeVisible();
  const saved = (await meals(page)).find((meal) => meal.name === "Chicken rice bowl");
  expect(saved?.source).toBe("manual");
  expect(saved?.macros).toMatchObject({ calories: 761, protein: 99, carbs: 56, fat: 11, fiber: 1 });
  expect(saved?.items?.map((each) => [each.name, each.grams, each.nutrition?.macros.calories])).toEqual([
    ["Chicken breast", 300, 496],
    ["White rice", 200, 260],
    ["Hot sauce", 0, 5],
  ]);
  // The items as they were changed lead the assumptions, ahead of what the estimate said.
  expect(saved?.assumptions.split("\n\n")[0]).toBe([
    "Adjusted item by item:",
    "Chicken breast, 300 g [496 kcal, 94P, 0C, 10F]",
    "White rice, 200 g [260 kcal, 5P, 56C, 1F, 1 fiber]",
    "Hot sauce [5 kcal, 0P, 0C, 0F]",
  ].join("\n"));
  expect(saved?.assumptions).toContain("USDA reference for grilled breast.");

  // Opened again, the meal expands into the items it was saved with.
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: "Chicken rice bowl" }).getByLabel("Edit entry").click();
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("761");
  await page.getByRole("button", { name: "Expand into 3 items" }).click();
  await expect(item(page, 1).getByLabel("Grams")).toHaveValue("300");
  await expect(item(page, 1).getByLabel("Calories (kcal)")).toHaveValue("496");
  await expect(item(page, 3).getByLabel("Item", { exact: true })).toHaveValue("Hot sauce");
  // A new name alone is kept through closing and opening again, and saved.
  await item(page, 3).getByLabel("Item", { exact: true }).fill("Sriracha");
  await page.getByRole("button", { name: "Collapse into one meal" }).click();
  await expect(page.getByRole("region", { name: "Items" })).toHaveCount(0);
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("761");
  await expect(figures(page).getByLabel("Calories (kcal)")).not.toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Expand into 3 items" }).click();
  await expect(item(page, 3).getByLabel("Item", { exact: true })).toHaveValue("Sriracha");
  await expect(item(page, 1).getByLabel("Grams")).toHaveValue("300");
  await page.getByRole("button", { name: "Collapse into one meal" }).click();
  await page.getByRole("button", { name: "Update meal", exact: true }).click();
  await expect.poll(async () => {
    const updated = (await meals(page)).find((meal) => meal.name === "Chicken rice bowl");
    return [updated?.items?.map((each) => each.name) ?? null, updated?.assumptions.split("\n")[3]];
  }).toEqual([null, "Sriracha [5 kcal, 0P, 0C, 0F]"]);
});

test("a meal with no figures opens into blank items to type in, and a weight typed in scales its item", async ({ page }) => {
  await loggingFor(page, "Gators").click();
  await page.getByLabel("Meal description").fill("2 eggs, toast and a flat white");
  await page.getByRole("button", { name: "Expand into 3 items" }).click();
  await expect(item(page, 2).getByLabel("Item", { exact: true })).toHaveValue("toast");
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("");

  await item(page, 1).getByLabel("Calories (kcal)").fill("140");
  await item(page, 1).getByLabel("Protein (g)").fill("12");
  await item(page, 2).getByLabel("Calories (kcal)").fill("80");
  await item(page, 2).getByLabel("Carbs (g)").fill("15");
  await item(page, 3).getByLabel("Calories (kcal)").fill("110");
  await item(page, 3).getByLabel("Fat (g)").fill("6");
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("330");
  await expect(figures(page).getByLabel("Carbs (g)")).toHaveValue("15");
  await expect(figures(page).getByLabel("Fat (g)")).toHaveValue("6");

  // A weight typed in ties the figures to it once the box is left, digit by digit or not.
  await expect(item(page, 2).getByRole("slider")).toHaveCount(0);
  await item(page, 2).getByLabel("Grams").pressSequentially("40");
  await expect(item(page, 2).getByLabel("Calories (kcal)")).toHaveValue("80");
  await item(page, 2).getByLabel("Grams").blur();
  await item(page, 2).getByRole("slider", { name: "toast weight" }).fill("80");
  await expect(item(page, 2).getByLabel("Calories (kcal)")).toHaveValue("160");
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("410");

  // A fresh estimate that fails leaves the items, and the meal, as they were.
  await page.route("**/api/estimate", (route) => route.fulfill({ status: 503, json: { error: "Estimator unavailable." } }));
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(item(page, 2).getByLabel("Calories (kcal)")).toHaveValue("160");
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("410");

  // An item has to be named to be saved.
  await item(page, 3).getByLabel("Item", { exact: true }).fill("");
  await page.getByLabel("Meal", { exact: true }).fill("Eggs on toast");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Name item 3.");
  await item(page, 3).getByLabel("Item", { exact: true }).fill("flat white");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true }).first()).toBeVisible();
  const saved = (await meals(page)).find((meal) => meal.name === "Eggs on toast");
  expect(saved?.macros).toMatchObject({ calories: 410, protein: 12, carbs: 30, fat: 6 });
  expect(saved?.items?.map((each) => [each.name, each.grams])).toEqual([["2 eggs", 0], ["toast", 80], ["flat white", 0]]);
});

test("a shared dish expands into dishes of its own, each keeping the dish's share", async ({ page }) => {
  const full = (each: { name: string; calories: number; protein: number; carbs: number; fat: number; fiber?: number }, assumptions: string) =>
    ({ fiber: 0, alcohol: 0, confidence: "medium", assumptions, ...each });
  const dishes = [
    full({ name: "Burrito bowl", calories: 648, protein: 64, carbs: 57, fat: 16, fiber: 1 }, BOWL),
    full({ name: "Chips", calories: 300, protein: 4, carbs: 36, fat: 16 }, "Chips [300 kcal, 4P, 36C, 16F]"),
  ];
  await page.route("**/api/estimate", (route) => route.fulfill({ json: {
    estimate: {
      name: "Shared meal", calories: 948, protein: 68, carbs: 93, fat: 32, fiber: 1, alcohol: 0,
      assumptions: "Dish by dish.", confidence: "medium", dishes,
    },
    provider: "codex",
  } }));
  await loggingFor(page, "Both").click();
  await page.getByLabel("Meal description").fill("Burrito bowl and chips");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("648");
  // One item is nothing to open.
  await expect(dish(page, 2).getByRole("button", { name: /^Expand into/ })).toHaveCount(0);

  await dish(page, 1).getByLabel("Gators (%)").fill("70");
  await dish(page, 1).getByRole("button", { name: "Expand into 3 items" }).click();
  await expect(dish(page, 1).getByLabel("Dish", { exact: true })).toHaveValue("Chicken breast, 150 g cooked");
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("248");
  await expect(dish(page, 1).getByLabel("Quantity (whole dish)")).toHaveValue("150 g");
  await expect(dish(page, 1).getByLabel("Assumptions")).toHaveValue("USDA reference for grilled breast.");
  await expect(dish(page, 3).getByLabel("Dish", { exact: true })).toHaveValue("2 large eggs");
  await expect(dish(page, 3).getByLabel("Gators (%)")).toHaveValue("70");
  await expect(dish(page, 4).getByLabel("Dish", { exact: true })).toHaveValue("Chips");
  await expect(dish(page, 4).getByLabel("Gators (%)")).toHaveValue("50");

  // One of you can now have all of one item.
  await dish(page, 3).getByLabel("Hippos (%)").fill("100");
  // 248 x 0.3 + 260 x 0.3 + 140 + 300 x 0.5.
  await expect(page.getByRole("status", { name: "Shares" })).toContainText("Hippos · 442 kcal");
});

test("items opened from a blend follow the estimator weights at the foot of the form", async ({ page }) => {
  const answer = (calories: number, chicken: number, rice: number) => ({
    name: "Chicken and rice", calories, protein: 46, carbs: 60, fat: 6, fiber: 0, alcohol: 0, confidence: "medium",
    assumptions: `Chicken, 150 g [${chicken} kcal, 40P, 0C, 4F]\n\nRice, 200 g [${rice} kcal, 6P, 60C, 2F]`,
  });
  const lines = [
    { type: "partial", provider: "codex", estimate: answer(500, 200, 300) },
    { type: "partial", provider: "claude", estimate: answer(600, 400, 200) },
    { type: "done", provider: "average", estimate: answer(546.7, 300, 246.7) },
  ];
  await page.route("**/api/estimate", (route) => route.fulfill({
    body: lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    headers: { "Content-Type": "application/x-ndjson" },
  }));
  await loggingFor(page, "Hippos").click();
  await page.getByLabel("Meal description").fill("Chicken and rice");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  // 500 x 40 and 600 x 35, over 75.
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("546.7");

  // Both listed the same two foods, so the items are their weighted average too.
  await page.getByRole("button", { name: "Expand into 2 items" }).click();
  await expect(item(page, 1).getByLabel("Calories (kcal)")).toHaveValue("293.4");
  await expect(item(page, 2).getByLabel("Calories (kcal)")).toHaveValue("253.3");

  const weights = page.getByRole("region", { name: "Estimator weights" });
  await weights.screenshot({ path: "test-results/estimator-weights.png" });
  await weights.getByRole("slider", { name: "Claude weight" }).fill("0");
  await expect(weights.getByRole("listitem").nth(0)).toContainText("100% of the meal");
  await expect(weights.getByRole("listitem").nth(1)).toContainText("0% of the meal");
  await expect(figures(page).getByLabel("Calories (kcal)")).toHaveValue("500");
  await expect(item(page, 1).getByLabel("Calories (kcal)")).toHaveValue("200");
  await expect(item(page, 2).getByLabel("Calories (kcal)")).toHaveValue("300");
  await expect(page.getByText("Averaged across estimators")).toBeVisible();
});
