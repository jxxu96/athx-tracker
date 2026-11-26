import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import Database from "better-sqlite3";
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

/** How many sets of photos the server holds under an id, read from the spec's own database. */
function heldPhotos(id: string) {
  const sqlite = new Database(".playwright/athx-e2e.db", { readonly: true });
  try {
    return (sqlite.prepare("SELECT COUNT(*) AS n FROM queued_photos WHERE id = ?").get(id) as { n: number }).n;
  } finally {
    sqlite.close();
  }
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

  await page.getByLabel("Library").setInputFiles({
    name: "plate.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, 3000, 2000),
  });
  await expect(photos(page)).toHaveCount(1);
  await expect(page.getByRole("img", { name: "Meal photo 1" })).toBeVisible();
  // A photo with no words is enough to save for the background worker too.
  await expect(page.getByRole("button", { name: "Save and estimate in background" })).toBeEnabled();
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
  await expect(page.getByLabel("Library")).toHaveAttribute("multiple", "");

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
  await page.getByLabel("Library").setInputFiles({
    name: "IMG_0002.HEIC", mimeType: "image/heic", buffer: Buffer.from("not a picture at all"),
  });
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "That photo could not be opened here. Try another, or a JPEG or PNG.",
  );
  await expect(page.getByRole("list", { name: "Meal photos" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Estimate macros", exact: true })).toBeDisabled();
});

test("an estimate takes six photos at most, each can be taken off, and all go with it", async ({ page }) => {
  const sent: Sent[] = [];
  await page.route("**/api/estimate", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { estimate: plate } });
  });
  await openMeal(page);
  await loggingFor(page, "Hippos").click();
  const picture = await jpeg(page, 640, 480);
  await page.getByLabel("Library").setInputFiles(
    ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({ name: `${name}.jpg`, mimeType: "image/jpeg", buffer: picture })),
  );
  await expect(photos(page)).toHaveCount(6);
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "An estimate takes 6 photos at most, so the rest were left out.",
  );
  await expect(page.getByLabel("Library")).toBeDisabled();
  await expect(page.getByLabel("Take photo")).toBeDisabled();
  await expect(page.getByLabel("Meal description")).toHaveAttribute(
    "placeholder", "Anything the photos do not show: portions, oil, what is inside",
  );

  await page.getByRole("button", { name: "Remove photo 2" }).click();
  await expect(photos(page)).toHaveCount(5);
  await expect(page.getByRole("img", { name: "Meal photo 5" })).toBeVisible();
  await expect(page.getByLabel("Library")).toBeEnabled();
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);

  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("640");
  expect(sent[0].images).toHaveLength(5);

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
  await page.getByLabel("Library").setInputFiles({
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

test("Take photo, Library, File and Paste pick photos four ways, all the same height", async ({ page }) => {
  await openMeal(page);
  await loggingFor(page, "Hippos").click();
  const camera = page.getByLabel("Take photo");
  const library = page.getByLabel("Library");
  const file = page.getByLabel("File", { exact: true });
  const paste = page.getByRole("button", { name: "Paste", exact: true });
  await expect(library).toHaveAttribute("accept", "image/*");
  await expect(library).not.toHaveAttribute("capture");
  await expect(file).not.toHaveAttribute("accept");
  await expect(file).not.toHaveAttribute("capture");
  // Each picker once: the camera is not offered twice.
  await expect(page.locator('input[type="file"][capture]')).toHaveCount(1);
  const height = async (input: typeof camera) =>
    (await input.locator("xpath=..").boundingBox())!.height;
  expect(await height(file)).toBe(await height(camera));
  expect(await height(library)).toBe(await height(camera));
  expect((await paste.boundingBox())!.height).toBe(await height(camera));
  await file.setInputFiles({ name: "plate.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, 640, 480) });
  await expect(photos(page)).toHaveCount(1);
});

test("Paste adds a picture copied to the clipboard, and says when there is none", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openMeal(page);
  await loggingFor(page, "Hippos").click();
  const paste = page.getByRole("button", { name: "Paste", exact: true });

  await page.evaluate(() => navigator.clipboard.writeText("not a picture"));
  await paste.click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "There is no picture on the clipboard. Copy a photo first, then paste it here. " +
      "A picture file copied from a folder pastes with Ctrl+V.",
  );
  await expect(page.getByRole("list", { name: "Meal photos" })).toHaveCount(0);

  // Copied from a page or Photos, a picture reaches the clipboard as a PNG.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 600;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2e7d32";
    context.fillRect(0, 0, 900, 600);
    const png = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  });
  await paste.click();
  await expect(photos(page)).toHaveCount(1);
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
});

/** Puts a picture on the clipboard, as a screenshot or Copy image would, with any text beside it. */
async function copyPicture(page: Page, text?: string) {
  await page.evaluate(async (text) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#c62828";
    context.fillRect(0, 0, 800, 600);
    const png = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({
      "image/png": png,
      ...(text ? { "text/plain": new Blob([text], { type: "text/plain" }) } : {}),
    })]);
  }, text);
}

test("Ctrl+V pastes a picture from anywhere on the form, and text into a box stays text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openMeal(page);
  await loggingFor(page, "Hippos").click();

  // Nothing in particular focused: the browser aims it at the page's selection.
  await copyPicture(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Control+V");
  await expect(photos(page)).toHaveCount(1);

  // In the description: a picture alone comes in as a photo and types nothing.
  const description = page.getByLabel("Meal description");
  await description.click();
  await page.keyboard.press("Control+V");
  await expect(photos(page)).toHaveCount(2);
  await expect(description).toHaveValue("");

  // Text with a picture of it beside it, as Word or Excel copies, is text.
  await copyPicture(page, "two eggs and toast");
  await description.click();
  await page.keyboard.press("Control+V");
  await expect(description).toHaveValue("two eggs and toast");
  await expect(photos(page)).toHaveCount(2);
});

