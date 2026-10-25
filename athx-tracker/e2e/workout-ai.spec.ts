import { expect, test, type Page } from "@playwright/test";
import { PASSPHRASE } from "../playwright.config.ts";
import { DEFAULT_SETTINGS, type Workout } from "../lib/domain.ts";

const blank = { kg: null, sets: null, reps: null };
const draft = {
  title: "AI strength session", category: "Strength", customCategory: "", notes: "Felt strong", assumptions: "",
  elapsed: { hippos: 1200, gators: 1500 }, stations: [],
  lifts: [{ name: "Deadlift", hippos: { kg: 185 * 0.45359237, sets: 1, reps: 2 },
    gators: { kg: 95 * 0.45359237, sets: 3, reps: 8 } }],
};
const selection = (page: Page, name: string) => page.getByRole("group", { name: "Logging for" }).getByRole("button", { name, exact: true });
const fill = (page: Page) => page.getByRole("button", { name: "Fill workout with AI", exact: true });
const lifts = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Lifts", exact: true }) });
const saved = async (page: Page): Promise<Workout[]> => page.evaluate(async () =>
  (await fetch("/api/records").then(r => r.json())).records.filter((r: { kind: string }) => r.kind === "workout"));

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await expect(page.getByRole("button", { name: "Session", exact: true })).toBeVisible();
  await page.evaluate(async settings => {
    const data = await fetch("/api/records").then(r => r.json());
    for (const record of data.records) await fetch("/api/records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id }) });
    const { revision } = await fetch("/api/settings").then(r => r.json());
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings, revision }) });
  }, DEFAULT_SETTINGS);
  await page.reload();
  await selection(page, "Both").click();
  await page.getByRole("button", { name: "Session", exact: true }).click();
});

test("typed workout fills both columns, keeps sets x reps and exact pounds, and saves only on request", async ({ page }) => {
  await page.route("**/api/workout-draft", async route => {
    expect(route.request().postDataJSON()).toEqual({
      description: "Hippos deadlift 1 x 2 at 185 lb; Gators 3 x 8 at 95 lb", athletes: ["hippos", "gators"], weightUnit: "lb",
    });
    await route.fulfill({ json: { draft, provider: "codex" } });
  });
  await page.getByLabel("Workout description").fill("Hippos deadlift 1 x 2 at 185 lb; Gators 3 x 8 at 95 lb");
  await fill(page).click();
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue(draft.title);
  await expect(lifts(page).getByLabel("Sets", { exact: true }).first()).toHaveValue("1");
  await expect(lifts(page).getByLabel("Reps", { exact: true }).first()).toHaveValue("2");
  await expect(lifts(page).getByLabel("lb", { exact: true }).first()).toHaveValue("185");
  await expect(lifts(page).getByLabel("lb", { exact: true }).last()).toHaveValue("95");
  expect(await saved(page)).toEqual([]);
  await lifts(page).getByLabel("Reps", { exact: true }).last().fill("7");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(2);
  const records = await saved(page);
  expect(records.find(w => w.athlete === "hippos")?.lifts).toEqual([{ name: "Deadlift", kg: 185 * 0.45359237, sets: 1, reps: 2 }]);
  expect(records.find(w => w.athlete === "gators")?.lifts[0].reps).toBe(7);
});

test("unknown weights stay empty and must be filled before saving", async ({ page }) => {
  await selection(page, "Hippos").click();
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft: {
    ...draft, elapsed: { hippos: null, gators: 100 }, assumptions: "Add the deadlift weight.",
    lifts: [{ name: "Deadlift", hippos: { kg: null, sets: 1, reps: 2 }, gators: blank }],
  } } }));
  await page.getByLabel("Workout description").fill("Deadlift 1 x 2");
  await fill(page).click();
  await expect(lifts(page).getByLabel("lb", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("missing weight, sets and reps");
  expect(await saved(page)).toEqual([]);
  await lifts(page).getByLabel("lb", { exact: true }).fill("135");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  expect((await saved(page))[0].athlete).toBe("hippos");
});

test("AI failure preserves the description and existing workout fields", async ({ page }) => {
  await page.getByLabel("Session", { exact: true }).fill("My existing workout");
  await page.getByLabel("Hippos elapsed time").fill("25:00");
  await page.getByLabel("Workout description").fill("Deadlift 1 x 2 at 185 lb");
  await page.route("**/api/workout-draft", route => route.fulfill({ status: 503, json: { error: "Estimator unavailable" } }));
  await fill(page).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Estimator unavailable");
  await expect(page.getByLabel("Workout description")).toHaveValue("Deadlift 1 x 2 at 185 lb");
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue("My existing workout");
  await expect(page.getByLabel("Hippos elapsed time")).toHaveValue("25:00");
});

test("mixed workout fills custom lifts, station volume, load and run time", async ({ page }) => {
  await selection(page, "Hippos").click();
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft: {
    ...draft, category: "Mixed", elapsed: { hippos: 1800, gators: null },
    lifts: [{ name: "Cable reverse fly", hippos: { kg: 10, sets: 3, reps: 12 }, gators: blank }],
    stations: [
      { name: "Wall ball", block: "metcon", unit: "reps", target: 30, hippos: { completed: 20, seconds: 120, kg: 6 }, gators: { completed: null, seconds: null, kg: null } },
      { name: "Run", block: "endurance", unit: "m", target: 1000, hippos: { completed: 1000, seconds: 300, kg: null }, gators: { completed: null, seconds: null, kg: null } },
    ],
  } } }));
  await page.getByLabel("Workout description").fill("Cable reverse fly, wall balls and a run");
  await fill(page).click();
  await expect(page.getByLabel("Name it")).toHaveValue("Cable reverse fly");
  await expect(page.getByLabel("Done (reps)")).toHaveValue("20");
  await expect(page.getByLabel("Covered (m)")).toHaveValue("1000");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  const record = (await saved(page))[0];
  expect(record.lifts[0]).toEqual({ name: "Cable reverse fly", kg: 10, sets: 3, reps: 12 });
  expect(record.segments[0].kg).toBe(6);
  expect(record.segments[1].seconds).toBe(300);
});

