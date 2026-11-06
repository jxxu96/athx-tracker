import type { Page } from "@playwright/test";

/** Setup's gear in the header, where the theme is chosen. */
export const openSetup = (page: Page) =>
  page.locator("header").getByRole("button", { name: "Setup", exact: true }).click();

/**
 * The theme is chosen in Setup. This goes there, chooses it, and goes back to
 * the tab that was open, so a spec can read that tab in each theme. Progress
 * opens on its main lifts again, so a spec on another view picks it again.
 */
export async function chooseTheme(page: Page, theme: "Light" | "Dark") {
  const sections = page.getByRole("navigation", { name: "Sections" });
  const current = (await sections.locator('[aria-current="page"]').textContent())?.trim();
  await openSetup(page);
  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: theme, exact: true }).click();
  if (current) await sections.getByRole("button", { name: current, exact: true }).click();
}
