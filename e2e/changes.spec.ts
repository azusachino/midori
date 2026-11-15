import { expect, type Page, test } from "@playwright/test";
import { allWithinChangesStub, emptyChangesStub, staleChangesStub } from "../web/src/api/fixtures";
import { copy } from "../web/src/copy";
import { OVERNIGHT_ORDER } from "../web/src/lib/metrics";
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

test("Changes page: real server overnight/daytime findings, popovers, last night, and navigation at 1440px & 390px", async ({
  page,
}) => {
  const errors = trackErrors(page);

  // Desktop 1440px
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: copy.pages.changes.title })).toBeVisible();
  await expect(page.getByText("as of Nov 14 (Sat)")).toBeVisible();

  // Warming-up notice for SpO2 (10/14)
  const warmingNotice = page.getByTestId("warming-notice");
  await expect(warmingNotice).toBeVisible();
  await expect(warmingNotice).toContainText(
    "Learning your new watch — SpO₂: 10 of 14 usable nights. First reading around Nov 18.",
  );
  await expect(
    warmingNotice.getByRole("link", { name: copy.pages.changes.devicesCta }),
  ).toHaveAttribute("href", "/devices");

  // Full overnight list from real server (8 overnight metrics present in corpus, ranked by alert first)
  const overnightRows = page
    .getByTestId("overnight-section")
    .locator('[data-testid^="finding-row-"]');
  await expect(overnightRows).toHaveCount(8);
  await expect(overnightRows.nth(0)).toHaveAttribute("data-testid", "finding-row-rhr");
  await expect(overnightRows.nth(1)).toHaveAttribute("data-testid", "finding-row-hrv_sdnn");
  await expect(overnightRows.nth(1)).toContainText("lower than usual");
  await expect(page.getByTestId("finding-row-spo2")).toContainText("learning · 10 of 14 nights");

  // Daytime: notable/alert only (steps alert shown; within metrics hidden)
  const daytime = page.getByTestId("daytime-section");
  await expect(daytime).toBeVisible();
  await expect(daytime.getByTestId("finding-row-steps")).toBeVisible();
  await expect(daytime.getByTestId("finding-row-steps")).toContainText(copy.pages.changes.clippedZ);
  await expect(daytime.getByTestId("finding-row-active_kj")).toHaveCount(0);
  await expect(daytime.getByTestId("finding-row-heart_rate")).toHaveCount(0);

  // Last complete night card (B-R3)
  const lastNight = page.getByTestId("last-night-card");
  await expect(lastNight).toContainText("Last complete night — Nov 14 (Sat)");
  await expect(lastNight).toContainText("asleep 7.5 h · deep 1.5 · REM 1.5 · core 4.5");
  await expect(lastNight.getByTestId("sleep-stage-bar")).toBeVisible();
  const stageLegend = lastNight.getByTestId("sleep-stage-legend");
  await expect(stageLegend).toContainText("Deep");
  await expect(stageLegend).toContainText("REM");
  await expect(stageLegend).toContainText("Core");

  await snapShot(page, "int-changes-1440.png");
  await assertNoHorizontalOverflow(page);

  // Interactive trust & checks popovers without leaving /
  await page.getByTestId("trust-trigger-hrv_sdnn").click();
  await expect(page.getByTestId("trust-popover-hrv_sdnn")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("trust-popover-hrv_sdnn")).toHaveCount(0);

  await page.getByTestId("checks-trigger-hrv_sdnn").click();
  await expect(page.getByTestId("checks-popover-hrv_sdnn")).toContainText(copy.checks.tz_change);
  await page.keyboard.press("Escape");

  // Mobile 390px
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("finding-row-hrv_sdnn")).toBeVisible();
  await expect(page.getByTestId("last-night-card")).toBeVisible();
  await snapShot(page, "int-changes-390.png");
  await assertNoHorizontalOverflow(page);

  // Clicking a FindingRow navigates to /metrics/:key?range=90d
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("finding-row-hrv_sdnn").getByRole("link", { name: "HRV (SDNN)" }).click();
  await expect(page).toHaveURL(/\/metrics\/hrv_sdnn\?range=90d/);

  expect(errors).toEqual([]);
});

test('Changes §4 state: "All within" keeps all overnight rows visible at 1440px & 390px (route-intercepted)', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(allWithinChangesStub()),
    }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("all-within-banner")).toHaveText(
    `Nothing stands out across ${OVERNIGHT_ORDER.length} overnight metrics.`,
  );
  await expect(
    page.getByTestId("overnight-section").locator('[data-testid^="finding-row-"]'),
  ).toHaveCount(OVERNIGHT_ORDER.length);
  await expect(page.getByTestId("daytime-section")).toHaveCount(0);
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("all-within-banner")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});

test("Changes §4 states: stale banner (B-R2), stale rows (B-F2), >=10σ cap, low trust, open-ended onset, and no complete night (route-intercepted)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(staleChangesStub()),
    }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const staleBanner = page.getByTestId("stale-import-banner");
  await expect(staleBanner).toContainText(
    "Your last import was 34 days ago. Findings describe Feb 23–Mar 1.",
  );
  await expect(
    staleBanner.getByRole("link", { name: copy.pages.changes.staleImportCta }),
  ).toHaveAttribute("href", "/import");

  const topRow = page.getByTestId("finding-row-hrv_sdnn");
  await expect(topRow.getByTestId("low-trust-hrv_sdnn")).toHaveText(
    copy.pages.changes.lowTrustBadge,
  );
  await expect(topRow).toContainText(copy.pages.changes.clippedZ);
  await expect(topRow).toContainText("at least since Jan 25");
  await expect(topRow.getByTestId("sparkline")).toHaveAttribute("data-clipped", "true");

  await expect(page.getByTestId("finding-row-sleep_h")).toContainText("no recent nights");
  await expect(page.getByTestId("last-night-card")).toContainText(
    copy.pages.changes.lastNight.noneRecent,
  );

  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(staleBanner).toBeVisible();
  await expect(topRow).toBeVisible();
  await assertNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});

test("Changes §4 states: loading skeleton, read-error + retry, importing pill, and empty state (route-intercepted)", async ({
  page,
}) => {
  const errors = trackErrors(page, { allow500: true });
  let phase: "error" | "importing" | "empty" = "error";

  await page.route("**/api/changes", async (route) => {
    if (phase === "error") {
      await new Promise((r) => setTimeout(r, 120));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "changes unavailable", retryable: true }),
      });
      return;
    }
    if (phase === "importing") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...emptyChangesStub(),
          hasImports: true,
          asOfDay: "2026-03-01",
          freshness: {
            asOfDay: "2026-03-01",
            lastImportAt: "2026-03-02T08:00:00Z",
            daysSinceImport: 1,
          },
          activeImport: {
            id: 14,
            zipName: "export.zip",
            zipSize: 2048,
            status: "deriving",
            stage: "deriving",
            progress: 820_000,
            progressTotal: 1_000_000,
            error: null,
            exportVersion: null,
            recordsSeen: null,
            recordsInserted: null,
            recordsDeduped: null,
            durationMs: null,
            createdAt: "2026-03-02T08:00:00Z",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(emptyChangesStub()),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("loading-state")).toBeVisible();
  await expect(page.getByTestId("read-error")).toContainText("changes unavailable");

  phase = "importing";
  await page.getByRole("button", { name: copy.error.retry }).click();
  await expect(page.getByTestId("importing-pill")).toContainText("Import running · deriving 82%");

  phase = "empty";
  await page.reload();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});
