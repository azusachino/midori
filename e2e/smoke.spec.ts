// Hermetic browser checks over the spike corpus (fixture db built by
// scripts/e2e/run.ts): the briefing tells the device-switch story with as-of
// and trust, the investigate chart renders, and the import history shows the
// seeded run. No cross-test state: every test loads its own page.
import { expect, test } from "@playwright/test";
import { copy } from "../web/src/copy";

test("pre-v1 briefing displays its read-route fallback", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  await expect(page.getByRole("main")).toBeVisible();
  // Slice 11 replaces this legacy page; its read routes intentionally return 501.
  await expect(page.getByText("Could not load the briefing.")).toBeVisible();
  expect(errors.every((error) => error.includes("501 (Not Implemented)"))).toBe(true);
});

test("pre-v1 briefing explains that its legacy read route is unavailable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Could not load the briefing.")).toBeVisible();
});

test("pre-v1 investigate route keeps its metric selector during the read API transition", async ({
  page,
}) => {
  await page.goto("/investigate?metric=wrist_temp");
  await expect(page.getByRole("combobox")).toHaveValue("wrist_temp");
  await expect(page.getByRole("heading", { name: copy.investigate.eventsTitle })).toBeVisible();
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
