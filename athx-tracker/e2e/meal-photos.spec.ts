import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PASSPHRASE } from "../playwright.config.ts";

type Sent = {
  description: string;
  dishes?: string[];
  images?: { type: string; data: string }[];
  refinement?: { replies: string[] };
};

const plate = {
  name: "Grilled chicken plate", calories: 640, protein: 52, carbs: 48, fat: 24, fiber: 6, alcohol: 0,
  assumptions: "Saw about 180 g chicken, a cup of rice and broccoli on a dinner plate.", confidence: "medium",
};

const loggingFor = (page: Page, name: "Hippos" | "Gators" | "Both") =>
  page.getByRole("group", { name: "Logging for" }).getByRole("button", { name });
const dish = (page: Page, n: number) => page.getByRole("group", { name: `Dish ${n}`, exact: true });
const photos = (page: Page) => page.getByRole("list", { name: "Meal photos" }).getByRole("img");

async function openMeal(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
}

/** A JPEG drawn in the page, a plate on a table, at the size given. */
async function jpeg(page: Page, width: number, height: number) {
  const data = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#8b5a2b";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.ellipse(width / 2, height / 2, width / 3, height / 3, 0, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, { width, height });
  return Buffer.from(data, "base64");
}

/** How big a photo the page sent is, read back the way a browser reads it. */
function sizeOf(page: Page, data: string) {
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${data}`;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, data);
}

async function meals(page: Page) {
  return page.evaluate(async () =>
    (await fetch("/api/records").then((r) => r.json())).records as Record<string, unknown>[]);
}

test("a photo alone is estimated, shrunk on the phone first, and the meal is saved without it", async ({ page }) => {
  const sent: Sent[] = [];
  await page.route("**/api/estimate", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { estimate: plate, provider: "average" } });
  });
  await openMeal(page);
  await loggingFor(page, "Hippos").click();
  const estimate = page.getByRole("button", { name: "Estimate macros", exact: true });
  await expect(estimate).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save and estimate in background" })).toBeVisible();

  await page.getByLabel("Upload photo").setInputFiles({
    name: "plate.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, 3000, 2000),
  });
  await expect(photos(page)).toHaveCount(1);
  await expect(page.getByRole("img", { name: "Meal photo 1" })).toBeVisible();
  // The meal is saved without its photo, so the background worker would never see it.
  await expect(page.getByRole("button", { name: "Save and estimate in background" })).toHaveCount(0);
  await expect(page.getByLabel("Meal description")).toHaveAttribute(
    "placeholder", "Anything the photo does not show: portions, oil, what is inside",
  );
  await expect(estimate).toBeEnabled();
  await estimate.click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("640");
  await expect(page.getByLabel("Meal", { exact: true })).toHaveValue("Grilled chicken plate");

  expect(sent).toHaveLength(1);
  expect(sent[0].description).toBe("");
  expect(sent[0].dishes).toBeUndefined();
  expect(sent[0].images).toHaveLength(1);
  const [image] = sent[0].images!;
  expect(image.type).toBe("image/jpeg");
  expect(image.data.startsWith("/9j/")).toBe(true);
  // 3000 x 2000 leaves the phone at 1536 on its long side, its shape kept.
  expect(await sizeOf(page, image.data)).toEqual({ width: 1536, height: 1024 });

  // A reply looks at the photo again, along with what it is told.
  await page.getByRole("button", { name: "Reply to estimate" }).click();
  await page.getByLabel("Your reply").fill("It was brown rice.");
  await page.getByRole("dialog").getByRole("button", { name: "Send & re-estimate" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].refinement?.replies).toEqual(["It was brown rice."]);
  expect(sent[1].images).toEqual(sent[0].images);
  await page.getByRole("dialog").getByRole("button", { name: "Done, back to meal" }).click();

  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true })).toBeVisible();
  const saved = (await meals(page)).find((meal) => meal.name === "Grilled chicken plate");
  expect(saved).toMatchObject({ source: "grok", estimator: "average", macros: { calories: 640 } });
  expect(JSON.stringify(saved)).not.toContain("/9j/");
  await expect(photos(page)).toHaveCount(0);

  // Today's meal, and every spec shares one journal: Fuel's would count it.
  await page.evaluate(async (id) => {
    await fetch("/api/records", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
  }, saved!.id);
});

test("words go with the photo, and Take photo asks for a new picture from the rear camera", async ({ page }) => {
  const sent: Sent[] = [];
  await page.route("**/api/estimate", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { estimate: plate } });
  });
  await openMeal(page);
  await loggingFor(page, "Gators").click();
  const camera = page.getByLabel("Take photo");
  await expect(camera).toHaveAttribute("type", "file");
  await expect(camera).toHaveAttribute("capture", "environment");
  await expect(camera).toHaveAttribute("accept", "image/*");
  await expect(page.getByLabel("Upload photo")).toHaveAttribute("multiple", "");

  await camera.setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, 800, 600) });
  await expect(photos(page)).toHaveCount(1);
  await page.getByLabel("Meal description").fill("Large portion, cooked in olive oil");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("640");
  expect(sent[0].description).toBe("Large portion, cooked in olive oil");
  // Never bigger than it came.
  expect(await sizeOf(page, sent[0].images![0].data)).toEqual({ width: 800, height: 600 });
});

test("a photo this browser cannot open says so and adds nothing", async ({ page }) => {
  await openMeal(page);
  await loggingFor(page, "Hippos").click();
  await page.getByLabel("Upload photo").setInputFiles({
    name: "IMG_0002.HEIC", mimeType: "image/heic", buffer: Buffer.from("not a picture at all"),
  });
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "That photo could not be opened here. Try another, or a JPEG or PNG.",
  );
  await expect(page.getByRole("list", { name: "Meal photos" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Estimate macros", exact: true })).toBeDisabled();
});

test("an estimate takes three photos at most, and each can be taken off", async ({ page }) => {
  await openMeal(page);
  await loggingFor(page, "Hippos").click();
  const picture = await jpeg(page, 640, 480);
  await page.getByLabel("Upload photo").setInputFiles(
    ["a", "b", "c", "d"].map((name) => ({ name: `${name}.jpg`, mimeType: "image/jpeg", buffer: picture })),
  );
  await expect(photos(page)).toHaveCount(3);
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "An estimate takes 3 photos at most, so the rest were left out.",
  );
  await expect(page.getByLabel("Upload photo")).toBeDisabled();
  await expect(page.getByLabel("Take photo")).toBeDisabled();

  await page.getByRole("button", { name: "Remove photo 2" }).click();
  await expect(photos(page)).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Meal photo 2" })).toBeVisible();
  await expect(page.getByLabel("Upload photo")).toBeEnabled();
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);

  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations).toEqual([]);
});

test("a photo of a meal for both comes back dish by dish, its words read as notes", async ({ page }) => {
  const sent: Sent[] = [];
  await page.route("**/api/estimate", async (route) => {
    sent.push(route.request().postDataJSON());
    const dishes = [
      { name: "Burger", calories: 650, protein: 35, carbs: 45, fat: 36, fiber: 2, alcohol: 0 },
      { name: "Fries", calories: 380, protein: 4, carbs: 48, fat: 19, fiber: 4, alcohol: 0 },
    ].map((each) => ({ ...each, assumptions: `${each.name}, as seen.`, confidence: "medium" }));
    await route.fulfill({
      json: {
        provider: "average",
        estimate: {
          name: "Burger and fries", calories: 1030, protein: 39, carbs: 93, fat: 55, fiber: 6, alcohol: 0,
          assumptions: "Dish by dish.", confidence: "medium", dishes,
        },
      },
    });
  });
  await openMeal(page);
  await loggingFor(page, "Both").click();
  await page.getByLabel("Upload photo").setInputFiles({
    name: "table.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, 1200, 900),
  });
  await page.getByLabel("Meal description").fill("Large portions, cooked in olive oil");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(dish(page, 2).getByLabel("Dish", { exact: true })).toHaveValue("Fries");
  await expect(dish(page, 1).getByLabel("Calories (kcal)")).toHaveValue("650");
  // The words are notes on the photo, not two dishes cut at the comma: the
  // dishes are the estimator's to find in the photo.
  expect(sent[0]).toMatchObject({ description: "Large portions, cooked in olive oil", dishes: [] });
  expect(sent[0].images).toHaveLength(1);
});
