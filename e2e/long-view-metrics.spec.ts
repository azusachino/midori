import { expect, type Page, test } from "@playwright/test";
import { changesStub, metricsIndexStub } from "../web/src/api/fixtures";
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

test("Long view tab against real server renders per-year ECharts calendar (2025 & 2026), seam mark, and opens evidence sheet on click", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto("/metrics/hrv_sdnn?range=90d&tab=long");
  const panel = page.getByTestId("long-view-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Synthetic Watch A");
  await expect(panel).toContainText("Synthetic Watch B");
  await expect(panel).toContainText("Partial (hatched)");
  await expect(panel).toContainText("Device seam (Oct 16)");

  const canvas = page.getByTestId("long-view-echart").locator("canvas");
  await expect(canvas).toBeVisible();

  // Verify sr-only calendar table includes both 2025 & 2026 and seam mark
  const srTable = page.getByTestId("long-view-echart").locator("table");
  await expect(srTable).toContainText("2025");
  await expect(srTable).toContainText("2026");
  await expect(srTable).toContainText("offset (Oct 16)");

  await assertNoHorizontalOverflow(page);
  await snapShot(page, "int-long-view-1440.png");

  // Click a populated Oct/Nov 2026 cell inside the 2026 calendar block (top=216, week col ~42/53)
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();
  if (canvasBox) {
    const colWidth = (canvasBox.width - 70) / 53;
    await page.mouse.click(canvasBox.x + 52 + colWidth * 42.5, canvasBox.y + 216 + 16 * 3.5);
    await expect(page).toHaveURL(/night=2026-\d{2}-\d{2}/);
    await expect(page.getByTestId("evidence-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("evidence-sheet")).toBeHidden();
  }

  // Mobile 390px layout
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await snapShot(page, "int-long-view-390.png");

  expect(errors).toEqual([]);
});

test("Metrics index /metrics against real server shows ordered groups, mini charts, No data yet, and card navigation at 180d", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto("/metrics");
  await expect(page.getByTestId("metrics-index-page")).toBeVisible();
  const groupIds = await page
    .locator('[data-testid^="metrics-group-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(groupIds).toEqual([
    "metrics-group-overnight",
    "metrics-group-daytime",
    "metrics-group-trendOnly",
  ]);

  await expect(page.getByTestId("metric-mini-chart-hrv_sdnn").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("metric-no-data-hrv_rmssd")).toHaveText(
    copy.pages.metrics.noDataYet,
  );
  await expect(page.getByTestId("metric-card-vo2max")).toContainText(
    copy.pages.metrics.trendOnlySummary,
  );
  await assertNoHorizontalOverflow(page);
  await snapShot(page, "int-metrics-1440.png");

  // Mobile 390px single-column stack
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
  await snapShot(page, "int-metrics-390.png");

  // Clicking a card navigates to Metric detail at 180d
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("metric-card-hrv_sdnn").click();
  await expect(page).toHaveURL(/\/metrics\/hrv_sdnn\?range=180d/);
  await expect(page.getByTestId("metric-echart").locator("canvas")).toBeVisible();

  expect(errors).toEqual([]);
});

test("Metrics index error retry and empty imports B-R4 (route-intercepted)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page, { allow500: true });

  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(changesStub()),
    }),
  );

  let mode: "error" | "empty" = "error";
  await page.route("**/api/metrics", (route) => {
    if (mode === "error") {
      mode = "empty";
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "metrics read failed" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(metricsIndexStub(false)),
    });
  });

  await page.goto("/metrics");
  await expect(page.getByTestId("read-error")).toContainText(copy.error.metricsTitle);
  await page.getByRole("button", { name: copy.error.retry }).click();
  await expect(page.getByTestId("empty-state")).toBeVisible();

  expect(errors).toEqual([]);
});
