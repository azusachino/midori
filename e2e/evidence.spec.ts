import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { changesStub, metricSeriesStub, unitEvidenceStub } from "../web/src/api/fixtures";
import type { MetricRange } from "../web/src/api/types";
import { copy } from "../web/src/copy";

const SHOTS_DIR = process.env.MIDORI_SHOTS_DIR;

async function snap(page: Page, name: string, opts?: { fullPage?: boolean }) {
  if (!SHOTS_DIR) return;
  await page.screenshot({ path: join(SHOTS_DIR, name), fullPage: opts?.fullPage ?? true });
}

function trackErrors(page: Page, opts?: { allow500?: boolean }): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (
      opts?.allow500 &&
      text.includes("Failed to load resource: the server responded with a status of 500")
    ) {
      return;
    }
    errors.push(text);
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
}

async function stubMetricAndEvidenceRoutes(page: Page, opts?: { failFirstUnitCall?: boolean }) {
  let failedOnce = false;
  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(changesStub()),
    }),
  );
  await page.route("**/api/metrics/**", (route) => {
    const reqUrl = new URL(route.request().url());
    const parts = reqUrl.pathname.split("/").filter(Boolean);
    const metricKey = parts[2] ?? "hrv_sdnn";
    if (parts[3] === "units" && parts[4]) {
      const day = parts[4];
      if (opts?.failFirstUnitCall && !failedOnce) {
        failedOnce = true;
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "evidence read timeout", retryable: true }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(unitEvidenceStub(metricKey, day)),
      });
    }
    const range = (reqUrl.searchParams.get("range") ?? "180d") as MetricRange;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(metricSeriesStub(metricKey, range)),
    });
  });
}

test("checks panel (B-C1–B-C6), evidence sheet interactions, URL sync, Esc, copy link, and chart click @ 1440px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);
  await stubMetricAndEvidenceRoutes(page);

  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart");

  const checksPanel = page.getByTestId("checks-panel");
  await expect(checksPanel).toBeVisible();
  await expect(page.getByTestId("check-row-device_change")).toHaveAttribute("data-status", "clear");
  await expect(page.getByTestId("check-row-os_update")).toHaveAttribute("data-status", "clear");
  await expect(page.getByTestId("check-row-partial_nights")).toHaveAttribute(
    "data-status",
    "flagged",
  );
  await expect(page.getByTestId("check-row-partial_nights")).toContainText(
    "1 partial night skipped (Mar 1)",
  );
  await expect(page.getByTestId("check-row-tz_change")).toHaveAttribute("data-status", "clear");
  await expect(page.getByTestId("check-row-missing_nights")).toHaveAttribute(
    "data-status",
    "clear",
  );
  await expect(page.getByTestId("check-row-low_trust")).toHaveAttribute("data-status", "clear");
  await expect(page.getByTestId("check-row-low_trust")).toContainText("Trust: moderate");

  const recentTable = page.getByTestId("recent-units-table");
  await expect(recentTable.locator('tbody tr[data-usable="true"]')).toHaveCount(7);
  await expect(recentTable.locator('tbody tr[data-usable="false"]')).toHaveCount(2);
  const mar1Row = recentTable.locator("tbody tr", {
    has: page.getByTestId("recent-row-btn-2026-03-01"),
  });
  await expect(mar1Row).toHaveAttribute("data-usable", "false");
  await expect(mar1Row.locator("td").nth(2)).toHaveText("—");
  await expect(mar1Row.locator("td").nth(4)).toContainText("partial (export cut)");
  const feb24Row = recentTable.locator("tbody tr", {
    has: page.getByTestId("recent-row-btn-2026-02-24"),
  });
  await expect(feb24Row).toHaveAttribute("data-usable", "false");
  await expect(feb24Row.locator("td").nth(2)).toHaveText("—");
  await expect(feb24Row.locator("td").nth(4)).toContainText("partial (too few samples)");

  await assertNoHorizontalOverflow(page);
  await snap(page, "s15-hrv-checks-1440.png");

  // Keyboard navigation on Recent nights row opens ?night= evidence sheet
  const rowBtn = page.getByTestId("recent-row-btn-2026-02-25");
  await rowBtn.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/night=2026-02-25/);
  const sheet = page.getByTestId("evidence-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("evidence-sheet-title")).toContainText(
    "Night of Wed Feb 25 · HRV (SDNN)",
  );
  await expect(page.getByTestId("evidence-summary-line")).toContainText(
    "median of 8 samples, 21:00–09:00 Asia/Tokyo",
  );
  await expect(page.getByTestId("evidence-usability-badge")).toHaveText("usable");
  await expect(page.getByTestId("evidence-samples-list")).toBeVisible();
  await expect(page.getByTestId("evidence-sleep-panel")).toBeVisible();
  await expect(sheet.getByTestId("sleep-stage-bar")).toBeVisible();
  await expect(sheet.getByTestId("sleep-stage-legend")).toContainText("Deep");
  await expect(page.getByTestId("evidence-also-recorded")).toContainText("Synthetic Phone App");
  await snap(page, "s15-evidence-sheet-1440.png", { fullPage: false });

  // Copy link button updates confirmation state
  await page.getByTestId("evidence-copy-link-btn").click();
  await expect(page.getByTestId("evidence-copy-link-btn")).toContainText(
    copy.pages.metricDetail.evidence.copiedLink,
  );

  // Escape closes sheet and clears ?night=
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page).not.toHaveURL(/night=/);

  // Clicking the flagged check link opens Mar 1 partial night evidence
  await page.getByTestId("check-day-link-partial_nights").click();
  await expect(page).toHaveURL(/night=2026-03-01/);
  await expect(page.getByTestId("evidence-usability-badge")).toHaveText(
    "partial (export taken before noon)",
  );
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Clicking a plotted point column on the chart opens that day's sheet
  const canvasBox = await page.getByTestId("metric-echart").locator("canvas").boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox) {
    await page.mouse.click(
      canvasBox.x + canvasBox.width * 0.72,
      canvasBox.y + canvasBox.height * 0.45,
    );
  }
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/night=\d{4}-\d{2}-\d{2}/);
  await page.keyboard.press("Escape");

  expect(errors).toEqual([]);
});

