import { expect, test, type Page } from "@playwright/test";
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
  await expect(today.locator("kbd")).toHaveText(["B", "L", "D", "Y"]);
  await expect(today.getByText("Energy at breakfast")).toBeVisible();
  await expect(today.getByText("Energy at dinner")).toBeVisible();
  await expect(today.getByText("Energy for yesterday")).toBeVisible();
  await expect(session.locator("kbd")).toHaveText(["D", "Y", "Alt+E", "Alt+S"]);
  await expect(session.getByText("Fill workout with AI")).toBeVisible();
  await expect(session.getByText("Save session")).toBeVisible();
  await expect(meal.locator("kbd")).toHaveText(["B", "L", "D", "S", "A", "Y", "Alt+E", "Alt+S"]);
  await expect(meal.getByText("Save meal")).toBeVisible();
  await expect(meal.getByText("Dinner")).toBeVisible();
  await expect(meal.getByText("Estimate macros")).toBeVisible();
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

const estimate = { name: "Shortcut oats", calories: 420, protein: 18, carbs: 60, fat: 12,
  assumptions: "Oats with milk", confidence: "medium" };
const workoutDraft = {
  title: "Shortcut deadlifts", category: "Strength", customCategory: "", notes: "", assumptions: "",
  elapsed: { hippos: 600, gators: null }, stations: [],
  lifts: [{ name: "Deadlift", hippos: { kg: 100, sets: 3, reps: 5 }, gators: { kg: null, sets: null, reps: null } }],
};

test("Alt+E runs the estimator from the description on Meal and Session", async ({ page }) => {
  const estimates: unknown[] = [];
  await page.route("**/api/estimate", (route) => {
    estimates.push(route.request().postDataJSON());
    return route.fulfill({ json: { estimate, provider: "codex" } });
  });
  const drafts: unknown[] = [];
  await page.route("**/api/workout-draft", (route) => {
    drafts.push(route.request().postDataJSON());
    return route.fulfill({ json: { draft: workoutDraft, provider: "codex" } });
  });
  const toggle = page.getByRole("button", { name: "Keyboard shortcuts" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAttribute("title", /Alt\+E Estimate, Alt\+S Save/);

  await page.keyboard.press("m");
  const description = page.getByRole("textbox", { name: "Meal description" });
  // Too short for the button, so too short for the chord.
  await description.fill("oa");
  await description.press("Alt+e");
  await description.press("Meta+e");
  await description.fill("Oats with milk");
  // Command is the Mac chord, not this one.
  await description.press("Meta+e");
  await description.press("Control+Alt+e");
  expect(estimates).toHaveLength(0);
  await description.press("Alt+e");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("420");
  await expect(description).toHaveValue("Oats with milk");
  expect(estimates).toHaveLength(1);
  expect(estimates[0]).toMatchObject({ description: "Oats with milk" });

  await toggle.click();
  await description.focus();
  await description.press("Alt+e");
  await toggle.click();
  expect(estimates).toHaveLength(1);

  await page.keyboard.press("w");
  const workout = page.getByRole("textbox", { name: "Workout description" });
  await workout.fill("Deadlift 3 x 5 at 100 kg");
  await workout.press("Alt+e");
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue(workoutDraft.title);
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({ description: "Deadlift 3 x 5 at 100 kg" });
  // Only the open form answers: Meal's estimate did not run again.
  expect(estimates).toHaveLength(1);
});

const records = (page: Page) => page.evaluate(async () =>
  (await fetch("/api/records").then((r) => r.json())).records as { kind: string; name?: string; title?: string; macros?: { calories: number } }[]);

test("Alt+S saves the open form from inside a field, through the form's own checks", async ({ page }) => {
  // The database outlives a test, so each run saves under its own names.
  const meal = `Shortcut toast ${Date.now()}`;
  const draft = { ...workoutDraft, title: `Shortcut deadlifts ${Date.now()}` };
  const toggle = page.getByRole("button", { name: "Keyboard shortcuts" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("m");
  const name = page.getByLabel("Meal", { exact: true });
  const calories = page.getByLabel("Calories (kcal)");
  await calories.fill("210");
  // Unnamed, it is refused just as the button would refuse it.
  await calories.press("Alt+s");
  await expect(page.getByRole("alert").filter({ hasText: "Name the meal, or run an estimate first." })).toBeVisible();
  await name.fill(meal);
  await calories.press("Alt+s");
  await expect(name).toHaveValue("");
  await expect.poll(async () => (await records(page))
    .filter((record) => record.name === meal).map((record) => record.macros?.calories)).toEqual([210]);

  await page.route("**/api/workout-draft", (route) => route.fulfill({ json: { draft, provider: "codex" } }));
  await page.keyboard.press("w");
  const workout = page.getByRole("textbox", { name: "Workout description" });
  await workout.fill("Deadlift 3 x 5 at 100 kg");
  await workout.press("Alt+e");
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue(draft.title);
  await workout.press("Alt+s");
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue("");
  await expect.poll(async () => (await records(page))
    .filter((record) => record.title === draft.title).length).toBe(1);
});

test.describe("on a Mac", () => {
  test.beforeEach(async ({ page }) => {
    const toggle = page.getByRole("button", { name: "Keyboard shortcuts" });
    // Signed in first, or the reload lands back on the login page.
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" }));
    await page.reload();
    // Pressed before hydration, a key reaches no listener.
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("Command+E runs the estimator, and Option+E is left to type accents", async ({ page }) => {
    const estimates: unknown[] = [];
    await page.route("**/api/estimate", (route) => {
      estimates.push(route.request().postDataJSON());
      return route.fulfill({ json: { estimate, provider: "codex" } });
    });
    await page.keyboard.press("m");
    const description = page.getByRole("textbox", { name: "Meal description" });
    await description.fill("Oats with milk");
    await description.press("Alt+e");
    expect(estimates).toHaveLength(0);
    await description.press("Meta+e");
    await expect(page.getByLabel("Calories (kcal)")).toHaveValue("420");
    expect(estimates).toHaveLength(1);

    await page.getByRole("button", { name: "Setup", exact: true }).click();
    const list = page.getByRole("region", { name: "Keyboard shortcuts" });
    const meal = list.getByRole("heading", { name: "Meal", exact: true }).locator("..");
    await expect(meal.locator("kbd")).toHaveText(["B", "L", "D", "S", "A", "Y", "⌘E", "⌘S"]);
  });
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
