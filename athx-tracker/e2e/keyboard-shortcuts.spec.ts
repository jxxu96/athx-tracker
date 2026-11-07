import { expect, test } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
});

test("desktop shortcuts select athletes, sections, and sittings until turned off", async ({ page }) => {
  const header = page.getByRole("banner");
  const toggle = header.getByRole("button", { name: "Keyboard shortcuts" });
  const sections = page.getByRole("navigation", { name: "Sections" });
  const athletes = header.getByRole("group", { name: "Logging for" });
  const sittings = page.getByRole("group", { name: "Sitting" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(header.getByRole("button").first()).toHaveAccessibleName("Refresh from the server");

  for (const [key, name] of [["g", "Gators"], ["h", "Hippos"]]) {
    await page.keyboard.press(key);
    await expect(athletes.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  }

  await page.keyboard.press("m");
  const meal = sections.getByRole("button", { name: "Meal" });
  await expect(meal).toHaveAttribute("aria-current", "page");
  for (const [key, name] of [["b", "Breakfast"], ["l", "Lunch"], ["d", "Dinner"], ["s", "Snack"], ["a", "Alcohol"]]) {
    await page.keyboard.press(key);
    await expect(sittings.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  }

  await page.keyboard.press("p");
  await expect(sections.getByRole("button", { name: "Progress" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("b");
  await page.keyboard.press("t");
  await expect(sections.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("m");
  await expect(sittings.getByRole("button", { name: "Alcohol" })).toHaveAttribute("aria-pressed", "true");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("b");
  await page.keyboard.press("p");
  await expect(meal).toHaveAttribute("aria-current", "page");
  await expect(sittings.getByRole("button", { name: "Alcohol" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("m");
  await expect(sections.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("m");
  await expect(meal).toHaveAttribute("aria-current", "page");
});

test("setup lists every shortcut and does not edit them", async ({ page }) => {
  await page.getByRole("button", { name: "Setup", exact: true }).click();
  const list = page.getByRole("region", { name: "Keyboard shortcuts" });
  // Headings, not labelled groups: a group named Meal or Session is also the
  // name of a field, and a hidden Setup still counts for an exact label.
  const group = (title: string) =>
    list.getByRole("heading", { name: title, exact: true }).locator("..");
  const anywhere = group("Anywhere");
  const today = group("Today");
  const session = group("Session");
  const meal = group("Meal");

  await expect(anywhere.getByText("Log for Gators")).toBeVisible();
  await expect(anywhere.getByText("Log for both")).toBeVisible();
  await expect(anywhere.locator("kbd")).toHaveText(["G", "H", "V", "W", "M", "T", "P"]);
  await expect(today.locator("kbd")).toHaveText(["Y"]);
  await expect(today.getByText("Energy for yesterday")).toBeVisible();
  await expect(session.locator("kbd")).toHaveText(["D", "Y"]);
  await expect(meal.locator("kbd")).toHaveText(["B", "L", "D", "S", "A", "Y"]);
  await expect(meal.getByText("Dinner")).toBeVisible();
  await expect(list.locator("input, textarea, select")).toHaveCount(0);
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(list.getByRole("textbox")).toHaveCount(0);
});

test("fields, open calendars, and modifier keys take priority over shortcuts", async ({ page }) => {
  const toggle = page.getByRole("button", { name: "Keyboard shortcuts" });
  const sections = page.getByRole("navigation", { name: "Sections" });
  const meal = sections.getByRole("button", { name: "Meal" });
  const session = sections.getByRole("button", { name: "Session" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("m");
  await expect(meal).toHaveAttribute("aria-current", "page");

  const sittings = page.getByRole("group", { name: "Sitting" });
  await page.keyboard.press("b");
  const breakfast = sittings.getByRole("button", { name: "Breakfast" });
  await expect(breakfast).toHaveAttribute("aria-pressed", "true");
  const description = page.getByRole("textbox", { name: "Meal description" });
  await description.pressSequentially("g h w m t p b l d s a");
  await expect(description).toHaveValue("g h w m t p b l d s a");
  await expect(breakfast).toHaveAttribute("aria-pressed", "true");
  await expect(meal).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("banner").getByRole("button", { name: "Hippos" })).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Calories (kcal)").press("p");
  await expect(meal).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const calendar = page.getByRole("dialog");
  await expect(calendar).toBeVisible();
  await page.keyboard.press("p");
  await page.keyboard.press("w");
  await page.keyboard.press("l");
  await expect(calendar).toBeVisible();
  await expect(breakfast).toHaveAttribute("aria-pressed", "true");
  await expect(meal).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");

  await page.keyboard.press("w");
  await expect(session).toHaveAttribute("aria-current", "page");
  const workout = page.getByRole("textbox", { name: "Workout description" });
  await workout.pressSequentially("m t p");
  await expect(workout).toHaveValue("m t p");
  await expect(session).toHaveAttribute("aria-current", "page");
  await session.focus();
  await page.keyboard.press("Alt+p");
  await expect(session).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("p");
  await expect(sections.getByRole("button", { name: "Progress" })).toHaveAttribute("aria-current", "page");
});

test.describe("touch-only browsers", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("hide and disable desktop shortcuts", async ({ page }) => {
    const sections = page.getByRole("navigation", { name: "Sections" });
    await expect(sections.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await page.keyboard.press("m");
    await expect(sections.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });
});