test("mobile full-screen sheet @ 390px, empty evidence state, error retry, and trend-only checks omission", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = trackErrors(page, { allow500: true });
  await stubMetricAndEvidenceRoutes(page, { failFirstUnitCall: true });

  // Direct ?night= deep link triggers 500 first, then Retry succeeds
  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart&night=2026-02-25");
  await expect(page.getByTestId("read-error")).toContainText(
    copy.pages.metricDetail.evidence.loadError,
  );
  await page.getByRole("button", { name: copy.error.retry }).click();

  const sheet = page.getByTestId("evidence-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("evidence-sheet-title")).toContainText("Night of Wed Feb 25");

  // Full-screen sheet below 768px
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox).not.toBeNull();
  if (sheetBox) {
    expect(sheetBox.width).toBeGreaterThanOrEqual(388);
    expect(sheetBox.height).toBeGreaterThanOrEqual(840);
  }
  await assertNoHorizontalOverflow(page);
  await snap(page, "s15-evidence-sheet-390.png", { fullPage: false });

  // Empty evidence night state ("No samples stored for this night")
  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart&night=2026-02-10");
  await expect(page.getByTestId("evidence-summary-line")).toHaveText(
    copy.pages.metricDetail.evidence.noSamplesNight,
  );
  await expect(page.getByTestId("evidence-samples-list")).toBeHidden();

  // Trend-only vo2max hides Checks panel (ui-design §5)
  await page.goto("/metrics/vo2max?range=90d&tab=chart");
  await expect(page.getByTestId("trend-only-note")).toBeVisible();
  await expect(page.getByTestId("checks-panel")).toHaveCount(0);
  await expect(page.getByTestId("recent-units-table")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});
