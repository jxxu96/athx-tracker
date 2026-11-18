import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PASSPHRASE } from "../playwright.config.ts";
import { mealForTime } from "../lib/meal-time.ts";

async function meals(page: Page) {
  return page.evaluate(async () => {
    const data = await fetch("/api/records").then((r) => r.json());
    return data.records as {
      id: string; athlete: string; day: string; name: string; meal: string; source: string;
      macros: { calories: number; protein: number; carbs: number; fat: number; alcohol?: number; fiber?: number };
      estimator?: string;
    }[];
  });
}

const loggingFor = (page: Page, name: "Hippos" | "Gators" | "Both") =>
  page.getByRole("group", { name: "Logging for" }).getByRole("button", { name });

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open journal" }).click();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
});

test("the meal macros sit three across and two down", async ({ page }) => {
  const places = await page.evaluate(() => {
    const names = ["Calories (kcal)", "Protein (g)", "Carbs (g)", "Fiber (g)", "Fat (g)"];
    return names.map((name) => {
      const label = [...document.querySelectorAll("label")].find((node) => node.textContent === name);
      const field = label?.parentElement;
      const grid = field?.parentElement;
      const rect = field?.getBoundingClientRect();
      return {
        x: rect?.x ?? -1,
        y: rect?.y ?? -1,
        columns: grid ? getComputedStyle(grid).gridTemplateColumns : "",
      };
    });
  });
  for (const place of places) expect(place.columns.split(" ").filter(Boolean)).toHaveLength(3);
  const sameRow = (a: number, b: number) => Math.abs(places[a].y - places[b].y) < 2;
  expect(sameRow(0, 1)).toBe(true);
  expect(sameRow(1, 2)).toBe(true);
  expect(sameRow(3, 4)).toBe(true);
  expect(places[3].y).toBeGreaterThan(places[0].y);
  expect(places[0].x).toBeLessThan(places[1].x);
  expect(places[1].x).toBeLessThan(places[2].x);
  expect(places[3].x).toBeLessThan(places[4].x);
});

