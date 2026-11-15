import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { changesStub, emptyRangeMetricSeriesStub, metricSeriesStub } from "../web/src/api/fixtures";
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

async function stubChangesAndMetrics(page: Page) {
  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(changesStub()),
    }),
  );
  await page.route("**/api/metrics/*", (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.split("/").pop() ?? "wrist_temp";
    const range = (url.searchParams.get("range") ?? "180d") as MetricRange;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(metricSeriesStub(key, range)),
    });
  });
}

test("Metric detail: wrist_temp negative values + step seam + OS update + partials + minor epoch + zoom/range URL sync", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await stubChangesAndMetrics(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/metrics/wrist_temp?range=180d&tab=chart");

  await expect(page.getByRole("heading", { name: "Wrist temp" })).toBeVisible();
  await expect(page.getByTestId("finding-row-wrist_temp")).toContainText(
    "learning · 9 of 14 nights",
  );

  // EChart canvas rendered cleanly
  const chart = page.getByTestId("metric-echart");
  const canvas = chart.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect((box?.width ?? 0) > 400 && (box?.height ?? 0) > 200).toBe(true);

  // Accessible summary & sr-only table contain negative wrist-temp readings, band, and minor source
  await expect(chart.locator("figcaption")).toContainText("Wrist temp:");
  await expect(chart.locator("figcaption")).toContainText("1 device seam (Feb 22)");
  const srTable = chart.locator("table");
  await expect(srTable).toContainText("-0.");
  await expect(srTable).toContainText("Synthetic Watch A");
  await expect(srTable).toContainText("Synthetic Watch B");
  await expect(srTable).toContainText("Synthetic Phone App");
  const rows180d = await srTable.locator("tbody tr").count();

  // Recent units table shows 7 non-minor rows, partial flags, tz note, and warming baseline summary
  const recentTable = page.getByTestId("recent-units-table");
  await expect(recentTable).toBeVisible();
  await expect(recentTable.locator("tbody tr")).toHaveCount(7);
  await expect(recentTable).toContainText(copy.chart.partialExportCut);
  await expect(recentTable).toContainText(copy.chart.partialBelowMin);
  await expect(recentTable).toContainText(copy.chart.tzShiftNote);
  await expect(recentTable).not.toContainText("Synthetic Phone App");
  await expect(page.getByTestId("baseline-summary")).toHaveText(
    copy.pages.metricDetail.noBaselineYet,
  );

  await snap(page, "s14-wrist-temp-1440.png");
  await assertNoHorizontalOverflow(page);

  // Interactive zoom (inside mouse-wheel / slider) updates URL search params
  if (box) {
    const plotCenterX = box.x + box.width * 0.5;
    const plotCenterY = box.y + box.height * 0.5;
    await page.mouse.move(plotCenterX, plotCenterY);
    await page.mouse.wheel(0, -360);
    await expect(page).toHaveURL(/zoomStart=20\d{2}-\d{2}-\d{2}&zoomEnd=20\d{2}-\d{2}-\d{2}/);
    await expect(page.getByTestId("reset-zoom-btn")).toBeVisible();

    // Reset zoom clears zoomStart & zoomEnd
    await page.getByTestId("reset-zoom-btn").click();
    await expect(page).not.toHaveURL(/zoomStart=/);
    await expect(page.getByTestId("reset-zoom-btn")).toHaveCount(0);
  }

  // Range segmented control updates URL and narrows data series
  await page.getByRole("button", { name: "90d" }).click();
  await expect(page).toHaveURL(/range=90d/);
  await expect(async () => {
    const rows90d = await srTable.locator("tbody tr").count();
    expect(rows90d).toBeLessThan(rows180d);
  }).toPass();

  // Reloading preserves range=90d and URL zoom bounds
  await page.goto(
    "/metrics/wrist_temp?range=180d&tab=chart&zoomStart=2026-01-15&zoomEnd=2026-02-28",
  );
  await expect(page.getByTestId("reset-zoom-btn")).toBeVisible();
  await expect(page.getByRole("button", { name: "180d" })).toHaveAttribute("aria-pressed", "true");

  // 390px phone viewport
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await expect(recentTable).toBeVisible();
  await expect(recentTable.getByText(copy.chart.partialExportCut)).toBeVisible();
  await snap(page, "s14-wrist-temp-390.png");
  await assertNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});

