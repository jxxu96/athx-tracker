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
const stations = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "MetCon and endurance", exact: true }) });
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
      // No weight is known, which still asks for a burn: a watch's figure needs none.
      bodyweightKg: {},
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

test("a weight, sets or reps never said stay empty and save as unweighted or none", async ({ page }) => {
  await selection(page, "Gators").click();
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft: {
    ...draft, elapsed: { hippos: null, gators: null }, assumptions: "Pull-up load was not stated.",
    lifts: [
      { name: "Bench press", hippos: blank, gators: { kg: 175 * 0.45359237, sets: 5, reps: 5 } },
      { name: "Pull-up", hippos: blank, gators: { kg: null, sets: 3, reps: 8 } },
      { name: "Dumbbell row", hippos: blank, gators: { kg: 60 * 0.45359237, sets: 3, reps: null } },
    ],
  } } }));
  await page.getByLabel("Workout description").fill("Bench 5x5 at 175, pull-ups 3x8, rows at 60");
  await fill(page).click();
  await expect(lifts(page).getByLabel("lb", { exact: true }).nth(1)).toHaveValue("");
  await expect(lifts(page).getByLabel("Reps", { exact: true }).nth(2)).toHaveValue("");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  expect((await saved(page))[0].lifts).toEqual([
    { name: "Bench press", kg: 175 * 0.45359237, sets: 5, reps: 5 },
    { name: "Pull-up", kg: 0, sets: 3, reps: 8 },
    { name: "Dumbbell row", kg: 60 * 0.45359237, sets: 3, reps: 0 },
  ]);
  // The log says what was recorded, never "0 lb" or "×0".
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText("Bench press 175 lb 5×5 · Pull-up 3×8 · Dumbbell row 60 lb 3 sets")).toBeVisible();
  // Opened again, what was left blank is blank.
  await page.getByRole("listitem").filter({ hasText: "Pull-up 3×8" }).getByLabel("Edit entry").click();
  await expect(lifts(page).getByLabel("lb", { exact: true }).nth(1)).toHaveValue("");
  await expect(lifts(page).getByLabel("Reps", { exact: true }).nth(2)).toHaveValue("");
});

test("sets that differ fill a row each, and reps never said save as none", async ({ page }) => {
  const lb = 0.45359237;
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft: {
    ...draft, elapsed: { hippos: null, gators: null },
    lifts: [{ name: "Back squat",
      hippos: { kg: null, sets: null, reps: null,
        detail: [{ kg: 135 * lb, reps: 5 }, { kg: 185 * lb, reps: 3 }, { kg: 225 * lb, reps: null }] },
      gators: { kg: null, sets: null, reps: null,
        detail: [{ kg: 95 * lb, reps: 8 }, { kg: 95 * lb, reps: 8 }, { kg: 95 * lb, reps: 8 }] } }],
  } } }));
  await page.getByLabel("Workout description").fill("Hippos squat 5x135, 3x185, then 225; Gators 3 x 8 at 95");
  await fill(page).click();
  const weight = (n: number) => page.getByLabel(`Hippos set ${n} weight`);
  const reps = (n: number) => page.getByLabel(`Hippos set ${n} reps`);
  await expect(page.getByRole("button", { name: "Hippos advanced sets" })).toHaveAttribute("aria-pressed", "true");
  await expect(weight(1)).toHaveValue("135");
  await expect(reps(2)).toHaveValue("3");
  await expect(weight(3)).toHaveValue("225");
  await expect(reps(3)).toHaveValue("");
  // Sets that were all the same stay one line.
  await expect(page.getByRole("button", { name: "Gators advanced sets" })).toHaveAttribute("aria-pressed", "false");
  await expect(lifts(page).getByRole("textbox", { name: "lb", exact: true })).toHaveValue("95");
  await expect(lifts(page).getByRole("textbox", { name: "Sets", exact: true })).toHaveValue("3");
  await expect(lifts(page).getByRole("textbox", { name: "Reps", exact: true })).toHaveValue("8");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(2);
  const records = await saved(page);
  expect(records.find(w => w.athlete === "hippos")?.lifts).toEqual([{ name: "Back squat", kg: 225 * lb, sets: 1, reps: 0,
    detail: [{ kg: 135 * lb, reps: 5 }, { kg: 185 * lb, reps: 3 }, { kg: 225 * lb, reps: 0 }] }]);
  expect(records.find(w => w.athlete === "gators")?.lifts).toEqual([{ name: "Back squat", kg: 95 * lb, sets: 3, reps: 8 }]);
});