test("the meal date is today, yesterday, or a day from the calendar", async ({ page }) => {
  await loggingFor(page, "Hippos").click();
  const dates = page.getByRole("group", { name: "Date" });
  await expect(dates.getByRole("button", { name: "Today", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await dates.getByRole("button", { name: "Yesterday", exact: true }).click();
  await expect(dates.getByRole("button", { name: "Yesterday", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The calendar opens on the chosen day's month, which is yesterday's here,
  // and its outside days only fill out the first and last weeks. A day in
  // another month is paged to; without that the spec failed whenever tomorrow
  // or three days ago was off the grid.
  const { picked, tomorrow } = await page.evaluate(() => {
    const opens = new Date();
    opens.setDate(opens.getDate() - 1);
    const shifted = (days: number) => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return {
        day: new Intl.DateTimeFormat("en-CA", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(date),
        dataDay: date.toLocaleDateString(),
        months:
          (date.getFullYear() - opens.getFullYear()) * 12 + date.getMonth() - opens.getMonth(),
      };
    };
    return { picked: shifted(-3), tomorrow: shifted(1) };
  });
  const turn = async (months: number) => {
    const to = months > 0 ? "Next" : "Previous";
    for (let step = 0; step < Math.abs(months); step++) {
      await page.getByRole("button", { name: `Go to the ${to} Month`, exact: true }).click();
    }
  };
  await dates.getByRole("button", { name: "Calendar", exact: true }).click();
  await turn(tomorrow.months);
  await expect(page.locator(`[data-day="${tomorrow.dataDay}"]`)).toBeDisabled();
  await turn(picked.months - tomorrow.months);
  await page.locator(`[data-day="${picked.dataDay}"]`).click();
  await expect(dates.getByRole("button", { name: /^Calendar/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByLabel("Meal", { exact: true }).fill("Dated bowl");
  await page.getByLabel("Calories (kcal)").fill("400");
  await page.getByLabel("Protein (g)").fill("20");
  await page.getByLabel("Carbs (g)").fill("40");
  await page.getByLabel("Fat (g)").fill("10");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page)).filter((meal) => meal.name === "Dated bowl").map((meal) => meal.day),
  ).toEqual([picked.day]);

  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: "Dated bowl" }).getByLabel("Edit entry").click();
  await expect(
    page.getByRole("group", { name: "Date" }).getByRole("button", { name: /^Calendar/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

async function inks(page: Page) {
  return page.evaluate(() => {
    const read = (name: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return { hippos: read("--athlete-hippos-ink"), gators: read("--athlete-gators-ink") };
  });
}

test("the meal boxes take the colour of who the meal is for", async ({ page }) => {
  const colors = await inks(page);
  const card = page.locator("form section").first();
  const athlete = page.getByRole("group", { name: "Athlete" });
  const ring = () => card.evaluate((el) => getComputedStyle(el).backgroundImage);

  await expect(athlete.getByRole("button", { name: "Hippos" })).toHaveAttribute("data-athlete-outline", "hippos");
  await expect(loggingFor(page, "Hippos")).toHaveAttribute("data-athlete-outline", "hippos");
  await expect(card).toHaveAttribute("data-athlete-outline", "hippos");
  await expect(athlete.getByRole("button", { name: "Both" })).not.toHaveAttribute("data-athlete-outline");
  const pink = await ring();
  expect(pink).toContain(colors.hippos);
  expect(pink).not.toContain(colors.gators);

  await athlete.getByRole("button", { name: "Both" }).click();
  await expect(athlete.getByRole("button", { name: "Both" })).toHaveAttribute("data-athlete-outline", "both");
  await expect(loggingFor(page, "Both")).toHaveAttribute("data-athlete-outline", "both");
  await expect(card).toHaveAttribute("data-athlete-outline", "both");
  const split = await ring();
  expect(split).toContain(colors.hippos);
  expect(split).toContain(colors.gators);

  await athlete.getByRole("button", { name: "Gators" }).click();
  await expect(card).toHaveAttribute("data-athlete-outline", "gators");
  await expect(athlete.getByRole("button", { name: "Gators" })).toHaveAttribute("data-athlete-outline", "gators");
  await expect(loggingFor(page, "Gators")).toHaveAttribute("data-athlete-outline", "gators");
  await expect(athlete.getByRole("button", { name: "Hippos" })).not.toHaveAttribute("data-athlete-outline");
  const green = await ring();
  expect(green).toContain(colors.gators);
  expect(green).not.toContain(colors.hippos);
});

test("a new meal starts on the sitting that matches the time", async ({ page }) => {
  const sitting = mealForTime(new Date());
  const group = page.getByRole("group", { name: "Sitting" });
  await expect(group.getByRole("button", { name: sitting })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Matched to the time.")).toHaveCount(0);
  const other = sitting === "Snack" ? "Dinner" : "Snack";
  await group.getByRole("button", { name: other }).click();
  await expect(group.getByRole("button", { name: other })).toHaveAttribute("aria-pressed", "true");
});

test("ethanol shows on an alcohol sitting, and a dinner with a drink keeps it", async ({ page }) => {
  await expect(page.getByLabel("Fiber (g)")).toBeVisible();
  await expect(page.getByLabel("Ethanol (g)")).toHaveCount(0);
  const sitting = page.getByRole("group", { name: "Sitting" });
  await sitting.getByRole("button", { name: "Alcohol" }).click();
  await expect(page.getByLabel("Ethanol (g)")).toBeVisible();
  await expect(page.getByLabel("Fiber (g)")).toBeVisible();
  // Nothing in it yet, so another sitting has no box for it.
  for (const other of ["Lunch", "Dinner", "Breakfast", "Snack"]) {
    await sitting.getByRole("button", { name: other }).click();
    await expect(page.getByLabel("Ethanol (g)")).toHaveCount(0);
  }

  await loggingFor(page, "Hippos").click();
  await sitting.getByRole("button", { name: "Alcohol" }).click();
  await page.getByLabel("Meal", { exact: true }).fill("Burger and a beer");
  await page.getByLabel("Ethanol (g)").fill("10");
  // Holding ethanol, the box stays on any sitting, and clearing it to retype does not hide it.
  await sitting.getByRole("button", { name: "Dinner" }).click();
  await expect(page.getByLabel("Ethanol (g)")).toHaveValue("10");
  await page.getByLabel("Ethanol (g)").fill("");
  await expect(page.getByLabel("Ethanol (g)")).toBeVisible();
  await page.getByLabel("Ethanol (g)").fill("10");
  await page.getByLabel("Calories (kcal)").fill("150");
  await page.getByLabel("Protein (g)").fill("0");
  await page.getByLabel("Carbs (g)").fill("20");
  await page.getByLabel("Fat (g)").fill("0");
  await expect(page.getByText(/ethanol 70/)).toBeVisible();
  await expect(page.getByText("Your calorie total equals this rough estimate.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(async () => {
    const saved = (await meals(page)).find((meal) => meal.name === "Burger and a beer");
    return saved
      ? { meal: saved.meal, calories: saved.macros.calories, carbs: saved.macros.carbs, alcohol: saved.macros.alcohol }
      : null;
  }).toEqual({ meal: "Dinner", calories: 150, carbs: 20, alcohol: 10 });

  await page.getByRole("button", { name: "Log", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Burger and a beer" });
  await expect(row).toContainText("Ethanol 10 g");
  await row.getByLabel("Edit entry").click();
  await expect(page.getByLabel("Ethanol (g)")).toHaveValue("10");
});

for (const sitting of ["Alcohol", "Dinner"] as const) {
  test(`estimated drinks from ${sitting} save ethanol and show ALC in the log`, async ({ page }) => {
    await loggingFor(page, "Hippos").click();
    await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: sitting }).click();
    const name = `Estimated beer from ${sitting}`;
    await page.route("**/api/estimate", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ estimate: { name, calories: 150, protein: 0,
        carbs: 20, fat: 0, alcohol: 10, assumptions: "Beer with chips", confidence: "medium" },
        provider: "codex" }),
    }));
    await page.getByPlaceholder("Two eggs, 80 g oats with milk, banana, flat white").fill("Beer with chips");
    await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
    await expect(page.getByLabel("Ethanol (g)")).toHaveValue("10");
    await expect(page.getByText("Answered by Codex")).toBeVisible();
    await expect(page.getByText("Your calorie total equals this rough estimate.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save meal", exact: true }).click();
    await expect.poll(async () => {
      const saved = (await meals(page)).find((meal) => meal.name === name);
      return saved
        ? { meal: saved.meal, alcohol: saved.macros.alcohol, calories: saved.macros.calories, estimator: saved.estimator }
        : null;
    }).toEqual({ meal: "Alcohol", alcohol: 10, calories: 150, estimator: "codex" });
    await page.getByRole("button", { name: "Log", exact: true }).click();
    const row = page.getByRole("listitem").filter({ hasText: name });
    await expect(row).toContainText("Ethanol 10 g");
    await expect(row).toContainText("Codex");
  });
}

test("an averaged estimate says so, and the meal keeps it", async ({ page }) => {
  await loggingFor(page, "Hippos").click();
  const name = "Averaged burrito bowl";
  await page.route("**/api/estimate", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ estimate: { name, calories: 800, protein: 40, carbs: 80, fat: 20,
      assumptions: "Three guesses.", confidence: "low" }, provider: "average" }),
  }));
  await page.getByPlaceholder("Two eggs, 80 g oats with milk, banana, flat white").fill("Burrito bowl");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByText("Averaged across estimators")).toBeVisible();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(async () => (await meals(page)).find((meal) => meal.name === name)?.estimator)
    .toBe("average");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toContainText("Averaged");
});

test("a new food estimate clears ethanol left by a previous drink estimate", async ({ page }) => {
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Alcohol" }).click();
  let alcohol = 10;
  await page.route("**/api/estimate", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ estimate: { name: "Changing estimate", calories: 80 + alcohol * 7,
      protein: 0, carbs: 20, fat: 0, alcohol, assumptions: "", confidence: "medium" } }),
  }));
  await page.getByPlaceholder("Two eggs, 80 g oats with milk, banana, flat white").fill("Drink");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByLabel("Ethanol (g)")).toHaveValue("10");
  alcohol = 0;
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByLabel("Ethanol (g)")).toHaveValue("0");
  await expect(page.getByText("Your calorie total equals this rough estimate.", { exact: true })).toBeVisible();
});

