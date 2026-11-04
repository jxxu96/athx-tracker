import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";

const bowl = (calories: number, confidence = "medium") => ({
  name: "Rice bowl", calories, protein: 30, carbs: 60, fat: 20, fiber: 0, alcohol: 0,
  assumptions: `About ${calories} kcal.`, confidence,
});

type Held = {
  push: (event: unknown) => void;
  end: () => void;
  stopped: boolean;
  requests: number;
};

/**
 * page.route answers all at once, so it cannot show one estimator landing
 * before another. This stands in for the stream instead: the spec pushes each
 * line when it likes, and sees whether the form hung up.
 */
async function holdEstimates(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch;
    const held = { requests: 0, stopped: false } as unknown as Held;
    Object.assign(window, { held });
    window.fetch = async (input, init) => {
      if (!String(input instanceof Request ? input.url : input).endsWith("/api/estimate")) return original(input, init);
      held.requests++;
      held.stopped = false;
      let lines!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start: (controller) => { lines = controller; } });
      held.push = (event) => lines.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
      held.end = () => lines.close();
      init?.signal?.addEventListener("abort", () => {
        held.stopped = true;
        lines.error(new DOMException("The user aborted a request.", "AbortError"));
      });
      return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
    };
  });
}

const push = (page: Page, event: unknown) =>
  page.evaluate((line) => (window as unknown as { held: Held }).held.push(line), event);
const held = (page: Page) => page.evaluate(() => {
  const { requests, stopped } = (window as unknown as { held: Held }).held;
  return { requests, stopped };
});
const section = (page: Page, name: string) => page.getByRole("navigation", { name: "Sections" })
  .getByRole("button", { name, exact: true });
const notice = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(section(page, "Today")).toHaveAttribute("aria-current", "page");
}

test("each estimator's answer shows as it lands, and the settled one fills the meal", async ({ page }) => {
  await holdEstimates(page);
  await signIn(page);
  await section(page, "Meal").click();
  await page.getByLabel("Meal description").fill("Rice, beans, cheese");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect.poll(() => held(page)).toEqual({ requests: 1, stopped: false });

  const soFar = page.getByRole("status", { name: "Answers so far" });
  await push(page, { type: "partial", provider: "codex", estimate: bowl(600) });
  await expect(soFar.locator("p.font-bold")).toHaveText(["Codex"]);
  await expect(soFar).toContainText("600 kcal · 30 g protein · 60 g carbs · 20 g fat · medium confidence");
  await expect(soFar).toContainText("About 600 kcal.");
  await push(page, { type: "partial", provider: "grok", estimate: bowl(1100, "low") });
  await push(page, { type: "partial", provider: "claude", estimate: bowl(700) });
  const answers = soFar.getByRole("listitem");
  await expect(answers).toHaveCount(3);
  await expect(answers.nth(0).locator("p.font-bold")).toHaveText("Codex");
  await expect(answers.nth(0)).toContainText("About 600 kcal.");
  await expect(answers.nth(1).locator("p.font-bold")).toHaveText("Claude");
  await expect(answers.nth(1)).toContainText("About 700 kcal.");
  await expect(answers.nth(2).locator("p.font-bold")).toHaveText("Grok");
  await expect(answers.nth(2)).toContainText("About 1100 kcal.");
  await expect(answers.nth(2)).toContainText("low confidence");
  await expect(soFar.getByText("________", { exact: true })).toHaveCount(3);
  // Shown, not applied: the meal waits for the settled answer. Each model's
  // totals sit above the box those settled figures are typed into.
  const calories = page.getByLabel("Calories (kcal)");
  await expect(calories).toHaveValue("");
  expect((await soFar.boundingBox())!.y).toBeLessThan((await calories.boundingBox())!.y);

  await push(page, { type: "done", provider: "average", estimate: bowl(760) });
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("760");
  await expect(page.getByText("Averaged across estimators")).toBeVisible();
  // Nobody found a label, so all three stay in the average. Grok was less sure
  // and is still included, because this meal has three items.
  await expect(soFar.getByRole("checkbox", { name: "Include Codex" })).toBeChecked();
  await expect(soFar.getByRole("checkbox", { name: "Include Claude" })).toBeChecked();
  await expect(soFar.getByRole("checkbox", { name: "Include Grok" })).toBeChecked();
  await expect(soFar.getByLabel("Codex weight")).toHaveValue("40");
  await expect(answers).toHaveCount(3);
  await expect(soFar.getByText("About 600 kcal.")).toBeVisible();
  await expect(soFar.getByText("About 700 kcal.")).toBeVisible();
  await expect(soFar.getByText("About 1100 kcal.")).toBeVisible();
});

