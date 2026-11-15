import { expect, type Page, test } from "@playwright/test";
import { emptyRangeMetricSeriesStub, metricSeriesStub } from "../web/src/api/fixtures";
import type { MetricRange } from "../web/src/api/types";
import { copy } from "../web/src/copy";
import { snapShot } from "./shots";

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

test("Metric detail against real server: hrv_sdnn baseline band, seam, OS updates, partial row, zoom/range URL sync, trend-only, warming_up, and unknown", async ({
  page,
}) => {
  const errors = trackErrors(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/metrics/hrv_sdnn?range=180d&tab=chart");

  await expect(page.getByRole("heading", { name: "HRV (SDNN)" })).toBeVisible();
  await expect(page.getByTestId("finding-row-hrv_sdnn")).toContainText("lower than usual");

  const chart = page.getByTestId("metric-echart");
  const canvas = chart.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect((box?.width ?? 0) > 400 && (box?.height ?? 0) > 200).toBe(true);

  await expect(chart.locator("figcaption")).toContainText("HRV (SDNN):");
  await expect(chart.locator("figcaption")).toContainText("1 device seam (Oct 16)");

  const srTable = chart.locator("table");
  await expect(srTable).toContainText("Watch6,1");
  await expect(srTable).toContainText("Watch7,5");
  // Baseline band applies only to current Watch7,5 stint (Watch6,1 rows show "—")
  const watchABand = await srTable
    .locator('tbody tr:has-text("2026-09-15") td:nth-child(5)')
    .allTextContents();
  expect(watchABand).toEqual(["—"]);
  const watchBBand = await srTable
    .locator('tbody tr:has-text("2026-11-01") td:nth-child(5)')
    .allTextContents();
  expect(watchBBand.length).toBe(1);
  expect(watchBBand[0]).not.toBe("—");
  const rows180d = await srTable.locator("tbody tr").count();

  // Recent units table: 7 usable rows + partial 2026-11-11 row with "—" vs usual
  const recentTable = page.getByTestId("recent-units-table");
  await expect(recentTable).toBeVisible();
  await expect(recentTable.locator('tbody tr[data-usable="true"]')).toHaveCount(7);
  await expect(recentTable.locator('tbody tr[data-usable="false"]')).toHaveCount(1);
  await expect(recentTable.getByTestId("recent-row-btn-2026-11-11")).toBeVisible();
  await expect(recentTable).toContainText(copy.chart.partialGeneric);
  await expect(recentTable).toContainText(copy.chart.tzShiftNote);
  await expect(page.getByTestId("baseline-summary")).toContainText("Baseline:");

  await snapShot(page, "int-metric-detail-1440.png");
  await assertNoHorizontalOverflow(page);

  // Interactive zoom updates URL search params and clears via reset-zoom-btn
  if (box) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.wheel(0, -360);
    await expect(page).toHaveURL(/zoomStart=20\d{2}-\d{2}-\d{2}&zoomEnd=20\d{2}-\d{2}-\d{2}/);
    await expect(page.getByTestId("reset-zoom-btn")).toBeVisible();

    await page.getByTestId("reset-zoom-btn").click();
    await expect(page).not.toHaveURL(/zoomStart=/);
    await expect(page.getByTestId("reset-zoom-btn")).toHaveCount(0);
  }

  // Range segmented controls: 90d, all (weekly), and reload with URL zoom
  await page.getByRole("button", { name: "90d" }).click();
  await expect(page).toHaveURL(/range=90d/);
  await expect(async () => {
    const rows90d = await srTable.locator("tbody tr").count();
    expect(rows90d).toBeLessThanOrEqual(rows180d);
  }).toPass();

  await page.getByRole("button", { name: "All" }).click();
  await expect(page).toHaveURL(/range=all/);
  await expect(canvas).toBeVisible();

  await page.goto("/metrics/hrv_sdnn?range=180d&tab=chart&zoomStart=2026-09-15&zoomEnd=2026-11-14");
  await expect(page.getByTestId("reset-zoom-btn")).toBeVisible();
  await expect(page.getByRole("button", { name: "180d" })).toHaveAttribute("aria-pressed", "true");

  // 390px mobile layout
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await expect(recentTable).toBeVisible();
  await snapShot(page, "int-metric-detail-390.png");
  await assertNoHorizontalOverflow(page);

  // Trend-only (vo2max) on real server
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/metrics/vo2max?range=180d&tab=chart");
  await expect(page.getByTestId("trend-only-note")).toHaveText(
    copy.pages.metricDetail.trendOnlyNote,
  );
  await expect(page.getByTestId("finding-row-vo2max")).toHaveCount(0);
  await expect(page.getByTestId("metric-echart").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("baseline-summary")).toHaveText(
    copy.pages.metricDetail.noBaselineTrendOnly,
  );

  // Warming-up (spo2) on real server: no baseline band yet
  await page.goto("/metrics/spo2?range=90d&tab=chart");
  await expect(page.getByTestId("finding-row-spo2")).toContainText("learning · 10 of 14 nights");
  await expect(page.getByTestId("metric-echart").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("baseline-summary")).toHaveText(
    copy.pages.metricDetail.noBaselineYet,
  );

  // Unknown metric key on real server
  await page.goto("/metrics/not_a_metric");
  await expect(page.getByTestId("unknown-metric")).toContainText(
    copy.pages.metricDetail.unknownTitle,
  );
  await expect(
    page.getByTestId("unknown-metric").getByRole("link", { name: "Wrist temp" }),
  ).toBeVisible();

  expect(errors).toEqual([]);
});

test("Metric detail §5 empty range widen and read error retry (route-intercepted)", async ({
  page,
}) => {
  const errors = trackErrors(page, { allow500: true });
  await page.setViewportSize({ width: 1440, height: 900 });

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