test("the log marks a meal with a bowl and a session with a weight", async ({ page }) => {
  const posted = await page.evaluate(async () => {
    const send = (body: object) =>
      fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((response) => response.ok);
    const meal = await send({
      id: crypto.randomUUID(), kind: "meal", athlete: "hippos", day: "2026-10-24",
      name: "Marked oats", meal: "Breakfast", source: "manual", assumptions: "",
      macros: { calories: 455, protein: 30, carbs: 50, fat: 15 },
    });
    const session = await send({
      id: crypto.randomUUID(), kind: "workout", athlete: "gators", day: "2026-10-24",
      title: "Marked squats", category: "Strength", seconds: 0, notes: "",
      segments: [], fatigue: 0, transition: 0, goal: null, context: "solo",
      lifts: [{ name: "Back squat", kg: 60, sets: 3, reps: 5 }],
    });
    return meal && session;
  });
  expect(posted).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Log", exact: true }).click();
  const meal = page.getByRole("listitem").filter({ hasText: "Marked oats" });
  const session = page.getByRole("listitem").filter({ hasText: "Marked squats" });
  await expect(meal.locator(".lucide-soup")).toBeVisible();
  await expect(meal.locator(".lucide-weight")).toHaveCount(0);
  await expect(session.locator(".lucide-weight")).toBeVisible();
  await expect(session.locator(".lucide-soup")).toHaveCount(0);
});

test("the macro comparison is advisory when creating and editing a meal", async ({ page }) => {
  await expect(page.getByText(/Rough macro estimate:/)).toHaveCount(0);
  await loggingFor(page, "Hippos").click();
  await page.getByLabel("Meal", { exact: true }).fill("Independent calorie bowl");
  await page.getByLabel("Calories (kcal)").fill("900");
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByLabel("Carbs (g)").fill("50");
  await page.getByLabel("Fat (g)").fill("15");
  await expect(page.getByRole("status").filter({ hasText: "Rough macro estimate:" })).toContainText("455 kcal");
  await expect(page.getByText("Protein 120 + carbs 200 + fat 135 kcal")).toBeVisible();
  await expect(page.getByText(/Your calorie total is 445 kcal above/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Use macro total" })).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations).toEqual([]);
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(async () => (await meals(page)).find((meal) => meal.name === "Independent calorie bowl")?.macros.calories).toBe(900);
  const saved = (await meals(page)).find((meal) => meal.name === "Independent calorie bowl");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: "Independent calorie bowl" }).getByLabel("Edit entry").click();
  await page.getByLabel("Protein (g)").fill("40");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("900");
  await page.getByRole("button", { name: "Update meal" }).click();
  await expect.poll(async () => (await meals(page)).find((meal) => meal.name === "Independent calorie bowl")?.macros.protein).toBe(40);
  const updated = (await meals(page)).filter((meal) => meal.name === "Independent calorie bowl");
  expect(updated).toHaveLength(1);
  expect(updated[0]?.id).toBe(saved?.id);
  expect(updated[0]?.macros.calories).toBe(900);
});

test("a rounding difference is advisory and invalid grams still block saving", async ({ page }) => {
  await loggingFor(page, "Hippos").click();
  await page.getByLabel("Meal", { exact: true }).fill("Rounded meal");
  await page.getByLabel("Calories (kcal)").fill("460");
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByLabel("Carbs (g)").fill("50");
  await page.getByLabel("Fat (g)").fill("nope");
  await expect(page.getByText(/Rough macro estimate:/)).toHaveCount(0);
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Fat needs a number");
  await page.getByLabel("Fat (g)").fill("15");
  await expect(page.getByText(/Your calorie total is 5 kcal above/)).toBeVisible();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(async () => (await meals(page)).find((meal) => meal.name === "Rounded meal")?.macros.calories).toBe(460);
});

test("the API preserves an independent calorie total", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/records", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), kind: "meal", athlete: "gators",
        day: "2026-10-23", name: "Fiber label", meal: "Lunch", source: "manual", assumptions: "",
        macros: { calories: 160, protein: 6, carbs: 40, fat: 3 } }),
    });
    return { status: response.status };
  });
  expect(result.status).toBe(200);
  expect((await meals(page)).find((meal) => meal.name === "Fiber label")?.macros.calories).toBe(160);
});