test("a label is the estimate, and the other answers can be included and reweighted", async ({ page }) => {
  await holdEstimates(page);
  await signIn(page);
  await section(page, "Meal").click();
  await page.getByLabel("Meal description").fill("Rice, beans, cheese");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await push(page, { type: "partial", provider: "codex", estimate: bowl(600, "low") });
  await push(page, { type: "partial", provider: "claude", estimate: bowl(700, "high") });
  await push(page, { type: "partial", provider: "grok", estimate: bowl(1100, "low") });
  // The settled payload still averages everyone. The form keeps the label.
  await push(page, { type: "done", provider: "average", estimate: bowl(866) });

  const soFar = page.getByRole("status", { name: "Answers so far" });
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("700");
  await expect(page.getByText("Answered by Claude")).toBeVisible();
  await expect(soFar.getByRole("checkbox", { name: "Include Codex" })).not.toBeChecked();
  const claude = soFar.getByRole("checkbox", { name: "Include Claude" });
  await expect(claude).toBeChecked();
  await expect(claude).toBeDisabled();
  await expect(soFar.getByRole("checkbox", { name: "Include Grok" })).not.toBeChecked();
  await expect(soFar.getByText("About 600 kcal.")).toBeVisible();
  await expect(soFar.getByText("About 1100 kcal.")).toBeVisible();

  await soFar.getByRole("checkbox", { name: "Include Codex" }).check();
  // 600 x 40 and 700 x 35, over the 75 those two weights add up to.
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("646.7");
  await expect(page.getByText("Averaged across estimators")).toBeVisible();
  await expect(claude).toBeEnabled();

  await soFar.getByLabel("Codex weight").fill("10");
  // 600 x 10 and 700 x 35, over 45.
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("677.8");

  await soFar.getByRole("checkbox", { name: "Include Codex" }).uncheck();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("700");
  await expect(page.getByText("Answered by Claude")).toBeVisible();

  // The weight that was typed is the default for the next estimate.
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await push(page, { type: "partial", provider: "codex", estimate: bowl(600) });
  await push(page, { type: "partial", provider: "claude", estimate: bowl(700) });
  await push(page, { type: "done", provider: "average", estimate: bowl(650) });
  await expect(soFar.getByLabel("Codex weight")).toHaveValue("10");
  await expect(soFar.getByLabel("Claude weight")).toHaveValue("35");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("677.8");
});

test("Stop ends the estimate and leaves the meal to edit", async ({ page }) => {
  await holdEstimates(page);
  await signIn(page);
  await section(page, "Meal").click();
  await page.getByLabel("Meal description").fill("Rice bowl");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await push(page, { type: "partial", provider: "codex", estimate: bowl(600, "low") });
  await expect(page.getByLabel("Meal description")).toBeDisabled();

  await page.getByRole("button", { name: "Stop estimate", exact: true }).click();
  await expect.poll(async () => (await held(page)).stopped).toBe(true);
  await expect(page.getByLabel("Meal description")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop estimate" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Answers so far" })).toHaveCount(0);
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("");

  await page.getByLabel("Meal description").fill("Rice bowl, 200 g rice");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect.poll(async () => (await held(page)).requests).toBe(2);
  await section(page, "Today").click();
  await push(page, { type: "done", provider: "codex", estimate: bowl(640) });
  await notice(page, "Meal estimate ready").getByRole("button", { name: "View meal" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("640");
});

test("a stopped estimate raises no popup on another tab", async ({ page }) => {
  await holdEstimates(page);
  await signIn(page);
  await section(page, "Meal").click();
  await page.getByLabel("Meal description").fill("Rice bowl");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await page.getByRole("button", { name: "Stop estimate", exact: true }).click();
  await expect.poll(async () => (await held(page)).stopped).toBe(true);
  await section(page, "Log").click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "estimate" })).toHaveCount(0);
});

test("saving mid-estimate hands it to the background, and a popup says when it is filled", async ({ page }) => {
  await holdEstimates(page);
  await signIn(page);
  await section(page, "Meal").click();
  await page.getByLabel("Meal description").fill("Background rice bowl with chicken");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect.poll(() => held(page)).toEqual({ requests: 1, stopped: false });

  await page.getByRole("button", { name: "Save and estimate in background", exact: true }).click();
  await expect(section(page, "Today")).toHaveAttribute("aria-current", "page");
  expect((await held(page)).stopped).toBe(true);
  const saved = await page.evaluate(async () =>
    (await fetch("/api/records").then((r) => r.json())).records
      .find((record: { assumptions: string }) => record.assumptions === "Background rice bowl with chicken"));
  expect(saved).toMatchObject({ source: "queued", macros: { calories: 0 } });

  // The worker fills it on the server, as it would with an estimator running.
  await page.evaluate(async (record) => {
    await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...record, name: "Background rice bowl", source: "grok", estimator: "average",
        macros: { calories: 720, protein: 45, carbs: 70, fat: 22, alcohol: 0, fiber: 3 },
        assumptions: "Averaged.",
      }),
    });
  }, saved);
  await section(page, "Progress").click();
  await page.getByRole("button", { name: "Refresh from the server" }).click();
  const popup = notice(page, "Meal estimate ready");
  await expect(popup).toContainText("Background rice bowl");
  await popup.getByRole("button", { name: "View meal" }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("720");

  // Today's meal, and every spec shares one journal: Fuel's would count it.
  await page.evaluate(async (id) => {
    await fetch("/api/records", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
  }, saved.id);
});

test("the background estimate is offered from the start, and not once there is an estimate", async ({ page }) => {
  await page.route("**/api/estimate", (route) => route.fulfill({ json: { estimate: bowl(600) } }));
  await signIn(page);
  await section(page, "Meal").click();
  const later = page.getByRole("button", { name: "Save and estimate in background", exact: true });
  await expect(later).toBeDisabled();
  await page.getByLabel("Meal description").fill("Rice bowl");
  await expect(later).toBeEnabled();
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("600");
  await expect(later).toHaveCount(0);
});
