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

  // Figures already on the form, for the same meal for each, become the first dish whole.
  await page.getByRole("button", { name: "Same meal for each of you" }).click();
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

  // The next meal waits to be split again.
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
  // Asked dish by dish; an answer without dishes fills the one it was asked for.
  expect(requests).toEqual([{ description: "2 slices pepperoni pizza", dishes: ["2 slices pepperoni pizza"] }]);
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
  await page.getByRole("button", { name: "Same meal for each of you" }).click();
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
  // For both, no dishes is a meal waiting to be split, not one meal.
  await expect(page.getByLabel("Meal description")).toBeVisible();
  await expect(page.getByRole("button", { name: "Same meal for each of you" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save this meal as a template" })).toHaveCount(0);

  // A description longer than a meal's name, with nothing to cut it at, becomes the dish whole.
  const long = `Tasting menu ${Array.from({ length: 30 }, (_, index) => `course ${index + 1} with sauce`).join(" then ")}`;
  expect(long.length).toBeGreaterThan(300);
  await page.getByLabel("Meal description").fill(long);
  await page.getByRole("button", { name: "Split by dish" }).click();
  await expect(dish(page, 1).getByLabel("Dish", { exact: true })).toHaveValue(long);
});

test("each dish shows its own estimate's assumptions, and an edit to them is what saves", async ({ page }) => {
  await page.route("**/api/estimate", async (route) => {
    const { description } = route.request().postDataJSON() as { description: string };
    await route.fulfill({
      json: description.includes("ramen")
        ? {
            estimate: {
              name: "Tonkotsu ramen", calories: 900, protein: 40, carbs: 100, fat: 36, fiber: 4, alcohol: 0,
              assumptions: "Tonkotsu ramen, one bowl [900 kcal, 40P, 100C, 36F, 4 fiber]\nPork broth, noodles, chashu.",
              confidence: "medium",
            },
            provider: "codex",
          }
        : {
            estimate: {
              name: "Gyoza, 6 pieces", calories: 300, protein: 12, carbs: 30, fat: 14, fiber: 2, alcohol: 0,
              assumptions: "Gyoza, 6 pan-fried pieces [300 kcal, 12P, 30C, 14F, 2 fiber]\n50 g each.",
              confidence: "medium",
            },
            provider: "claude",
          },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await loggingFor(page, "Both").click();
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Dinner" }).click();

  // An answer for the whole meal, from an estimator without dishes, is one dish with its working.
  await page.getByLabel("Meal description").fill("Tonkotsu ramen");
  await page.getByRole("button", { name: "Estimate macros" }).click();
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("900");
  await expect(dish(page, 1).getByLabel("Dish", { exact: true })).toHaveValue("Tonkotsu ramen");
  await expect(dish(page, 1).getByLabel("Assumptions")).toHaveValue(
    "Tonkotsu ramen, one bowl [900 kcal, 40P, 100C, 36F, 4 fiber]\nPork broth, noodles, chashu.",
  );

  // A dish typed by hand has nothing to show until it is estimated.
  await page.getByRole("button", { name: "Add dish" }).click();
  await expect(dish(page, 2).getByLabel("Assumptions")).toHaveCount(0);
  await dish(page, 2).getByLabel("Dish", { exact: true }).fill("6 pork gyoza");
  await dish(page, 2).getByRole("button", { name: "Estimate" }).click();
  await expect(dish(page, 2).getByLabel("Assumptions")).toHaveValue(
    "Gyoza, 6 pan-fried pieces [300 kcal, 12P, 30C, 14F, 2 fiber]\n50 g each.",
  );
  await expect(dish(page, 2)).toContainText("Answered by Claude");
  await dish(page, 2).screenshot({ path: "test-results/meal-dish-assumptions-mobile.png" });

  // Correcting the working leaves the figures the estimate's.
  await dish(page, 2).getByLabel("Assumptions").fill("Gyoza, 6 pieces, steamed not fried.");
  await expect(dish(page, 2)).not.toContainText("saved as your own numbers");
  // Changing a figure still makes them your own.
  await dish(page, 1).getByLabel("Fat (g)").fill("30");
  await expect(dish(page, 1)).toContainText("saved as your own numbers after your edit");
  // Emptied, an estimate's box stays, so it can be written again.
  await dish(page, 1).getByLabel("Assumptions").fill("");
  await expect(dish(page, 1).getByLabel("Assumptions")).toHaveValue("");

  await page.getByLabel("Meal", { exact: true }).fill("Ramen night");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meals saved for Hippos and Gators", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page)).find((meal) => meal.athlete === "gators" && meal.name === "Ramen night")?.assumptions,
  ).toBe(
    "50% of Tonkotsu ramen [450 kcal, 20P, 50C, 15F, 2 fiber]\n" +
      "The whole dish [900 kcal, 40P, 100C, 30F, 4 fiber]\n\n" +
      "50% of 6 pork gyoza [150 kcal, 6P, 15C, 7F, 1 fiber]\n" +
      "The whole dish [300 kcal, 12P, 30C, 14F, 2 fiber]\n" +
      "Gyoza, 6 pieces, steamed not fried.",
  );
});

test("a slider shares each dish, a slice at a time once the dish is counted", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loggingFor(page, "Both").click();
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Dinner" }).click();
  await page.getByRole("button", { name: "Split by dish" }).click();
  await fillDish(page, 1, { name: "Margherita pizza, 12 inch", calories: "880", protein: "36", carbs: "100", fat: "30", fiber: "6" });

  const pie = dish(page, 1);
  const slider = pie.getByRole("slider", { name: "Hippos' share" });
  // Uncounted, it goes a percent at a time.
  await expect(slider).toHaveAttribute("aria-valuemax", "100");
  await expect(slider).toHaveAttribute("aria-valuenow", "50");
  await expect(slider).toHaveAttribute("aria-valuetext", "Hippos 50%, 440 kcal; Gators 50%, 440 kcal");
  // Each part of the bar carries its share, with its calories under it.
  await expect(pie.getByText("50%", { exact: true })).toHaveCount(2);
  for (const half of await pie.getByText("50%", { exact: true }).all()) await expect(half).toBeVisible();
  await expect(pie.getByText("440 kcal", { exact: true })).toHaveCount(2);

  await pie.getByLabel("Quantity (whole dish)").fill("eight slices");
  await expect(pie).toContainText("Start with a number, as in 8 slices");
  await expect(slider).toHaveAttribute("aria-valuemax", "100");
  await pie.getByLabel("Quantity (whole dish)").fill("8 slices");
  await expect(pie).not.toContainText("Start with a number");
  await expect(slider).toHaveAttribute("aria-valuemax", "8");
  await expect(slider).toHaveAttribute("aria-valuenow", "4");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    "Hippos 50%, 4 of 8 slices, 440 kcal; Gators 50%, 4 of 8 slices, 440 kcal",
  );

  // A slice at a time from the keyboard, and the boxes at either end follow.
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", "3");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    "Hippos 37.5%, 3 of 8 slices, 330 kcal; Gators 62.5%, 5 of 8 slices, 550 kcal",
  );
  await expect(pie.getByText("62.5%", { exact: true })).toBeVisible();
  await expect(pie.getByText("330 kcal", { exact: true })).toBeVisible();
  await expect(pie.getByText("5 of 8 slices", { exact: true })).toBeVisible();
  await expect(pie.getByLabel("Hippos (%)")).toHaveValue("37.5");
  await expect(pie.getByLabel("Gators (%)")).toHaveValue("62.5");
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    "Hippos 0%, 0 of 8 slices, 0 kcal; Gators 100%, 8 of 8 slices, 880 kcal",
  );
  // A part with no room for its share leaves it to the box at its end.
  await expect(pie.getByText("100%", { exact: true })).toBeVisible();
  await expect(pie.getByText("0%", { exact: true })).toBeHidden();
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    "Hippos 100%, 8 of 8 slices, 880 kcal; Gators 0%, 0 of 8 slices, 0 kcal",
  );

  // A tap on the bar takes the slice under it: a quarter of the way is 2.
  const track = slider.locator("xpath=ancestor::*[@data-orientation][1]");
  const box = await track.boundingBox();
  if (!box) throw new Error("The slider has no size.");
  await track.click({ position: { x: box.width * 0.25, y: box.height / 2 } });
  await expect(slider).toHaveAttribute("aria-valuenow", "2");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    "Hippos 25%, 2 of 8 slices, 220 kcal; Gators 75%, 6 of 8 slices, 660 kcal",
  );

  // A share typed between slices sits between them, and reads as typed.
  await pie.getByLabel("Gators (%)").fill("60");
  await expect(slider).toHaveAttribute("aria-valuenow", "3.2");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    "Hippos 40%, 3.2 of 8 slices, 352 kcal; Gators 60%, 4.8 of 8 slices, 528 kcal",
  );
  await pie.getByLabel("Hippos (%)").fill("37.5");
  await expect(slider).toHaveAttribute("aria-valuenow", "3");

  await page.getByRole("button", { name: "Add dish" }).click();
  await fillDish(page, 2, { name: "Caesar salad", calories: "420", protein: "12", carbs: "16", fat: "34", fiber: "4" });
  const bowl = dish(page, 2);
  const salad = bowl.getByRole("slider", { name: "Hippos' share" });
  // A third reads to a tenth until its box is typed in.
  await bowl.getByLabel("Quantity (whole dish)").fill("3 bowls");
  await salad.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(bowl.getByLabel("Hippos (%)")).toHaveValue("33.3");
  await expect(bowl.getByLabel("Gators (%)")).toHaveValue("66.7");
  await bowl.getByLabel("Hippos (%)").focus();
  await expect(bowl.getByLabel("Hippos (%)")).toHaveValue("33.3333");
  await bowl.getByLabel("Hippos (%)").fill("50");
  await bowl.getByLabel("Quantity (whole dish)").fill("");
  await salad.focus();
  await page.keyboard.press("ArrowRight");
  await expect(salad).toHaveAttribute("aria-valuetext", "Hippos 51%, 214 kcal; Gators 49%, 206 kcal");
  await bowl.getByLabel("Gators (%)").fill("30");
  await expect(salad).toHaveAttribute("aria-valuenow", "70");
  await expect(salad).toHaveAttribute("aria-valuetext", "Hippos 70%, 294 kcal; Gators 30%, 126 kcal");

  const shares = page.getByRole("status", { name: "Shares" });
  await expect(shares).toContainText("Hippos · 624 kcal");
  await expect(shares).toContainText("Gators · 676 kcal");

  // The shares written on the bar read in both themes.
  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.map((v) => v.id), theme).toEqual([]);
    await pie.screenshot({ path: `test-results/meal-dish-slider-${theme.toLowerCase()}.png` });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The count outlives a reload with the rest of the draft.
  await page.reload();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await expect(dish(page, 1).getByLabel("Quantity (whole dish)")).toHaveValue("8 slices");
  await expect(dish(page, 1).getByRole("slider", { name: "Hippos' share" })).toHaveAttribute("aria-valuenow", "3");

  await page.getByLabel("Meal", { exact: true }).fill("Pizza and salad");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meals saved for Hippos and Gators", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page))
      .filter((meal) => meal.name === "Pizza and salad")
      .map(({ athlete, macros }) => ({ athlete, calories: macros.calories }))
      .sort((a, b) => a.athlete.localeCompare(b.athlete)),
  ).toEqual([{ athlete: "gators", calories: 676 }, { athlete: "hippos", calories: 624 }]);
  const hippos = (await meals(page)).find((meal) => meal.athlete === "hippos" && meal.name === "Pizza and salad");
  expect(hippos?.assumptions).toContain("37.5% of Margherita pizza, 12 inch (3 of 8 slices) [330 kcal, 14P, 38C, 11F, 2 fiber]");
  expect(hippos?.assumptions).toContain("70% of Caesar salad [294 kcal, 8P, 11C, 24F, 3 fiber]");
});