test("Metric detail §5 states: computed HRV baseline, trend-only vo2max, insufficient spo2, empty range widen, unknown metric, and read error", async ({
  page,
}) => {
  const errors = trackErrors(page, { allow500: true });
  await stubChangesAndMetrics(page);

  // 1. Computed HRV with Watch A+B band, offset seam, FindingRow header, baseline summary
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart");
  await expect(page.getByTestId("finding-row-hrv_sdnn")).toContainText("lower than usual");
  await expect(page.getByTestId("finding-row-hrv_sdnn")).toContainText("42 vs 55 ms");
  await expect(page.getByTestId("baseline-summary")).toContainText(
    "Baseline: 21 nights · median 55 ms (49–61)",
  );
  await snap(page, "s14-hrv-1440.png");
  await assertNoHorizontalOverflow(page);

  // 2. Trend-only (vo2max): no FindingRow, trend-only banner, chart renders cleanly
  await page.goto("/metrics/vo2max?range=180d&tab=chart");
  await expect(page.getByTestId("trend-only-note")).toHaveText(
    copy.pages.metricDetail.trendOnlyNote,
  );
  await expect(page.getByTestId("finding-row-vo2max")).toHaveCount(0);
  await expect(page.getByTestId("metric-echart").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("baseline-summary")).toHaveText(
    copy.pages.metricDetail.noBaselineTrendOnly,
  );
  await snap(page, "s14-trend-only-1440.png");
  await assertNoHorizontalOverflow(page);

  // 3. Warming up / insufficient (spo2): renders chart without band
  await page.goto("/metrics/spo2?range=90d&tab=chart");
  await expect(page.getByTestId("finding-row-spo2")).toContainText(
    "not enough nights · 3 of 4 recent",
  );
  await expect(page.getByTestId("metric-echart").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("baseline-summary")).toHaveText(
    copy.pages.metricDetail.noBaselineYet,
  );

  // 4. No data in range: override hrv_sdnn?range=90d to empty, click widen -> 180d loads chart
  await page.route("**/api/metrics/hrv_sdnn*", (route) => {
    const url = new URL(route.request().url());
    const range = (url.searchParams.get("range") ?? "180d") as MetricRange;
    const body =
      range === "90d"
        ? emptyRangeMetricSeriesStub("hrv_sdnn", "90d")
        : metricSeriesStub("hrv_sdnn", range);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart");
  await expect(page.getByTestId("empty-range-state")).toContainText("No nights in this range");
  await page.getByTestId("widen-range-btn").click();
  await expect(page).toHaveURL(/range=180d/);
  await expect(page.getByTestId("metric-echart").locator("canvas")).toBeVisible();

  // 5. Unknown metric key lists known metrics
  await page.goto("/metrics/not_a_metric");
  await expect(page.getByTestId("unknown-metric")).toContainText(
    copy.pages.metricDetail.unknownTitle,
  );
  await expect(
    page.getByTestId("unknown-metric").getByRole("link", { name: "Wrist temp" }),
  ).toBeVisible();

  // 6. Read error + Retry
  let failOnce = true;
  await page.route("**/api/metrics/rhr*", (route) => {
    if (failOnce) {
      failOnce = false;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "read failed" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(metricSeriesStub("rhr", "180d")),
    });
  });
  await page.goto("/metrics/rhr?range=180d&tab=chart");
  await expect(page.getByTestId("read-error")).toContainText(copy.error.metricDetailTitle);
  await page.getByRole("button", { name: copy.error.retry }).click();
  await expect(page.getByTestId("metric-echart").locator("canvas")).toBeVisible();

  expect(errors).toEqual([]);
});