test("AI estimates each athlete's burn from the weight on the session's day, and it saves as typed", async ({ page }) => {
  await page.evaluate(async () => {
    const { settings, revision } = await fetch("/api/settings").then(r => r.json());
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { ...settings, bodyweight: { hippos: 82.04, gators: 0 } }, revision }) });
  });
  await page.reload();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page.route("**/api/workout-draft", async route => {
    expect(route.request().postDataJSON().bodyweightKg).toEqual({ hippos: 82 });
    await route.fulfill({ json: { draft: {
      ...draft, category: "Tennis", title: "Tennis", lifts: [], elapsed: { hippos: 3600, gators: 3600 },
      assumptions: "Hippos 420 kcal: singles tennis, MET 8, 60 min, 82 kg.\nGators 515 kcal: from the watch.",
      burn: { hippos: 420, gators: 515 },
    }, provider: "claude" } });
  });
  await page.getByLabel("Workout description").fill("Singles tennis for an hour, Gators' watch said 515");
  await fill(page).click();
  await expect(page.getByLabel("Hippos calories burned")).toHaveValue("420");
  await expect(page.getByLabel("Gators calories burned")).toHaveValue("515");
  // Still yours to change before it saves.
  await page.getByLabel("Hippos calories burned").fill("400");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(2);
  const records = await saved(page);
  expect(records.find(w => w.athlete === "hippos")?.kcal).toBe(400);
  expect(records.find(w => w.athlete === "gators")?.kcal).toBe(515);
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText(/~400 kcal/)).toBeVisible();
  await expect(page.getByText(/~515 kcal/)).toBeVisible();
});

test("an AI burn the workout was edited away from is worked out again on save", async ({ page }) => {
  await page.evaluate(async () => {
    const { settings, revision } = await fetch("/api/settings").then(r => r.json());
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { ...settings, bodyweight: { hippos: 82.04, gators: 0 } }, revision }) });
  });
  await page.reload();
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft: {
    ...draft, category: "Tennis", title: "Tennis", lifts: [], elapsed: { hippos: 3600, gators: 3600 }, notes: "",
    assumptions: "Hippos 420 kcal: singles tennis, MET 7, 60 min, 82 kg.\nGators 515 kcal: from the watch.",
    burn: { hippos: 420, gators: 515 },
  } } }));
  const asked: { workouts: Record<string, Workout>; description?: string; bodyweightKg: object }[] = [];
  const answers = [310, 220];
  await page.route("**/api/workout-burn", async route => {
    asked.push(route.request().postDataJSON());
    const hippos = answers[asked.length - 1];
    await route.fulfill({ json: { burn: { hippos, gators: null }, assumptions: `Hippos ${hippos} kcal: MET 7, 82 kg.` } });
  });
  await page.getByLabel("Workout description").fill("Singles tennis for an hour, Gators' watch said 515");
  await fill(page).click();
  await expect(page.getByLabel("Hippos calories burned")).toHaveValue("420");
  // Hippos played 45 minutes, not the hour. Gators' figure is typed over and so is theirs whatever changes.
  await page.getByLabel("Hippos elapsed time").fill("4500");
  await page.getByLabel("Gators calories burned").fill("500");
  await page.getByLabel("Gators elapsed time").fill("5000");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(2);
  expect(asked).toHaveLength(1);
  expect(Object.keys(asked[0].workouts)).toEqual(["hippos"]);
  expect(asked[0].workouts.hippos.seconds).toBe(2700);
  expect(asked[0].description).toBe("Singles tennis for an hour, Gators' watch said 515");
  expect(asked[0].bodyweightKg).toEqual({ hippos: 82 });
  let records = await saved(page);
  const hippos = records.find(w => w.athlete === "hippos")!;
  expect(hippos).toMatchObject({ kcal: 310, kcalSource: "ai" });
  expect(hippos.notes).toContain("Burn redone after edits: Hippos 310 kcal: MET 7, 82 kg.");
  expect(records.find(w => w.athlete === "gators")).toMatchObject({ kcal: 500 });
  expect(records.find(w => w.athlete === "gators")?.kcalSource).toBeUndefined();
  await expect(page.getByText("Burn redone for your edits")).toBeVisible();

  // Opened from the Log, a change of title leaves the burn be; a change of time works it out again.
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: "~310 kcal" }).getByLabel("Edit entry").click();
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue("Tennis");
  // Opened and not typed in, it is no draft.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("athx-drafts") ?? '{"drafts":[]}').drafts.length)).toBe(0);
  await page.getByLabel("Session", { exact: true }).fill("Singles");
  await page.getByRole("button", { name: "Update session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).find(w => w.athlete === "hippos")?.title).toBe("Singles");
  expect(asked).toHaveLength(1);
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: "~310 kcal" }).getByLabel("Edit entry").click();
  await page.getByLabel("Hippos elapsed time").fill("3000");
  await page.getByRole("button", { name: "Update session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).find(w => w.athlete === "hippos")?.kcal).toBe(220);
  expect(asked).toHaveLength(2);
  expect(asked[1].workouts.hippos.seconds).toBe(1800);
  expect(asked[1].description).toBeUndefined();
  records = await saved(page);
  expect(records.find(w => w.athlete === "gators")?.kcal).toBe(500);
});