/** An estimate dish by dish, each dish an estimate of its own, with the totals theirs added up. */
function shared(dishes: { name: string; calories: number; protein: number; carbs: number; fat: number; fiber?: number; alcohol?: number; confidence?: string }[]) {
  const full = dishes.map((each) => ({
    fiber: 0, alcohol: 0, confidence: "medium", assumptions: `${each.name}, worked out.`, ...each,
  }));
  const total = (key: "calories" | "protein" | "carbs" | "fat" | "fiber" | "alcohol") =>
    full.reduce((sum, each) => sum + each[key], 0);
  return {
    name: "Shared meal", calories: total("calories"), protein: total("protein"), carbs: total("carbs"),
    fat: total("fat"), fiber: total("fiber"), alcohol: total("alcohol"),
    assumptions: "Weighted average, dish by dish.", confidence: "medium", dishes: full,
  };
}

test("a meal for both is split by dish from the start, and its estimate comes back dish by dish", async ({ page }) => {
  const requests: { description: string; dishes?: string[] }[] = [];
  await page.route("**/api/estimate", async (route) => {
    const body = route.request().postDataJSON() as { description: string; dishes?: string[] };
    requests.push(body);
    // The estimator splits what was written with only a space, as the phone cannot.
    const dishes = body.description.startsWith("burger fries")
      ? [
          { name: "burger", calories: 650, protein: 35, carbs: 45, fat: 36 },
          { name: "fries", calories: 380, protein: 4, carbs: 48, fat: 19, fiber: 4 },
        ]
      : [
          { name: "Margherita pizza", calories: 880, protein: 36, carbs: 100, fat: 30, fiber: 6, confidence: "high" },
          { name: "Caesar salad", calories: 420, protein: 12, carbs: 16, fat: 34, fiber: 4 },
          { name: "tiramisu", calories: 490, protein: 8, carbs: 45, fat: 30 },
        ];
    await route.fulfill({ json: { estimate: shared(dishes), provider: "average" } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await loggingFor(page, "Both").click();
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Dinner" }).click();

  // Before it is split there are no meal figures to type, and no queue to wait in.
  await expect(page.getByLabel("Meal description")).toBeVisible();
  await expect(page.getByLabel("Calories (kcal)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Same meal for each of you" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and estimate in background" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Describe the meal first.");
  await page.locator("form").screenshot({ path: "test-results/meal-both-describe-mobile.png" });

  await page.getByLabel("Meal description").fill("Margherita pizza, Caesar salad and tiramisu");
  await page.getByRole("button", { name: "Estimate macros" }).click();
  // The phone's cut goes with the description, for the estimator to keep.
  await expect.poll(() => requests.at(-1)).toEqual({
    description: "Margherita pizza, Caesar salad and tiramisu",
    dishes: ["Margherita pizza", "Caesar salad", "tiramisu"],
  });
  await expect(dish(page, 3).getByLabel("Dish", { exact: true })).toHaveValue("tiramisu");
  await expect(page.getByLabel("Meal description")).toHaveCount(0);
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("880");
  await expect(dish(page, 1).getByLabel("Assumptions")).toHaveValue("Margherita pizza, worked out.");
  await expect(dish(page, 1)).toContainText("Averaged across estimators · Confidence: high");
  await expect(dish(page, 2)).toContainText("Confidence: medium");
  await expect(dish(page, 2).getByLabel("Hippos (%)")).toHaveValue("50");
  await dish(page, 1).screenshot({ path: "test-results/meal-both-dish-mobile.png" });

  // A dish estimated on its own can come back as two, each keeping its share.
  await page.getByRole("button", { name: "Add dish" }).click();
  await dish(page, 4).getByLabel("Dish", { exact: true }).fill("burger fries");
  await dish(page, 4).getByLabel("Gators (%)").fill("100");
  await dish(page, 4).getByRole("button", { name: "Estimate" }).click();
  await expect(dish(page, 5).getByLabel("Dish", { exact: true })).toHaveValue("fries");
  expect(requests.at(-1)).toEqual({ description: "burger fries", dishes: ["burger fries"] });
  await expect(dish(page, 4).getByLabel("Dish", { exact: true })).toHaveValue("burger");
  await expect(dish(page, 4).getByLabel("Calories (kcal)")).toHaveValue("650");
  await expect(dish(page, 5).getByLabel("Gators (%)")).toHaveValue("100");
  await dish(page, 3).getByLabel("Gators (%)").fill("100");

  const shares = page.getByRole("status", { name: "Shares" });
  await expect(shares).toContainText("Hippos · 650 kcal");
  await expect(shares).toContainText("Gators · 2170 kcal");
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meals saved for Hippos and Gators", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page))
      .filter((meal) => meal.name.startsWith("Margherita pizza, Caesar salad"))
      .map(({ athlete, name, source, estimator, macros }) => ({ athlete, name, source, estimator, calories: macros.calories }))
      .sort((a, b) => a.athlete.localeCompare(b.athlete)),
  ).toEqual([
    { athlete: "gators", name: "Margherita pizza, Caesar salad, tiramisu, burger, fries", source: "grok", estimator: "average", calories: 2170 },
    { athlete: "hippos", name: "Margherita pizza, Caesar salad", source: "grok", estimator: "average", calories: 650 },
  ]);

  // The next meal for both is split again.
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Same meal for each of you" })).toBeVisible();
});

test("a meal for both is cut into dishes without an estimate, or kept the same for each", async ({ page }) => {
  await loggingFor(page, "Both").click();
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Lunch" }).click();
  await page.getByLabel("Meal description").fill("pad thai\n- green curry, no peanuts\nmac and cheese & 2 beers");
  await page.getByRole("button", { name: "Split by dish" }).click();
  await expect(page.getByRole("group", { name: /^Dish \d+$/ })).toHaveCount(4);
  for (const [n, name] of ["pad thai", "green curry, no peanuts", "mac and cheese", "2 beers"].entries())
    await expect(dish(page, n + 1).getByLabel("Dish", { exact: true })).toHaveValue(name);
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("");

  // Back to one meal for each: remove the dishes, and say so.
  for (let n = 4; n >= 1; n -= 1) await page.getByRole("button", { name: `Remove dish ${n}` }).click();
  await page.getByRole("button", { name: "Same meal for each of you" }).click();
  await page.getByLabel("Meal", { exact: true }).fill("Same lunch");
  await page.getByLabel("Calories (kcal)").fill("600");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meals saved for Hippos and Gators", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page)).filter((meal) => meal.name === "Same lunch").map((meal) => meal.macros.calories),
  ).toEqual([600, 600]);
  // And the next is split again.
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Same meal for each of you" })).toBeVisible();
});
