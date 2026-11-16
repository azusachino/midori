import { expect, type Page, test } from "@playwright/test";
import { emptyChangesStub } from "../web/src/api/fixtures";
import { copy } from "../web/src/copy";

function trackErrors(page: Page, opts?: { allow404?: boolean; allow500?: boolean }): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (
      opts?.allow404 &&
      text.includes("Failed to load resource: the server responded with a status of 404")
    ) {
      return;
    }
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

test("desktop 1440px: v1 shell, lazy routes, EChart render against real server", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto("/");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav")).toBeVisible();
  await expect(page.getByTestId("mobile-nav")).toBeHidden();
  await expect(page.getByTestId("topbar-freshness")).toContainText("Data through Nov 14 (Sat)");
  await expect(page.getByTestId("sidebar-watch")).toContainText("Synthetic Watch B");

  await assertNoHorizontalOverflow(page);

  // Navigate to lazy-loaded Metrics index
  await page.getByTestId("sidebar-nav").getByRole("link", { name: copy.nav.metrics }).click();
  await expect(page).toHaveURL(/\/metrics$/);
  await expect(page.getByRole("heading", { name: copy.pages.metrics.title })).toBeVisible();

  // Navigate to lazy-loaded Metric detail and verify URL search param sync + EChart
  await page.goto("/metrics/hrv_sdnn");
  const metricCanvas = page.getByTestId("metric-echart").locator("canvas");
  await expect(metricCanvas).toBeVisible();
  const metricBox = await metricCanvas.boundingBox();
  expect((metricBox?.width ?? 0) > 200 && (metricBox?.height ?? 0) > 100).toBe(true);

  await page.getByRole("button", { name: "1y" }).click();
  await expect(page).toHaveURL(/range=1y/);
  await page.getByRole("tab", { name: copy.pages.metricDetail.tabs.long }).click();
  await expect(page).toHaveURL(/tab=long/);

  // Long page: the sidebar watch card sits under the nav and stays on screen when scrolled
  const navBox = await page.getByTestId("sidebar-nav").boundingBox();
  const watchTop = (await page.getByTestId("sidebar-watch").boundingBox())?.y ?? Infinity;
  expect(watchTop - ((navBox?.y ?? 0) + (navBox?.height ?? 0))).toBeLessThan(64);
  await page.setViewportSize({ width: 1440, height: 480 });
  expect(await page.evaluate(() => document.body.scrollHeight > window.innerHeight)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrolled = await page.getByTestId("sidebar-watch").boundingBox();
  expect((scrolled?.y ?? -1) >= 0 && (scrolled?.y ?? 480) < 480).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Navigate to Devices & verify timeline EChart
  await page.getByTestId("sidebar-nav").getByRole("link", { name: copy.nav.devices }).click();
  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByTestId("device-timeline-echart").locator("canvas")).toBeVisible();

  // Navigate to Import
  await page.getByTestId("sidebar-nav").getByRole("link", { name: copy.nav.import }).click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByTestId("import-dropzone")).toBeVisible();

  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("phone 390px: top tabs replace sidebar and freshness moves to its own line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = trackErrors(page);

  await page.goto("/");

  await expect(page.getByTestId("mobile-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav")).toBeHidden();
  await expect(page.getByTestId("topbar-freshness")).toBeVisible();

  const brandBox = await page.getByRole("link", { name: copy.app.name }).boundingBox();
  const freshnessBox = await page.getByTestId("topbar-freshness").boundingBox();
  expect(brandBox).not.toBeNull();
  expect(freshnessBox).not.toBeNull();
  expect((freshnessBox?.y ?? 0) >= (brandBox?.y ?? 0) + (brandBox?.height ?? 0) - 2).toBe(true);

  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("surfaces ReadError on HTTP 404 instead of synthetic data (route-intercepted)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page, { allow404: true });
  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not found", retryable: false }),
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("read-error")).toBeVisible();
  await expect(page.getByTestId("read-error")).toContainText(copy.error.changesTitle);
  await expect(page.getByText("Synthetic Watch B")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("B-R4 empty state renders at 1440px and 390px when no imports exist (route-intercepted)", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(emptyChangesStub()),
    }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("topbar-freshness")).toHaveText(copy.topbar.noImports);
  await expect(page.getByRole("link", { name: copy.empty.cta })).toHaveAttribute("href", "/import");
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("mobile-nav")).toBeVisible();
  await assertNoHorizontalOverflow(page);

  expect(errors).toEqual([]);
});

test("top bar importing pill, loading skeletons, and read-error retry primitive (route-intercepted)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page, { allow500: true });
  let attempts = 0;
  let finishImport = false;
  await page.route("**/api/changes", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await new Promise((r) => setTimeout(r, 150));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "database busy", retryable: true }),
      });
      return;
    }
    const stub = {
      ...emptyChangesStub(),
      hasImports: true,
      asOfDay: finishImport ? "2026-03-02" : "2026-03-01",
      freshness: {
        asOfDay: finishImport ? "2026-03-02" : "2026-03-01",
        lastImportAt: "2026-03-02T08:00:00Z",
        daysSinceImport: finishImport ? 0 : 2,
      },
      activeImport: finishImport
        ? null
        : {
            id: 9,
            zipName: "export.zip",
            zipSize: 1_000_000,
            status: "parsing",
            stage: "parsing",
            progress: 620_000,
            progressTotal: 1_000_000,
            error: null,
            exportVersion: null,
            recordsSeen: null,
            recordsInserted: null,
            recordsDeduped: null,
            durationMs: null,
            createdAt: "2026-03-02T08:00:00Z",
          },
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(stub),
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("loading-state")).toBeVisible();
  await expect(page.getByTestId("read-error")).toBeVisible();
  await expect(page.getByTestId("read-error")).toContainText("database busy");

  await page.getByRole("button", { name: copy.error.retry }).click();
  await expect(page.getByTestId("importing-pill")).toContainText("Import running · parsing 62%");
  await expect(page.getByTestId("topbar-freshness")).toContainText("imported 2 days ago");

  // M2: activeImport triggers /api/changes polling every 1.5s and clears pill on completion
  finishImport = true;
  await expect(page.getByTestId("importing-pill")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("topbar-freshness")).toContainText("Data through Mar 2 (Mon)");
  expect(errors).toEqual([]);
});