test("a burn that cannot be worked out again is dropped, never saved out of date", async ({ page }) => {
  await selection(page, "Hippos").click();
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft: {
    ...draft, category: "Tennis", title: "Tennis", lifts: [], elapsed: { hippos: 3600, gators: null },
    burn: { hippos: 420, gators: null },
  } } }));
  await page.route("**/api/workout-burn", route => route.fulfill({ status: 503, json: { error: "The estimator did not answer with a burn." } }));
  await page.getByLabel("Workout description").fill("Tennis for an hour");
  await fill(page).click();
  await expect(page.getByLabel("Hippos calories burned")).toHaveValue("420");
  await page.getByLabel("Hippos elapsed time").fill("4500");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  const [record] = await saved(page);
  expect(record.seconds).toBe(2700);
  expect(record.kcal).toBeUndefined();
  expect(record.kcalSource).toBeUndefined();
  await expect(page.getByText("Burn not redone")).toBeVisible();
});

test("an estimator from before burns leaves the box empty, and the session's burn is estimated", async ({ page }) => {
  await selection(page, "Hippos").click();
  await page.getByLabel("Hippos calories burned").fill("999");
  await page.route("**/api/workout-draft", route => route.fulfill({ json: { draft } }));
  await page.getByLabel("Workout description").fill("Hippos deadlift 1 x 2 at 185 lb");
  await fill(page).click();
  await expect(page.getByLabel("Session", { exact: true })).toHaveValue(draft.title);
  await expect(page.getByLabel("Hippos calories burned")).toHaveValue("");
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
      { name: "Burpee", block: "metcon", unit: "reps", target: 30, hippos: { completed: 20, seconds: 120, kg: 6 }, gators: { completed: null, seconds: null, kg: null } },
      { name: "Run", block: "endurance", unit: "m", target: 1000, hippos: { completed: 1000, seconds: 300, kg: null }, gators: { completed: null, seconds: null, kg: null } },
    ],
  } } }));
  await page.getByLabel("Workout description").fill("Cable reverse fly, burpees and a run");
  await fill(page).click();
  await expect(lifts(page).getByLabel("Name it")).toHaveValue("Cable reverse fly");
  // Burpee is not an ATHX station, so the station types it under Other.
  await expect(stations(page).getByLabel("Station", { exact: true }).first()).toHaveValue("Other");
  await expect(stations(page).getByLabel("Name it")).toHaveValue("Burpee");
  await expect(page.getByLabel("Done (reps)")).toHaveValue("20");
  await expect(page.getByLabel("Covered (m)")).toHaveValue("1000");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  const record = (await saved(page))[0];
  expect(record.lifts[0]).toEqual({ name: "Cable reverse fly", kg: 10, sets: 3, reps: 12 });
  expect(record.segments[0].kg).toBe(6);
  // A station of its own has no target: the 30 the draft named is not kept.
  expect(record.segments[0]).toMatchObject({ name: "Burpee", completed: 20, target: 20 });
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
  // A burn worked out again takes records the records API would take, and nothing else.
  expect((await request.post("/api/workout-burn", { data: { workouts: {}, bodyweightKg: {} } })).status()).toBe(401);
  const workout = {
    id: "7b0c8a52-5d0e-4e7a-9f60-0d3a3c1f2b11", kind: "workout", athlete: "hippos", day: "2026-11-20", title: "Tennis",
    category: "Tennis", customCategory: "", seconds: 3600, notes: "", segments: [], fatigue: 10, transition: 0,
    goal: null, context: "solo", lifts: [], kcal: 420, kcalSource: "ai",
  };
  const burns = await page.evaluate(async workout => Promise.all([
    { workouts: {}, bodyweightKg: {} },
    { workouts: { hippos: { ...workout, seconds: -1 } }, bodyweightKg: {} },
    { workouts: { hippos: workout }, bodyweightKg: { hippos: 900 } },
    { workouts: { team: workout }, bodyweightKg: {} },
    // Well formed, and the estimator it is pointed at is not there.
    { workouts: { hippos: workout }, bodyweightKg: { hippos: 82 } },
  ].map(body => fetch("/api/workout-burn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.status))), workout);
  expect(burns).toEqual([400, 400, 400, 400, 503]);
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
      { name: "burpees", block: "metcon", unit: "reps", target: 30, hippos: { completed: 20, seconds: null, kg: 6 }, gators: { completed: null, seconds: null, kg: null } },
    ],
  } } }));
  await page.getByLabel("Workout description").fill("deadlifts, a bak squat, burpees and cable reverse fly");
  await fill(page).click();
  const liftNames = page.getByLabel("Lift", { exact: true });
  await expect(liftNames.nth(0)).toHaveValue("Deadlift");
  await expect(liftNames.nth(1)).toHaveValue("Back squat");
  await expect(liftNames.nth(2)).toHaveValue("Other");
  await expect(lifts(page).getByLabel("Name it")).toHaveValue("cable reverse fly");
  // Snapped to the list's Burpee, which is not an ATHX station, so typed under Other.
  await expect(page.getByLabel("Station", { exact: true })).toHaveValue("Other");
  await expect(stations(page).getByLabel("Name it")).toHaveValue("Burpee");
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
