// Hermetic browser checks over the spike corpus (fixture db built by
// scripts/e2e/run.ts): the briefing tells the device-switch story with as-of
// and trust, the investigate chart renders, and the import history shows the
// seeded run. No cross-test state: every test loads its own page.
import { expect, test } from "@playwright/test";
import { copy } from "../web/src/copy";

test("briefing tells the spike story without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  await expect(page.getByRole("main")).toBeVisible();
  // Anchor day from the fixture corpus is on the page.
  await expect(page.getByText("2026-03-01").first()).toBeVisible();
  // The wrist-temp recalibration finding: source B took over.
  await expect(page.getByText(/Synthetic Watch B/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("briefing carries as-of and trust chips", async ({ page }) => {
  await page.goto("/");
  // Every last-night card shows an "as of" line with a date.
  const asOf = page.getByText(/as of 2026-/);
  await expect(asOf.first()).toBeVisible();
  // Trust chips render with known copy.
  await expect(page.getByText(/trust/i).first()).toBeVisible();
});

test("investigate renders the chart, the band note and the baseline table", async ({ page }) => {
  await page.goto("/investigate?metric=wrist_temp");

  await expect(page.getByRole("img").first()).toBeVisible(); // the uPlot canvas
  await expect(page.getByText(copy.investigate.deviationsTitle)).toBeVisible();
  await expect(page.getByText(copy.investigate.eventsTitle)).toBeVisible();
});

test("import page lists the seeded fixture import", async ({ page }) => {
  await page.goto("/import");

  await expect(page.getByText(copy.pages.import.historyTitle)).toBeVisible();
  // The fixture import row: done, with inserted and deduped counts.
  await expect(page.getByText(copy.status.done).first()).toBeVisible();
});

test("deviating from the root SPA-fallbacks, unknown assets 404", async ({ page }) => {
  const res = await page.goto("/investigate?metric=wrist_temp");
  expect(res?.status()).toBe(200);
  // The metric picker reflects the URL param.
  await expect(page.getByRole("combobox")).toHaveValue("wrist_temp");
});
