import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PASSPHRASE } from "../playwright.config.ts";

type SavedMeal = {
  id: string; kind: "meal"; athlete: string; day: string; time?: string; name: string; meal: string; source: string;
  macros: { calories: number; protein: number; carbs: number; fat: number; alcohol?: number; fiber?: number };
  estimator?: string; assumptions: string;
};

/** Only the meals: the suite shares one journal, and sessions and weigh-ins have no name. */
async function meals(page: Page) {
  return page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return (data.records as { kind: string }[]).filter((record) => record.kind === "meal") as SavedMeal[];
  });
}

const loggingFor = (page: Page, name: "Hippos" | "Gators" | "Both") =>
  page.getByRole("group", { name: "Logging for" }).getByRole("button", { name });
const dish = (page: Page, n: number) => page.getByRole("group", { name: `Dish ${n}`, exact: true });

async function fillDish(
  page: Page,
  n: number,
  figures: { name?: string; calories?: string; protein?: string; carbs?: string; fat?: string; fiber?: string },
) {
  const box = dish(page, n);
  if (figures.name !== undefined) await box.getByLabel("Dish", { exact: true }).fill(figures.name);
  if (figures.calories !== undefined) await box.getByLabel("Calories (kcal)").fill(figures.calories);
  if (figures.protein !== undefined) await box.getByLabel("Protein (g)").fill(figures.protein);
  if (figures.carbs !== undefined) await box.getByLabel("Carbs (g)").fill(figures.carbs);
  if (figures.fat !== undefined) await box.getByLabel("Fat (g)").fill(figures.fat);
  if (figures.fiber !== undefined) await box.getByLabel("Fiber (g)").fill(figures.fiber);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
});

test("a meal for both splits by dish, and each of you saves your share", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loggingFor(page, "Hippos").click();
  await expect(page.getByRole("button", { name: "Split by dish" })).toHaveCount(0);
  await loggingFor(page, "Both").click();
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Dinner" }).click();
  await page.getByLabel("Time of day").fill("19:30");

  // What is already on the form becomes the first dish.
  await page.getByLabel("Meal description").fill("Margherita pizza, 12 inch");
  await page.getByLabel("Calories (kcal)").fill("880");
  await page.getByLabel("Protein (g)").fill("36");
  await page.getByLabel("Carbs (g)").fill("100");
  await page.getByLabel("Fiber (g)").fill("6");
  await page.getByLabel("Fat (g)").fill("30");
  await page.getByRole("button", { name: "Split by dish" }).click();

  await expect(page.getByLabel("Meal description")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save this meal as a template" })).toHaveCount(0);
  await expect(dish(page, 1).getByLabel("Dish", { exact: true })).toHaveValue("Margherita pizza, 12 inch");
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("880");
  await expect(dish(page, 1).getByLabel("Fiber (g)")).toHaveValue("6");
  await expect(dish(page, 1).getByLabel("Hippos (%)")).toHaveValue("50");
  await expect(dish(page, 1).getByLabel("Gators (%)")).toHaveValue("50");

  // Typing one share sets the other to the rest.
  await dish(page, 1).getByLabel("Hippos (%)").fill("40");
  await expect(dish(page, 1).getByLabel("Gators (%)")).toHaveValue("60");

  await page.getByRole("button", { name: "Add dish" }).click();
  await fillDish(page, 2, { name: "Caesar salad", calories: "420", protein: "12", carbs: "16", fat: "34", fiber: "4" });
  await page.getByRole("button", { name: "Add dish" }).click();
  await fillDish(page, 3, { name: "Tiramisu", calories: "490", protein: "8", carbs: "45", fat: "30" });
  await dish(page, 3).getByLabel("Gators (%)").fill("100");
  await expect(dish(page, 3).getByLabel("Hippos (%)")).toHaveValue("0");

  const shares = page.getByRole("status", { name: "Shares" });
  await expect(shares).toContainText("Hippos · 562 kcal · P 20 · C 48 · F 29 · Fiber 4 g");
  await expect(shares).toContainText("Gators · 1228 kcal · P 36 · C 113 · F 65 · Fiber 6 g");
  await expect(page.getByLabel("Meal", { exact: true })).toHaveAttribute(
    "placeholder",
    "Margherita pizza, 12 inch, Caesar salad, Tiramisu",
  );

  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await dish(page, 1).screenshot({ path: "test-results/meal-dishes-mobile.png" });

  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meals saved for Hippos and Gators", { exact: true })).toBeVisible();

  await expect.poll(async () => {
    const saved = (await meals(page)).filter((meal) => meal.name.startsWith("Margherita pizza, 12 inch, Caesar salad"));
    return saved
      .map(({ athlete, name, meal, time, source, macros }) => ({ athlete, name, meal, time, source, macros }))
      .sort((a, b) => a.athlete.localeCompare(b.athlete));
  }).toEqual([
    {
      athlete: "gators",
      name: "Margherita pizza, 12 inch, Caesar salad, Tiramisu",
      meal: "Dinner",
      time: "19:30",
      source: "manual",
      macros: { calories: 1228, protein: 35.6, carbs: 113, fat: 65, alcohol: 0, fiber: 5.6 },
    },
    {
      athlete: "hippos",
      name: "Margherita pizza, 12 inch, Caesar salad",
      meal: "Dinner",
      time: "19:30",
      source: "manual",
      macros: { calories: 562, protein: 20.4, carbs: 48, fat: 29, alcohol: 0, fiber: 4.4 },
    },
  ]);
  const hippos = (await meals(page)).find((meal) => meal.athlete === "hippos" && meal.name === "Margherita pizza, 12 inch, Caesar salad");
  expect(hippos?.assumptions).toContain("40% of Margherita pizza, 12 inch [352 kcal, 14P, 40C, 12F, 2 fiber]");
  expect(hippos?.assumptions).toContain("50% of Caesar salad [210 kcal, 6P, 8C, 17F, 2 fiber]");
  expect(hippos?.assumptions).not.toContain("Tiramisu");

  // The next meal starts as one meal again.
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await expect(page.getByLabel("Meal description")).toBeVisible();
  await expect(page.getByRole("group", { name: "Dish 1", exact: true })).toHaveCount(0);
});