test("a fiber-containing estimate keeps calories and fractional grams, including after edits", async ({ page }) => {
  await loggingFor(page, "Hippos").click();
  await page.route("**/api/estimate", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ estimate: { name: "Estimated fiber cereal", calories: 160,
      protein: 6.2, carbs: 40.4, fat: 2.6, fiber: 12, assumptions: "Total carbs include fiber", confidence: "medium" } }),
  }));
  await page.getByPlaceholder("Two eggs, 80 g oats with milk, banana, flat white").fill("One bowl of fiber cereal");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("160");
  await expect(page.getByLabel("Carbs (g)")).toHaveValue("40.4");
  await expect(page.getByLabel("Fiber (g)")).toHaveValue("12");
  // 12 g of the 40.4 g carbs at 2 kcal/g, the other 28.4 g at 4.
  await expect(page.getByText(/Rough macro estimate: 185.8 kcal/)).toBeVisible();
  await expect(page.getByText("Protein 24.8 + carbs 113.6 + fiber 24 + fat 23.4 kcal")).toBeVisible();
  await page.getByLabel("Fat (g)").fill("3.6");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("160");
  await page.getByLabel("Fiber (g)").fill("50");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Fiber is part of total carbs");
  await page.getByLabel("Fiber (g)").fill("10");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("160");
  await expect(page.getByText(/Rough macro estimate: 198.8 kcal/)).toBeVisible();
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect.poll(async () => {
    const saved = (await meals(page)).find((meal) => meal.name === "Estimated fiber cereal");
    return saved
      ? { source: saved.source, calories: saved.macros.calories, carbs: saved.macros.carbs, fiber: saved.macros.fiber }
      : null;
  }).toEqual({ source: "manual", calories: 160, carbs: 40.4, fiber: 10 });
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Estimated fiber cereal" })).toContainText("Fiber 10 g");
});

