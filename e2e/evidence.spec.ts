import { expect, type Page, test } from "@playwright/test";
import { unitEvidenceStub } from "../web/src/api/fixtures";
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

test("checks panel (B-C1–B-C6), evidence sheet interactions, URL sync, Esc, copy link, chart click, and mobile sheet against real server", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart");

  const checksPanel = page.getByTestId("checks-panel");
  await expect(checksPanel).toBeVisible();
  await expect(page.getByTestId("check-row-device_change")).toHaveAttribute(
    "data-status",
    "flagged",
  );
  await expect(page.getByTestId("check-row-os_update")).toHaveAttribute("data-status", "flagged");
  await expect(page.getByTestId("check-row-tz_change")).toHaveAttribute("data-status", "flagged");
  await expect(page.getByTestId("check-row-low_trust")).toHaveAttribute("data-status", "clear");
  await expect(page.getByTestId("check-row-low_trust")).toContainText("Trust: moderate");

  const recentTable = page.getByTestId("recent-units-table");
  await expect(recentTable.locator('tbody tr[data-usable="true"]')).toHaveCount(7);
  await expect(recentTable.locator('tbody tr[data-usable="false"]')).toHaveCount(1);

  const nov11Row = recentTable.locator("tbody tr", {
    has: page.getByTestId("recent-row-btn-2026-11-11"),
  });
  await expect(nov11Row).toHaveAttribute("data-usable", "false");
  await expect(nov11Row.locator("td").nth(2)).toHaveText("—");
  await expect(nov11Row.locator("td").nth(4)).toContainText(copy.chart.partialGeneric);

  await assertNoHorizontalOverflow(page);

  // Keyboard navigation on Recent nights row opens ?night= evidence sheet
  const rowBtn = page.getByTestId("recent-row-btn-2026-11-14");
  await rowBtn.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/night=2026-11-14/);
  const sheet = page.getByTestId("evidence-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("evidence-sheet-title")).toContainText(
    "Night of Sat Nov 14 · HRV (SDNN)",
  );
  await expect(page.getByTestId("evidence-summary-line")).toContainText(
    "median of 3 samples, 21:00–09:00 Asia/Tokyo",
  );
  await expect(page.getByTestId("evidence-usability-badge")).toHaveText("usable");
  await expect(page.getByTestId("evidence-samples-list")).toBeVisible();
  await expect(page.getByTestId("evidence-sleep-panel")).toBeVisible();
  await expect(sheet.getByTestId("sleep-stage-bar")).toBeVisible();
  await expect(sheet.getByTestId("sleep-stage-legend")).toContainText("Deep");
  await snapShot(page, "int-evidence-1440.png", { fullPage: false });

  // Copy link button updates confirmation state
  await page.getByTestId("evidence-copy-link-btn").click();
  await expect(page.getByTestId("evidence-copy-link-btn")).toContainText(
    copy.pages.metricDetail.evidence.copiedLink,
  );

  // Escape closes sheet, clears ?night=, and restores focus to trigger (L2)
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page).not.toHaveURL(/night=/);
  await expect(rowBtn).toBeFocused();

  // Close button also restores focus to trigger
  const rowBtn13 = page.getByTestId("recent-row-btn-2026-11-13");
  await rowBtn13.click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: copy.pages.metricDetail.evidence.closeLabel }).click();
  await expect(sheet).toBeHidden();
  await expect(rowBtn13).toBeFocused();

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
  await expect(page).toHaveURL(/night=2026-\d{2}-\d{2}/);
  await page.keyboard.press("Escape");

  // Mobile 390px full-screen sheet
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart&night=2026-11-14");
  await expect(sheet).toBeVisible();
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox).not.toBeNull();
  if (sheetBox) {
    expect(sheetBox.width).toBeGreaterThanOrEqual(388);
    expect(sheetBox.height).toBeGreaterThanOrEqual(840);
  }
  await assertNoHorizontalOverflow(page);
  await snapShot(page, "int-evidence-390.png", { fullPage: false });

  // Empty gap night on real server ("No samples stored for this night")
  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart&night=2026-11-10");
  await expect(page.getByTestId("evidence-summary-line")).toHaveText(
    copy.pages.metricDetail.evidence.noSamplesNight,
  );
  await expect(page.getByTestId("evidence-samples-list")).toBeHidden();

  // Trend-only vo2max hides Checks panel on real server
  await page.goto("/metrics/vo2max?range=90d&tab=chart");
  await expect(page.getByTestId("trend-only-note")).toBeVisible();
  await expect(page.getByTestId("checks-panel")).toHaveCount(0);
  await expect(page.getByTestId("recent-units-table")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});

test("evidence sheet read error and retry recovery (route-intercepted)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = trackErrors(page, { allow500: true });

  let failedOnce = false;
  await page.route("**/api/metrics/hrv_sdnn/units/**", (route) => {
    if (!failedOnce) {
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
      body: JSON.stringify(unitEvidenceStub("hrv_sdnn", "2026-11-14")),
    });
  });

  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart&night=2026-11-14");
  await expect(page.getByTestId("read-error")).toContainText(
    copy.pages.metricDetail.evidence.loadError,
  );
  await page.getByRole("button", { name: copy.error.retry }).click();
  await expect(page.getByTestId("evidence-sheet")).toBeVisible();
  await expect(page.getByTestId("evidence-sheet-title")).toContainText("Night of Sat Nov 14");

  expect(errors).toEqual([]);
});
