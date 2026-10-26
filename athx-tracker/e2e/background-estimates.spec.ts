import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

const meal = {
  name: "Background rice bowl", calories: 600, protein: 40, carbs: 65, fat: 20,
  assumptions: "One bowl of chicken and rice.", confidence: "medium",
};
const workout = {
  title: "Background deadlifts", category: "Strength", customCategory: "", notes: "", assumptions: "",
  elapsed: { hippos: 1200, gators: null }, stations: [],
  lifts: [{ name: "Deadlift", hippos: { kg: 60, sets: 3, reps: 5 },
    gators: { kg: null, sets: null, reps: null } }],
};
const section = (page: Page, name: string) => page.getByRole("navigation", { name: "Sections" })
  .getByRole("button", { name, exact: true });
const notice = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const records = (page: Page) => page.evaluate(async () => (await fetch("/api/records").then(r => r.json())).records);
function gate() {
  let release = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  return { waiting, release };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(section(page, "Today")).toHaveAttribute("aria-current", "page");
});

test("meal and session run concurrently across tabs and each popup opens its retained result", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await records(page);
  const mealGate = gate();
  const sessionGate = gate();
  let mealCalls = 0;
  let sessionCalls = 0;
  await page.route("**/api/estimate", async route => {
    mealCalls++;
    await mealGate.waiting;
    await route.fulfill({ json: { estimate: meal, provider: "codex" } });
  });
  await page.route("**/api/workout-draft", async route => {
    sessionCalls++;
    await sessionGate.waiting;
    await route.fulfill({ json: { draft: workout } });
  });
  await section(page, "Session").click();
  await page.getByRole("group", { name: "Date" }).getByRole("button", { name: "Yesterday", exact: true }).click();
  await page.getByLabel("Workout description").fill("Deadlift 3 x 5 at 60 kg");
  await page.getByRole("button", { name: "Fill workout with AI", exact: true }).click();
  await expect.poll(() => sessionCalls).toBe(1);
  await section(page, "Meal").click();
  await page.getByLabel("Meal description").fill("Chicken and rice bowl");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect.poll(() => mealCalls).toBe(1);
  await section(page, "Log").click();
  await section(page, "Session").click();
  await expect(page.getByRole("button", { name: "Filling workout…", exact: true })).toBeDisabled();
  await section(page, "Meal").click();
  await expect(page.getByRole("button", { name: "Estimating…", exact: true })).toBeDisabled();
  await section(page, "Progress").click();
  mealGate.release();
  sessionGate.release();
  await expect(notice(page, "Meal estimate ready")).toBeVisible();
  await expect(notice(page, "Session estimate ready")).toBeVisible();
  await expect(section(page, "Progress")).toHaveAttribute("aria-current", "page");
  await expect(notice(page, "Meal estimate ready")).toHaveAttribute("data-mounted", "true");
  await expect(notice(page, "Session estimate ready")).toHaveAttribute("data-mounted", "true");
  await page.screenshot({ path: "test-results/background-estimates-mobile.png", animations: "disabled" });
  expect(await records(page)).toEqual(before);
  await notice(page, "Meal estimate ready").getByRole("button", { name: "View meal" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("600");
  await expect(page.getByLabel("Meal description")).toHaveValue("Chicken and rice bowl");
  await expect(page.getByLabel("Assumptions")).toHaveValue(meal.assumptions);
  await notice(page, "Session estimate ready").getByRole("button", { name: "View session" }).click();
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue(workout.title);
  await expect(page.getByLabel("Workout description")).toHaveValue("Deadlift 3 x 5 at 60 kg");
  await expect(page.getByLabel("Hippos elapsed time")).toHaveValue("20:00");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(section(page, "Today")).toHaveAttribute("aria-current", "page");
  await section(page, "Meal").click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("600");
  await section(page, "Session").click();
  await expect(page.getByRole("group", { name: "Date" }).getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Workout description")).toHaveValue("");
  expect(mealCalls).toBe(1);
  expect(sessionCalls).toBe(1);
});

test("leaving Session stops dictation while keeping its words", async ({ page }) => {
  await page.addInitScript(() => {
    class Recognition {
      onresult?: (event: unknown) => void;
      onend?: () => void;
      start() { this.onresult?.({ results: [[{ transcript: "deadlift three sets of five" }]] }); }
      stop() { this.onend?.(); }
      abort() {}
    }
    Object.assign(window, { SpeechRecognition: Recognition });
  });
  await page.reload();
  await section(page, "Session").click();
  await page.getByRole("button", { name: "Dictate workout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop dictation", exact: true })).toBeVisible();
  await section(page, "Meal").click();
  await section(page, "Session").click();
  await expect(page.getByRole("button", { name: "Dictate workout", exact: true })).toBeVisible();
  await expect(page.getByLabel("Workout description")).toHaveValue("deadlift three sets of five");
  await expect(page.getByLabel("Workout description")).toBeEnabled();
});

for (const kind of ["Meal", "Session"] as const) {
  const isMeal = kind === "Meal";
  const endpoint = isMeal ? "**/api/estimate" : "**/api/workout-draft";
  const description = isMeal ? "Meal description" : "Workout description";
  const fill = isMeal ? "Estimate macros" : "Fill workout with AI";

  test(`${kind} returning before completion keeps the request and suppresses the background popup`, async ({ page }) => {
    const pending = gate();
    let calls = 0;
    await page.route(endpoint, async route => {
      calls++;
      await pending.waiting;
      await route.fulfill({ json: isMeal ? { estimate: meal } : { draft: workout } });
    });
    await section(page, kind).click();
    await page.getByLabel(description).fill("A detailed description to estimate");
    await page.getByRole("button", { name: fill, exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    await section(page, "Today").click();
    await section(page, kind).click();
    pending.release();
    await expect(page.getByLabel(isMeal ? "Meal" : "Session", { exact: true })).toHaveValue(isMeal ? meal.name : workout.title);
    await expect(notice(page, `${kind} estimate ready`)).toHaveCount(0);
    await section(page, "Setup").click();
    await section(page, kind).click();
    await expect(page.getByLabel(isMeal ? "Meal" : "Session", { exact: true })).toHaveValue(isMeal ? meal.name : workout.title);
    expect(calls).toBe(1);
  });

  test(`${kind} background failure offers a return action and preserves the description for retry`, async ({ page }) => {
    const pending = gate();
    await page.route(endpoint, async route => {
      await pending.waiting;
      await route.fulfill({ status: 503, json: { error: "Estimator unavailable" } });
    });
    await section(page, kind).click();
    await page.getByLabel(description).fill("Keep this description for retry");
    const requested = page.waitForRequest(endpoint);
    await page.getByRole("button", { name: fill, exact: true }).click();
    await requested;
    await section(page, "Today").click();
    pending.release();
    const popup = notice(page, `${kind} estimate failed`);
    await expect(popup).toContainText("Estimator unavailable");
    await popup.getByRole("button", { name: `View ${kind.toLowerCase()}` }).click();
    await expect(page.getByLabel(description)).toHaveValue("Keep this description for retry");
    await expect(page.locator("form").getByRole("alert")).toHaveText("Estimator unavailable");
    await page.route(endpoint, route => route.fulfill({ json: isMeal ? { estimate: meal } : { draft: workout } }));
    await page.getByRole("button", { name: fill, exact: true }).click();
    await expect(page.getByLabel(isMeal ? "Meal" : "Session", { exact: true })).toHaveValue(isMeal ? meal.name : workout.title);
  });
}

test("editing and saving a session keeps the pending meal estimate alive", async ({ page }) => {
  await page.evaluate(async () => {
    await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      id: crypto.randomUUID(), kind: "workout", athlete: "hippos", day: "2026-10-20", title: "Edit while estimating",
      category: "Tennis", seconds: 3600, notes: "", segments: [], fatigue: 10, transition: 0, goal: null, context: "solo", lifts: [],
    }) });
  });
  await page.reload();
  const pending = gate();
  await page.route("**/api/estimate", async route => {
    await pending.waiting;
    await route.fulfill({ json: { estimate: meal } });
  });
  await section(page, "Meal").click();
  await page.getByLabel("Meal description").fill("Chicken and rice bowl");
  const requested = page.waitForRequest("**/api/estimate");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await requested;
  await section(page, "Log").click();
  await page.getByRole("listitem").filter({ hasText: "Edit while estimating" }).getByLabel("Edit entry").click();
  await page.getByRole("button", { name: "Update session", exact: true }).click();
  await expect(section(page, "Today")).toHaveAttribute("aria-current", "page");
  pending.release();
  await notice(page, "Meal estimate ready").getByRole("button", { name: "View meal" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("600");
});

test("a meal refinement continues after closing the conversation and changing tabs", async ({ page }) => {
  const pending = gate();
  let calls = 0;
  await page.route("**/api/estimate", async route => {
    if (++calls === 2) await pending.waiting;
    await route.fulfill({ json: { estimate: { ...meal, calories: calls === 1 ? 600 : 450 } } });
  });
  await section(page, "Meal").click();
  await page.getByLabel("Meal description").fill("Chicken and rice bowl");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await page.getByRole("button", { name: "Reply to estimate" }).click();
  await page.getByLabel("Your reply").fill("Half the rice");
  await page.getByRole("button", { name: "Send & re-estimate" }).click();
  await expect.poll(() => calls).toBe(2);
  await page.getByRole("button", { name: "Back to meal" }).click();
  await section(page, "Log").click();
  pending.release();
  await notice(page, "Meal estimate ready").getByRole("button", { name: "View meal" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("450");
  await page.getByRole("button", { name: "Reply to estimate" }).click();
  await expect(page.getByRole("log").getByText("Half the rice", { exact: true })).toBeVisible();
});