test("usual meals are one person's repeats, and a tap fills only that person's meal", async ({ page }) => {
  await page.evaluate(async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const day = (offset: number) => {
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - offset);
      return date.toISOString().slice(0, 10);
    };
    const post = (athlete: string, name: string, offset: number) =>
      fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: crypto.randomUUID(), kind: "meal", athlete, day: day(offset), name,
          meal: "Breakfast", source: "manual", assumptions: "",
          macros: { calories: 455, protein: 30, carbs: 50, fat: 15 },
        }),
      });
    await post("hippos", "Usual oats", 0);
    await post("hippos", "usual oats", 2);
    await post("hippos", "Lonely soup", 1);
    await post("gators", "Usual shake", 0);
    await post("gators", "Usual shake", 3);
  });
  await page.reload();
  await page.getByRole("button", { name: "Meal", exact: true }).click();

  await expect(page.getByRole("button", { name: "Hippos: Usual oats" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gators: Usual shake" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Lonely soup/ })).toHaveCount(0);

  await loggingFor(page, "Gators").click();
  await expect(page.getByRole("button", { name: "Gators: Usual shake" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hippos: Usual oats" })).toHaveCount(0);

  await loggingFor(page, "Both").click();
  await expect(page.getByRole("button", { name: "Hippos: Usual oats" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gators: Usual shake" })).toBeVisible();

  await page.getByRole("button", { name: "Hippos: Usual oats" }).click();
  await expect(loggingFor(page, "Hippos")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Meal", { exact: true })).toHaveValue("Usual oats");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("455");
  await expect(page.getByRole("button", { name: "Gators: Usual shake" })).toHaveCount(0);

  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const saved = (await meals(page)).filter((meal) => meal.name === "Usual oats");
    return saved.map((meal) => meal.athlete).sort();
  }).toEqual(["hippos", "hippos"]);
});

test("logging for both saves one meal for each athlete, and one athlete saves once", async ({ page }) => {
  const athletes = page.getByRole("group", { name: "Athlete" });
  await loggingFor(page, "Both").click();
  await expect(loggingFor(page, "Both")).toHaveAttribute("aria-pressed", "true");
  await expect(athletes.getByRole("button", { name: "Both" })).toHaveAttribute("aria-pressed", "true");
  await expect(athletes.getByRole("button", { name: "Hippos" })).toHaveAttribute("aria-pressed", "false");
  await expect(athletes.getByRole("button")).toHaveCount(3);

  // Both is split by dish unless it was the same meal for each.
  await page.getByRole("button", { name: "Same meal for each of you" }).click();
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Dinner" }).click();
  await page.getByLabel("Meal", { exact: true }).fill("Shared oats");
  await page.getByLabel("Calories (kcal)").fill("455");
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByLabel("Carbs (g)").fill("50");
  await page.getByLabel("Fat (g)").fill("15");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meals saved for Hippos and Gators", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const saved = (await meals(page)).filter((meal) => meal.name === "Shared oats");
    return {
      athletes: saved.map((meal) => meal.athlete).sort(),
      ids: new Set(saved.map((meal) => meal.id)).size,
      days: new Set(saved.map((meal) => meal.day)).size,
      sittings: saved.map((meal) => meal.meal).sort(),
      sources: [...new Set(saved.map((meal) => meal.source))],
      macros: saved.map((meal) => meal.macros),
    };
  }).toEqual({
    athletes: ["gators", "hippos"],
    ids: 2,
    days: 1,
    sittings: ["Dinner", "Dinner"],
    sources: ["manual"],
    macros: [
      { calories: 455, protein: 30, carbs: 50, fat: 15, alcohol: 0, fiber: 0 },
      { calories: 455, protein: 30, carbs: 50, fat: 15, alcohol: 0, fiber: 0 },
    ],
  });

  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await loggingFor(page, "Gators").click();
  await expect(page.getByRole("group", { name: "Athlete" }).getByRole("button", { name: "Gators" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Meal", { exact: true }).fill("Gators only");
  await page.getByLabel("Calories (kcal)").fill("455");
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByLabel("Carbs (g)").fill("50");
  await page.getByLabel("Fat (g)").fill("15");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true })).toBeVisible();
  await expect.poll(async () =>
    (await meals(page)).filter((meal) => meal.name === "Gators only").map((meal) => meal.athlete),
  ).toEqual(["gators"]);
  expect((await meals(page)).filter((meal) => meal.name === "Shared oats")).toHaveLength(2);
});

test("a both meal that fails halfway sends the rest later, not twice", async ({ page }) => {
  await loggingFor(page, "Both").click();
  await page.getByRole("button", { name: "Same meal for each of you" }).click();
  await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Snack" }).click();
  await page.getByLabel("Meal", { exact: true }).fill("Retry oats");
  await page.getByLabel("Calories (kcal)").fill("455");
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByLabel("Carbs (g)").fill("50");
  await page.getByLabel("Fat (g)").fill("15");

  let posts = 0;
  await page.route("**/api/records", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      if (posts >= 2) return route.abort("internetdisconnected");
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Saved on this phone")).toBeVisible();

  let landed = "";
  await expect.poll(async () => {
    const saved = (await meals(page)).filter((meal) => meal.name === "Retry oats");
    landed = saved.length === 1 ? saved[0].id : "";
    return saved.map((meal) => meal.athlete);
  }).toEqual(["hippos"]);

  await page.unroute("**/api/records");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("A waiting entry was sent")).toBeVisible();
  await expect.poll(async () => {
    const saved = (await meals(page)).filter((meal) => meal.name === "Retry oats");
    return {
      athletes: saved.map((meal) => meal.athlete).sort(),
      hippos: saved.filter((meal) => meal.athlete === "hippos").map((meal) => meal.id),
      gators: saved.filter((meal) => meal.athlete === "gators").length,
    };
  }).toEqual({
    athletes: ["gators", "hippos"],
    hippos: [landed],
    gators: 1,
  });
});

test("a meal keeps the time of day it was eaten, and the log orders the day by it", async ({ page }) => {
  await loggingFor(page, "Hippos").click();
  const sitting = page.getByRole("group", { name: "Sitting" });
  const save = async (name: string, time: string) => {
    await page.getByLabel("Time of day").fill(time);
    await page.getByLabel("Meal", { exact: true }).fill(name);
    await page.getByLabel("Calories (kcal)").fill("300");
    await page.getByLabel("Protein (g)").fill("20");
    await page.getByRole("button", { name: "Save meal", exact: true }).click();
    await expect(page.getByText("Meal saved", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Meal", exact: true }).click();
  };
  // The sitting follows the time typed, as it follows the clock.
  await page.getByLabel("Time of day").fill("07:45");
  await expect(sitting.getByRole("button", { name: "Breakfast" })).toHaveAttribute("aria-pressed", "true");
  await save("Timed oats", "07:45");
  await save("Timed bowl", "12:30");

  await page.getByRole("button", { name: "Log", exact: true }).click();
  const entries = page.getByRole("listitem").filter({ hasText: /^Timed/ });
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Timed bowl");
  await expect(entries.nth(0)).toContainText("12:30 · Hippos · Lunch");
  await expect(entries.nth(1)).toContainText("07:45 · Hippos · Breakfast");
});

test("a meal template can be renamed, and its grams changed, and setup keeps it", async ({ page }) => {
  const clear = async () => {
    const current = await page.request.get("/api/settings").then((response) => response.json()) as {
      settings: Record<string, unknown>;
      revision: number;
    };
    await page.request.put("/api/settings", {
      data: {
        revision: current.revision,
        settings: {
          ...current.settings,
          mealTemplates: { hippos: [], gators: [] },
        },
      },
    });
  };
  try {
    await loggingFor(page, "Hippos").click();
    await page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Breakfast" }).click();
    await page.getByLabel("Meal description").fill("80 g oats, 2 eggs");
    await page.getByLabel("Meal", { exact: true }).fill("Morning oats");
    await page.getByLabel("Calories (kcal)").fill("455");
    await page.getByLabel("Protein (g)").fill("30");
    await page.getByLabel("Carbs (g)").fill("50");
    await page.getByLabel("Fat (g)").fill("15");
    await page.getByRole("button", { name: "Save this meal as a template" }).click();
    await expect(page.getByText("Template saved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hippos: Morning oats" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Update this template" })).toBeVisible();

    await loggingFor(page, "Gators").click();
    await expect(page.getByRole("button", { name: "Hippos: Morning oats" })).toHaveCount(0);
    await loggingFor(page, "Hippos").click();

    // Editing is under Manage; the row itself only fills the form.
    await expect(page.getByRole("button", { name: "Edit Morning oats" })).toHaveCount(0);
    await page.getByRole("button", { name: "Manage templates" }).click();
    await page.getByRole("button", { name: "Edit Morning oats" }).click();
    await expect(page.getByRole("dialog", { name: "Edit Hippos template" })).toBeVisible();
    await page.getByLabel("Template name").fill("Hippos breakfast");
    await page.getByLabel("Grams, item 1").fill("100");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template updated", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hippos: Hippos breakfast" })).toBeVisible();

    await page.getByRole("button", { name: "Hippos: Hippos breakfast" }).click();
    await expect(page.getByLabel("Meal", { exact: true })).toHaveValue("Hippos breakfast");
    await expect(page.getByLabel("Meal description")).toHaveValue("100 g oats, 2 eggs");
    await expect(page.getByLabel("Calories (kcal)")).toHaveValue("455");
    await expect(page.getByRole("group", { name: "Sitting" }).getByRole("button", { name: "Breakfast" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Setup", exact: true }).click();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Meal", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hippos: Hippos breakfast" })).toBeVisible();
  } finally {
    await clear();
  }
});

test("saved ingredient weights rescale locally and the template keeps its defaults", async ({ page }) => {
  const name = "Yogurt with peanut butter and granola";
  const description = "225 g fage 0% greek yogurt, 11 g kirkland creamy pb, 30 g trader joe pb protein granola";
  let estimates = 0;
  await page.route("**/api/estimate", (route) => {
    estimates += 1;
    return route.fulfill({ json: {
      estimate: {
        name, calories: 315, protein: 30, carbs: 27, fat: 10, fiber: 4, confidence: "high",
        assumptions: [
          "Fage Total 0% Greek Yogurt, 225 g [120 kcal, 23P, 7C, 0F]",
          "Kirkland Creamy Peanut Butter, 11 g [65 kcal, 3P, 2C, 5F, 1 fiber]",
          "Trader Joe’s Peanut Butter Protein Granola, 30 g [130 kcal, 4P, 18C, 5F, 3 fiber]",
        ].join("\n\n"),
      },
      provider: "codex",
    } });
  });
  await loggingFor(page, "Hippos").click();
  await page.getByLabel("Meal description").fill(description);
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(page.getByRole("slider", { name: "fage 0% greek yogurt weight" })).toHaveValue("225");
  await page.getByRole("button", { name: "Save this meal as a template" }).click();
  await expect(page.getByText("Template saved", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await loggingFor(page, "Hippos").click();
  const template = page.getByRole("button", { name: `Hippos: ${name}` });
  await template.click();
  await page.getByRole("slider", { name: "kirkland creamy pb weight" }).press("Home");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("250");
  await page.getByRole("spinbutton", { name: "trader joe pb protein granola grams" }).fill("15");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("185");
  await expect(page.getByLabel("Protein (g)")).toHaveValue("25");
  await expect(page.getByLabel("Fiber (g)")).toHaveValue("1.5");
  await expect(page.getByLabel("Meal description")).toHaveValue(
    // Slid to zero, the peanut butter is left out of the meal.
    "225 g fage 0% greek yogurt, 15 g trader joe pb protein granola",
  );
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByText("Meal saved", { exact: true }).first()).toBeVisible();
  expect((await meals(page)).find((entry) => entry.name === name)?.macros.calories).toBe(185);
  await page.getByRole("button", { name: "Meal", exact: true }).click();
  await template.click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("315");

  await page.getByRole("button", { name: "Manage templates" }).click();
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const editor = page.getByRole("dialog", { name: "Edit Hippos template" });
  await editor.getByRole("slider", { name: "kirkland creamy pb weight" }).press("Home");
  await expect(editor.getByText(/250 kcal/)).toBeVisible();
  await editor.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Template updated", { exact: true })).toBeVisible();
  await template.click();
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("250");
  expect(estimates).toBe(1);
});

test("a counted item says what it adds, and can be weighed instead of multiplied", async ({ page }) => {
  const asked: string[] = [];
  await page.route("**/api/estimate", (route) => {
    const { description } = route.request().postDataJSON() as { description: string };
    asked.push(description);
    return route.fulfill({ json: {
      estimate: description === "270 g 0% milk"
        ? { name: description, calories: 92, protein: 9, carbs: 13, fat: 0, fiber: 0, alcohol: 0, confidence: "medium", assumptions: description }
        : {
            name: "Chocolate whey shake", calories: 213, protein: 34, carbs: 15, fat: 2, fiber: 0, confidence: "medium",
            assumptions: [
              "Whey concentrate, 34 g [130 kcal, 26P, 3C, 2F]",
              // No amount was written, so the milk is one serving: a cup.
              "0% milk, 1 cup [83 kcal, 8P, 12C, 0F]",
            ].join("\n\n"),
          },
      provider: "codex",
    } });
  });
  const calories = page.getByLabel("Calories (kcal)");
  const weights = page.getByRole("group", { name: "Ingredient weights" });
  await page.setViewportSize({ width: 390, height: 844 });
  await loggingFor(page, "Gators").click();
  await page.getByLabel("Meal description").fill("34 g whey concentrate, 0% milk");
  await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
  await expect(calories).toHaveValue("213");
  await expect(weights).toContainText("83 kcal");

  // 270 typed for millilitres is 270 servings, and the row says so at once.
  await page.getByRole("spinbutton", { name: "How many 0% milk" }).fill("270");
  await expect(calories).toHaveValue("22540");
  await expect(weights).toContainText("22,410 kcal");
  await weights.screenshot({ path: "test-results/meal-ingredient-counted-mobile.png" });

  // Weighed instead: estimated once at that weight, in its place.
  await page.getByRole("button", { name: "Weigh 0% milk in grams instead" }).click();
  await page.getByRole("spinbutton", { name: "0% milk grams" }).fill("270");
  await page.getByRole("spinbutton", { name: "0% milk grams" }).press("Enter");
  await expect(page.getByRole("slider", { name: "0% milk weight" })).toHaveValue("270");
  await expect(calories).toHaveValue("222");
  await expect(weights).toContainText("92 kcal");
  await expect(page.getByLabel("Meal description")).toHaveValue("34 g whey concentrate, 270 g 0% milk");

  // Slid to zero and typed again, there is no leading 0, and the meal is to a tenth.
  await page.getByRole("slider", { name: "whey concentrate weight" }).press("Home");
  await expect(page.getByRole("spinbutton", { name: "whey concentrate grams" })).toHaveValue("");
  await page.getByRole("spinbutton", { name: "whey concentrate grams" }).pressSequentially("5");
  await expect(page.getByRole("spinbutton", { name: "whey concentrate grams" })).toHaveValue("5");
  await expect(calories).toHaveValue("111.1");
  await weights.screenshot({ path: "test-results/meal-ingredient-weighed-mobile.png" });
  expect(asked).toEqual(["34 g whey concentrate, 0% milk", "270 g 0% milk"]);
});

test("every template item slides, zero keeps it as an option, and an item can be added or removed", async ({ page }) => {
  const clear = async () => {
    const current = await page.request.get("/api/settings").then((response) => response.json()) as {
      settings: Record<string, unknown>;
      revision: number;
    };
    await page.request.put("/api/settings", {
      data: { revision: current.revision, settings: { ...current.settings, mealTemplates: { hippos: [], gators: [] } } },
    });
  };
  const name = "Chocolate whey shake";
  const singles: Record<string, { calories: number; protein: number; carbs: number; fat: number }> = {
    "250 g 2% milk": { calories: 125, protein: 8, carbs: 12, fat: 5 },
    "250 g 0% milk": { calories: 85, protein: 8, carbs: 12, fat: 0 },
    "1 banana": { calories: 105, protein: 1, carbs: 27, fat: 0 },
    "3 g decaf coffee": { calories: 5, protein: 0, carbs: 1, fat: 0 },
  };
  const asked: string[] = [];
  await page.route("**/api/estimate", (route) => {
    const { description } = route.request().postDataJSON() as { description: string };
    asked.push(description);
    if (description === "5 g honey") return route.fulfill({ status: 502, json: { error: "No answer from the estimator." } });
    const single = singles[description];
    return route.fulfill({ json: {
      estimate: single
        ? { name: description, ...single, fiber: 0, alcohol: 0, confidence: "medium", assumptions: description }
        : {
            name, calories: 145, protein: 27, carbs: 7, fat: 3, fiber: 2, confidence: "high",
            assumptions: [
              "Whey concentrate, 34 g [130 kcal, 26P, 3C, 2F]",
              "Dutch process cocoa, 7 g [15 kcal, 1P, 4C, 1F, 2 fiber]",
            ].join("\n\n"),
          },
      provider: "codex",
    } });
  });
  const calories = page.getByLabel("Calories (kcal)");
  const description = page.getByLabel("Meal description");
  const grams = (food: string) => page.getByRole("spinbutton", { name: `${food} grams` });
  const add = async (text: string, slider: string) => {
    await page.getByLabel("New ingredient", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("slider", { name: slider })).toBeVisible();
  };
  try {
    await loggingFor(page, "Hippos").click();
    await description.fill("34 g whey concentrate, 7 g dutch process cocoa");
    await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
    await expect(calories).toHaveValue("145");
    // Every item slides; there is nothing to tick.
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    await add("250 g 2% milk", "2% milk weight");
    await expect(calories).toHaveValue("270");
    await add("250 g 0% milk", "0% milk weight");
    await expect(calories).toHaveValue("355");
    await page.getByRole("slider", { name: "0% milk weight" }).press("Home");
    // Blank at zero, so a weight typed into it never reads "0125".
    await expect(grams("0% milk")).toHaveValue("");
    await expect(calories).toHaveValue("270");
    await expect(description).toHaveValue("34 g whey concentrate, 7 g dutch process cocoa, 250 g 2% milk");

    // A counted item slides by how many.
    await add("1 banana", "banana count");
    await expect(calories).toHaveValue("375");
    await page.getByRole("spinbutton", { name: "How many banana" }).fill("2");
    await expect(calories).toHaveValue("480");
    await expect(description).toHaveValue("34 g whey concentrate, 7 g dutch process cocoa, 250 g 2% milk, 2 banana");
    // And any item comes off.
    await page.getByRole("button", { name: "Remove banana" }).click();
    await expect(page.getByRole("slider", { name: "banana count" })).toHaveCount(0);
    await expect(calories).toHaveValue("270");
    await page.getByRole("button", { name: "Save this meal as a template" }).click();
    await expect(page.getByText("Template saved", { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Meal", exact: true }).click();
    await loggingFor(page, "Hippos").click();
    const template = page.getByRole("button", { name: `Hippos: ${name}` });
    await template.click();
    await expect(calories).toHaveValue("270");
    await expect(grams("0% milk")).toHaveValue("");
    await expect(page.getByRole("slider", { name: "banana count" })).toHaveCount(0);

    // Swap the milk, and halve it.
    await grams("0% milk").fill("125");
    await page.getByRole("slider", { name: "2% milk weight" }).press("Home");
    await expect(calories).toHaveValue("187.5");
    await expect(description).toHaveValue("34 g whey concentrate, 7 g dutch process cocoa, 125 g 0% milk");
    await page.getByRole("button", { name: "Save meal", exact: true }).click();
    await expect(page.getByText("Meal saved", { exact: true }).first()).toBeVisible();
    const logged = await page.evaluate(async (title) => {
      const data = await fetch("/api/records").then((r) => r.json());
      return (data.records as { name: string; macros: { calories: number }; items?: { name: string }[] }[])
        .find((entry) => entry.name === title);
    }, name);
    expect(logged?.macros.calories).toBe(187.5);
    expect(logged?.items?.map((item) => item.name)).toEqual(["whey concentrate", "dutch process cocoa", "0% milk"]);

    // The template's own amounts are untouched by what was logged.
    await page.getByRole("button", { name: "Meal", exact: true }).click();
    await template.click();
    await expect(calories).toHaveValue("270");
    await expect(grams("2% milk")).toHaveValue("250");

    await page.getByRole("button", { name: "Manage templates" }).click();
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const editor = page.getByRole("dialog", { name: "Edit Hippos template" });
    await expect(editor.getByRole("checkbox")).toHaveCount(0);
    await expect(editor.getByLabel("Grams, item 4")).toHaveValue("0");
    // A new item whose estimate fails still has to be estimated before saving.
    await editor.getByRole("button", { name: "Add item" }).click();
    await editor.getByLabel("Grams, item 5").fill("5");
    await editor.getByLabel("Item 5", { exact: true }).fill("honey");
    await editor.getByRole("button", { name: "Estimate the new item" }).click();
    await expect(editor.getByText("No answer from the estimator.")).toBeVisible();
    await editor.getByRole("button", { name: "Save template" }).click();
    await expect(editor.getByText("Estimate the changed ingredients before saving.")).toBeVisible();
    await editor.getByRole("button", { name: "Remove item 5" }).click();
    // Added, estimated on its own, then kept at zero as an option.
    await editor.getByRole("button", { name: "Add item" }).click();
    await editor.getByLabel("Grams, item 5").fill("3");
    await editor.getByLabel("Item 5", { exact: true }).fill("decaf coffee");
    await editor.getByRole("button", { name: "Estimate the new item" }).click();
    await editor.getByRole("slider", { name: "decaf coffee weight" }).press("Home");
    await editor.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template updated", { exact: true })).toBeVisible();
    await expect(page.getByText(/Options: 0% milk, decaf coffee/)).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();
    await template.click();
    await expect(calories).toHaveValue("270");
    await grams("decaf coffee").fill("3");
    await expect(calories).toHaveValue("275");
    // With only a counted item left, it still slides, and it is the one that stays.
    await add("1 banana", "banana count");
    for (const food of ["whey concentrate", "dutch process cocoa", "2% milk", "0% milk", "decaf coffee"])
      await page.getByRole("button", { name: `Remove ${food}` }).click();
    await expect(calories).toHaveValue("105");
    await expect(page.getByRole("slider", { name: "banana count" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove banana" })).toBeDisabled();
    // Only the meal once, then each food that was new, on its own.
    expect(asked).toEqual([
      expect.stringContaining("whey"),
      "250 g 2% milk",
      "250 g 0% milk",
      "1 banana",
      "5 g honey",
      "3 g decaf coffee",
      "1 banana",
    ]);
  } finally {
    await clear();
  }
});

test("adding a food to a template meal offers to update the template's defaults", async ({ page }) => {
  const settings = async () => await page.request.get("/api/settings").then((response) => response.json()) as {
    settings: { mealTemplates?: { hippos: { name: string; items: { name: string; grams: number }[] }[] } } & Record<string, unknown>;
    revision: number;
  };
  const clear = async () => {
    const current = await settings();
    await page.request.put("/api/settings", {
      data: { revision: current.revision, settings: { ...current.settings, mealTemplates: { hippos: [], gators: [] } } },
    });
  };
  const name = "Vanilla whey shake";
  await page.route("**/api/estimate", (route) => {
    const { description } = route.request().postDataJSON() as { description: string };
    return route.fulfill({ json: {
      estimate: description === "250 g 2% milk"
        ? { name: description, calories: 125, protein: 8, carbs: 12, fat: 5, fiber: 0, alcohol: 0, confidence: "medium", assumptions: description }
        : {
            name, calories: 145, protein: 27, carbs: 7, fat: 3, fiber: 2, confidence: "high",
            assumptions: [
              "Whey concentrate, 34 g [130 kcal, 26P, 3C, 2F]",
              "Dutch process cocoa, 7 g [15 kcal, 1P, 4C, 1F, 2 fiber]",
            ].join("\n\n"),
          },
      provider: "codex",
    } });
  });
  const suggestion = page.getByRole("region", { name: "Template suggestion" });
  const update = page.getByRole("button", { name: "Update template defaults" });
  const addMilk = async () => {
    await page.getByLabel("New ingredient", { exact: true }).fill("250 g 2% milk");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("slider", { name: "2% milk weight" })).toBeVisible();
  };
  try {
    await loggingFor(page, "Hippos").click();
    await page.getByLabel("Meal description").fill("34 g whey concentrate, 7 g dutch process cocoa");
    await page.getByRole("button", { name: "Estimate macros", exact: true }).click();
    await expect(page.getByLabel("Calories (kcal)")).toHaveValue("145");
    await page.getByRole("button", { name: "Save this meal as a template" }).click();
    await expect(page.getByText("Template saved", { exact: true })).toBeVisible();

    // A changed amount is not something new.
    await page.getByRole("spinbutton", { name: "whey concentrate grams" }).fill("40");
    await expect(suggestion).toHaveCount(0);
    await addMilk();
    await expect(suggestion).toContainText(`Added 2% milk, not in ${name} yet.`);
    // Taken off again, there is nothing to keep.
    await page.getByRole("button", { name: "Remove 2% milk" }).click();
    await expect(suggestion).toHaveCount(0);
    await addMilk();
    await update.click();
    await expect(page.getByText("Template updated", { exact: true })).toBeVisible();
    await expect(suggestion).toHaveCount(0);

    const templates = (await settings()).settings.mealTemplates?.hippos ?? [];
    expect(templates.map((template) => template.name)).toEqual([name]);
    expect(templates[0].items.map(({ name, grams }) => ({ name, grams }))).toEqual([
      { name: "whey concentrate", grams: 40 },
      { name: "dutch process cocoa", grams: 7 },
      { name: "2% milk", grams: 250 },
    ]);

    await page.reload();
    await page.getByRole("button", { name: "Meal", exact: true }).click();
    await loggingFor(page, "Hippos").click();
    await page.getByRole("button", { name: `Hippos: ${name}` }).click();
    await expect(page.getByRole("slider", { name: "2% milk weight" })).toBeVisible();
    await expect(suggestion).toHaveCount(0);
  } finally {
    await clear();
  }
});