test("dictation appends words that can be reviewed and submitted to AI", async ({ page }) => {
  await page.addInitScript(() => {
    class Recognition {
      onresult?: (event: unknown) => void;
      onend?: () => void;
      start() { this.onresult?.({ results: [[{ transcript: "deadlift one times two at 185 pounds" }]] }); }
      stop() { this.onend?.(); }
      abort() {}
    }
    Object.assign(window, { SpeechRecognition: Recognition });
  });
  await page.reload();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page.getByLabel("Workout description").fill("Hippos:");
  await page.getByRole("button", { name: "Dictate workout", exact: true }).click();
  await expect(page.getByLabel("Workout description")).toHaveValue("Hippos: deadlift one times two at 185 pounds");
  await expect(fill(page)).toBeDisabled();
  await page.getByRole("button", { name: "Stop dictation", exact: true }).click();
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft } }));
  await fill(page).click();
  await expect(lifts(page).getByLabel("Sets", { exact: true }).first()).toHaveValue("1");
  await expect(lifts(page).getByLabel("Reps", { exact: true }).first()).toHaveValue("2");
});

test("workout API rejects invalid input and unauthenticated requests", async ({ page, request }) => {
  expect((await request.post("/api/workout-draft", { data: { description: "Deadlift" } })).status()).toBe(401);
  const statuses = await page.evaluate(async () => Promise.all([
    { description: "Hi", athletes: ["hippos"], weightUnit: "lb" },
    { description: "Deadlift", athletes: ["team"], weightUnit: "lb" },
    { description: "Deadlift", athletes: ["hippos", "hippos"], weightUnit: "lb" },
    { description: "Deadlift", athletes: ["hippos"], weightUnit: "stone" },
  ].map(body => fetch("/api/workout-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.status))));
  expect(statuses).toEqual([400, 400, 400, 400]);
});

test("changing athletes during an AI request discards its old response", async ({ page }) => {
  let release = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/workout-draft", async route => {
    await waiting;
    await route.fulfill({ json: { draft } }).catch(() => {});
  });
  await page.getByLabel("Session", { exact: true }).fill("Keep this workout");
  await page.getByLabel("Workout description").fill("Deadlift 1 x 2 at 185 lb");
  const requested = page.waitForRequest("**/api/workout-draft");
  await fill(page).click();
  await requested;
  await selection(page, "Gators").click();
  release();
  await expect(page.locator("form").getByRole("alert")).toContainText("athlete selection changed");
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue("Keep this workout");
  expect(await saved(page)).toEqual([]);
});

test("blocked dictation keeps text editable and offers the keyboard microphone", async ({ page }) => {
  await page.addInitScript(() => {
    class Recognition {
      onerror?: (event: unknown) => void;
      onend?: () => void;
      start() { this.onerror?.({ error: "not-allowed" }); this.onend?.(); }
      stop() { this.onend?.(); }
      abort() {}
    }
    Object.assign(window, { SpeechRecognition: Recognition });
  });
  await page.reload();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page.getByLabel("Workout description").fill("Deadlift 1 x 2");
  await page.getByRole("button", { name: "Dictate workout", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Microphone access was blocked");
  await expect(page.getByLabel("Workout description")).toBeEnabled();
  await expect(page.getByLabel("Workout description")).toHaveValue("Deadlift 1 x 2");
});

test("AI names snap to the exercise list and a far one is called out in the notes", async ({ page }) => {
  await selection(page, "Hippos").click();
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft: {
    ...draft, category: "Mixed", elapsed: { hippos: 1800, gators: null }, notes: "",
    lifts: [
      { name: "deadlifts", hippos: { kg: 100, sets: 1, reps: 2 }, gators: blank },
      { name: "bak squat", hippos: { kg: 80, sets: 3, reps: 5 }, gators: blank },
      { name: "cable reverse fly", hippos: { kg: 10, sets: 3, reps: 12 }, gators: blank },
    ],
    stations: [
      { name: "wallballs", block: "metcon", unit: "reps", target: 30, hippos: { completed: 20, seconds: null, kg: 6 }, gators: { completed: null, seconds: null, kg: null } },
    ],
  } } }));
  await page.getByLabel("Workout description").fill("deadlifts, a bak squat, wall balls and cable reverse fly");
  await fill(page).click();
  const liftNames = page.getByLabel("Lift", { exact: true });
  await expect(liftNames.nth(0)).toHaveValue("Deadlift");
  await expect(liftNames.nth(1)).toHaveValue("Back squat");
  await expect(liftNames.nth(2)).toHaveValue("Other");
  await expect(page.getByLabel("Name it")).toHaveValue("cable reverse fly");
  await expect(page.getByLabel("Station", { exact: true })).toHaveValue("Wall ball");
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue('Left as typed: "cable reverse fly" is not in the list.');
});

test("AI workout form fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft } }));
  await page.getByLabel("Workout description").fill("Hippos deadlift 1 x 2 at 185 lb; Gators 3 x 8 at 95 lb");
  await fill(page).click();
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue(draft.title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/workout-ai-mobile.png", fullPage: true });
});