test("a dish is estimated on its own, and a split meal outlives a reload", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route("**/api/estimate", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        estimate: {
          name: "Pepperoni pizza, 2 slices", calories: 560, protein: 24, carbs: 64, fat: 22, fiber: 4, alcohol: 0,
          assumptions: "Two slices of a 14-inch pepperoni pie.", confidence: "medium",
        },
        provider: "claude",
      },
    });
  });
  await loggingFor(page, "Both").click();
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Lunch" }).click();
  await page.getByRole("button", { name: "Split by dish" }).click();
  await expect(dish(page, 1).getByLabel("Dish", { exact: true })).toHaveValue("");
  await expect(dish(page, 1).getByRole("button", { name: "Estimate" })).toBeDisabled();

  await dish(page, 1).getByLabel("Dish", { exact: true }).fill("2 slices pepperoni pizza");
  await dish(page, 1).getByRole("button", { name: "Estimate" }).click();
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("560");
  await expect(dish(page, 1)).toContainText("Answered by Claude");
  await expect(dish(page, 1).getByLabel("Dish", { exact: true })).toHaveValue("2 slices pepperoni pizza");
  expect(requests).toEqual([{ description: "2 slices pepperoni pizza" }]);
  await dish(page, 1).getByLabel("Gators (%)").fill("75");
  await expect(dish(page, 1).getByLabel("Hippos (%)")).toHaveValue("25");

  // Closing the app mid-meal loses none of it.
  await page.reload();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await expect(dish(page, 1).getByLabel("Dish", { exact: true })).toHaveValue("2 slices pepperoni pizza");
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("560");
  await expect(dish(page, 1).getByLabel("Hippos (%)")).toHaveValue("25");
  await expect(dish(page, 1)).toContainText("Answered by Claude");

  await page.getByLabel("Meal", { exact: true }).fill("Pizza lunch");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meals saved for Hippos and Gators", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page))
      .filter((meal) => meal.name === "Pizza lunch")
      .map(({ athlete, meal, source, estimator, macros }) => ({ athlete, meal, source, estimator, macros }))
      .sort((a, b) => a.athlete.localeCompare(b.athlete)),
  ).toEqual([
    { athlete: "gators", meal: "Lunch", source: "grok", estimator: "claude", macros: { calories: 420, protein: 18, carbs: 48, fat: 16.5, alcohol: 0, fiber: 3 } },
    { athlete: "hippos", meal: "Lunch", source: "grok", estimator: "claude", macros: { calories: 140, protein: 6, carbs: 16, fat: 5.5, alcohol: 0, fiber: 1 } },
  ]);
  const hippos = (await meals(page)).find((meal) => meal.athlete === "hippos" && meal.name === "Pizza lunch");
  expect(hippos?.assumptions).toBe(
    "25% of 2 slices pepperoni pizza [140 kcal, 6P, 16C, 6F, 1 fiber]\n" +
      "The whole dish [560 kcal, 24P, 64C, 22F, 4 fiber]\n" +
      "Two slices of a 14-inch pepperoni pie.",
  );
});

test("dishes logged for one of you save only that share, and removing them goes back to one meal", async ({ page }) => {
  await loggingFor(page, "Both").click();
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Snack" }).click();
  await page.getByLabel("Meal", { exact: true }).fill("Shared fries");
  await page.getByRole("button", { name: "Split by dish" }).click();
  // A name was all there was, so it names the dish.
  await expect(dish(page, 1).getByLabel("Dish", { exact: true })).toHaveValue("Shared fries");
  await expect(page.getByLabel("Meal", { exact: true })).toHaveValue("");
  await fillDish(page, 1, { calories: "400", protein: "4", carbs: "48", fat: "20" });

  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  await dish(page, 1).getByLabel("Hippos (%)").fill("4o");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Dish 1: a share is a percentage from 0 to 100.");
  await dish(page, 1).getByLabel("Hippos (%)").fill("50");

  await loggingFor(page, "Gators").click();
  const shares = page.getByRole("status", { name: "Shares" });
  await expect(shares).toContainText("Gators · 200 kcal");
  await expect(shares).not.toContainText("Hippos");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page))
      .filter((meal) => meal.name === "Shared fries")
      .map(({ athlete, macros }) => ({ athlete, calories: macros.calories })),
  ).toEqual([{ athlete: "gators", calories: 200 }]);

  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await loggingFor(page, "Both").click();
  await page.getByRole("button", { name: "Split by dish" }).click();
  await page.getByRole("button", { name: "Add dish" }).click();
  await page.getByRole("button", { name: "Remove dish 2" }).click();
  await page.getByRole("button", { name: "Remove dish 1" }).click();
  await expect(page.getByLabel("Meal description")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save this meal as a template" })).toBeVisible();
});