test("a picture file copied from a folder pastes, and a full form says so", async ({ page }) => {
  await openMeal(page);
  await loggingFor(page, "Gators").click();
  const picture = (await jpeg(page, 640, 480)).toString("base64");
  // What a paste carries for files copied in File Explorer or Finder: the files, no picture data.
  const pasteFiles = (count: number) => page.evaluate(({ data, count }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const files = new DataTransfer();
    for (let n = 0; n < count; n += 1) files.items.add(new File([bytes], `IMG_${n}.jpg`, { type: "image/jpeg" }));
    files.items.add(new File(["%PDF"], "menu.pdf", { type: "application/pdf" }));
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: files, bubbles: true, cancelable: true }));
  }, { data: picture, count });

  await pasteFiles(2);
  await expect(photos(page)).toHaveCount(2);
  await pasteFiles(4);
  await expect(photos(page)).toHaveCount(6);
  await pasteFiles(1);
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "An estimate takes 6 photos at most. Take one off to add another.",
  );
  await expect(photos(page)).toHaveCount(6);
});

test("a photo saved to estimate in the background goes to the server first, and the meal points to it", async ({ page }) => {
  const held: { id: string; images: { type: string; data: string }[]; meals: string[] }[] = [];
  await page.route("**/api/queued-photos", async (route) => {
    held.push(route.request().postDataJSON());
    await route.continue();
  });
  await openMeal(page);
  await loggingFor(page, "Both").click();
  // The queue fills one meal, not a meal split by dish.
  await page.getByRole("button", { name: "Same meal for each of you" }).click();
  await page.getByLabel("Library").setInputFiles({
    name: "plate.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, 3000, 2000),
  });
  await expect(photos(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Save and estimate in background" }).click();
  await expect(page.getByText("Meals saved for Hippos and Gators", { exact: true })).toBeVisible();
  await expect(photos(page)).toHaveCount(0);

  expect(held).toHaveLength(1);
  expect(held[0].images).toHaveLength(1);
  expect(held[0].images[0].data.startsWith("/9j/")).toBe(true);
  const saved = (await meals(page)).filter((meal) => meal.photoSet === held[0].id);
  // One set of photos for both halves, which the worker estimates once, and
  // which waits for both to arrive.
  expect(saved).toHaveLength(2);
  expect([...held[0].meals].sort()).toEqual(saved.map((meal) => meal.id as string).sort());
  for (const meal of saved) {
    expect(meal).toMatchObject({ source: "queued", name: "Meal from photos", assumptions: "" });
    expect(JSON.stringify(meal)).not.toContain("/9j/");
  }
  // The server holds them apart from the journal until the meal is done with.
  expect(heldPhotos(held[0].id)).toBe(1);

  const remove = (id: string) => page.evaluate(async (id) => {
    await fetch("/api/records", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
  }, id);
  await remove(saved[0].id as string);
  expect(heldPhotos(held[0].id), "the other half still waits on them").toBe(1);
  await remove(saved[1].id as string);
  expect(heldPhotos(held[0].id), "deleted with the last meal that waited on them").toBe(0);
});

test("a photo meal opened again from the Log and queued again keeps its photos", async ({ page }) => {
  let sends = 0;
  await page.route("**/api/queued-photos", async (route) => {
    sends += 1;
    await route.continue();
  });
  await openMeal(page);
  await loggingFor(page, "Hippos").click();
  await page.getByLabel("Library").setInputFiles({
    name: "plate.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, 640, 480),
  });
  await page.getByRole("button", { name: "Save and estimate in background" }).click();
  await expect(page.getByText("Meal saved", { exact: true })).toBeVisible();
  const [queued] = (await meals(page)).filter((meal) => meal.source === "queued" && meal.photoSet);
  const photoSet = queued.photoSet as string;

  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: "Meal from photos" }).getByRole("button", { name: "Edit entry" }).click();
  await expect(page.getByText("Its photos are on the server, waiting for the background estimate.", { exact: false }))
    .toBeVisible();
  await expect(photos(page)).toHaveCount(0);
  await page.getByLabel("Meal description").fill("Large portion");
  await page.getByRole("button", { name: "Save and estimate in background" }).click();
  await expect(page.getByText("Entry updated", { exact: true })).toBeVisible();

  const [again] = (await meals(page)).filter((meal) => meal.id === queued.id);
  expect(again).toMatchObject({ source: "queued", photoSet, assumptions: "Large portion", name: "Meal from photos" });
  expect(sends, "the photos already there are not sent again").toBe(1);
  expect(heldPhotos(photoSet)).toBe(1);

  await page.evaluate(async (id) => {
    await fetch("/api/records", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
  }, queued.id as string);
  expect(heldPhotos(photoSet)).toBe(0);
});

test("photos that cannot be sent save nothing, and stay on the form", async ({ page }) => {
  await page.route("**/api/queued-photos", (route) => route.abort("internetdisconnected"));
  await openMeal(page);
  await loggingFor(page, "Gators").click();
  await page.getByLabel("Library").setInputFiles({
    name: "plate.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, 640, 480),
  });
  await page.getByLabel("Meal description").fill("Large portion");
  const before = (await meals(page)).length;
  await page.getByRole("button", { name: "Save and estimate in background" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "The photos could not be sent, so nothing was saved. Try again with a connection, or estimate now.",
  );
  await expect(photos(page)).toHaveCount(1);
  await expect(page.getByLabel("Meal description")).toHaveValue("Large portion");
  expect((await meals(page)).length).toBe(before);
});
