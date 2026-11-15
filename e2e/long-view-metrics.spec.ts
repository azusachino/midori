import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  changesStub,
  metricSeriesStub,
  metricsIndexStub,
  unitEvidenceStub,
} from "../web/src/api/fixtures";
import type { MetricRange } from "../web/src/api/types";
import { copy } from "../web/src/copy";

const SHOTS_DIR = process.env.MIDORI_SHOTS_DIR;

async function snap(page: Page, name: string) {
  if (!SHOTS_DIR) return;
  await page.screenshot({ path: join(SHOTS_DIR, name), fullPage: true });
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

test("Long view tab renders per-year ECharts calendar with hatched partials, seam mark, and opens evidence sheet on click", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

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
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(unitEvidenceStub(metricKey, parts[4])),
      });
    }
    const range = (reqUrl.searchParams.get("range") ?? "1y") as MetricRange;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(metricSeriesStub(metricKey, range)),
    });
  });

  await page.goto("/metrics/hrv_sdnn?range=90d&tab=long");
  const panel = page.getByTestId("long-view-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Synthetic Watch A");
  await expect(panel).toContainText("Synthetic Watch B");
  await expect(panel).toContainText("Partial (hatched)");
  await expect(panel).toContainText("Device seam (Jan 24)");

  const canvas = page.getByTestId("long-view-echart").locator("canvas");
  await expect(canvas).toBeVisible();

  // Verify sr-only calendar table includes both 2025 & 2026, hatched partial rows, and seam mark
  const srTable = page.getByTestId("long-view-echart").locator("table");
  await expect(srTable).toContainText("2025");
  await expect(srTable).toContainText("2026");
  await expect(srTable).toContainText("export_cut");
  await expect(srTable).toContainText("offset (Jan 24)");

  await assertNoHorizontalOverflow(page);
  await snap(page, "s16-long-view-1440.png");

  // Click center of a populated Jan 2026 cell (week col ~2.5, row ~3.5 inside the 2026 calendar block at top=216)
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();
  if (canvasBox) {
    const colWidth = (canvasBox.width - 70) / 53;
    await page.mouse.click(canvasBox.x + 52 + colWidth * 2.5, canvasBox.y + 216 + 16 * 3.5);
    await expect(page).toHaveURL(/night=2026-\d{2}-\d{2}/);
    await expect(page.getByTestId("evidence-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("evidence-sheet")).toBeHidden();
  }

  // Also test tab switching on mobile 390px
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await snap(page, "s16-long-view-390.png");

  expect(errors).toEqual([]);
});

test("Metrics index /metrics shows ordered groups, mini charts, No data yet, empty imports, error retry, and card navigation at 180d", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page, { allow500: true });

  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(changesStub()),
    }),
  );

  let mode: "error" | "empty" | "populated" = "error";
  await page.route("**/api/metrics", (route) => {
    if (mode === "error") {
      mode = "populated";
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "metrics read failed" }),
      });
    }
    if (mode === "empty") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(metricsIndexStub(false)),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(metricsIndexStub(true)),
    });
  });

  await page.route("**/api/metrics/**", (route) => {
    const reqUrl = new URL(route.request().url());
    const parts = reqUrl.pathname.split("/").filter(Boolean);
    const metricKey = parts[2] ?? "hrv_sdnn";
    const range = (reqUrl.searchParams.get("range") ?? "180d") as MetricRange;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(metricSeriesStub(metricKey, range)),
    });
  });

  // 1. Read error + Retry state
  await page.goto("/metrics");
  await expect(page.getByTestId("read-error")).toContainText(copy.error.metricsTitle);
  await page.getByRole("button", { name: copy.error.retry }).click();

  // 2. Populated state: ordered sections overnight -> daytime -> trendOnly
  await expect(page.getByTestId("metrics-index-page")).toBeVisible();
  const groupIds = await page
    .locator('[data-testid^="metrics-group-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(groupIds).toEqual([
    "metrics-group-overnight",
    "metrics-group-daytime",
    "metrics-group-trendOnly",
  ]);

  // Mini EChart rendered for hrv_sdnn & No data yet in place for hrv_rmssd
  await expect(page.getByTestId("metric-mini-chart-hrv_sdnn").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("metric-no-data-hrv_rmssd")).toHaveText(
    copy.pages.metrics.noDataYet,
  );
  await expect(page.getByTestId("metric-card-vo2max")).toContainText(
    copy.pages.metrics.trendOnlySummary,
  );
  await assertNoHorizontalOverflow(page);
  await snap(page, "s16-metrics-index-1440.png");

  // Mobile 390px single-column stack
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
  await snap(page, "s16-metrics-index-390.png");

  // 3. Clicking a card navigates to Metric detail at 180d
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("metric-card-hrv_sdnn").click();
  await expect(page).toHaveURL(/\/metrics\/hrv_sdnn\?range=180d/);
  await expect(page.getByTestId("metric-echart").locator("canvas")).toBeVisible();

  // 4. No imports -> B-R4 EmptyState
  mode = "empty";
  await page.goto("/metrics");
  await expect(page.getByTestId("empty-state")).toBeVisible();

  expect(errors).toEqual([]);
});
