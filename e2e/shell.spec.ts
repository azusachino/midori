import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { emptyChangesStub } from "../web/src/api/fixtures";
import { copy } from "../web/src/copy";

const shotsDir = process.env.MIDORI_SHOTS_DIR;

async function maybeShot(page: Page, name: string) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: join(shotsDir, name), fullPage: true });
}

const V1_PENDING_API_RE = /\/api\/(changes|metrics|epochs|nights)(\/|\?|$)/;

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const locUrl = msg.location().url;
    // Slice 9 v1 REST endpoints are not implemented yet; client falls back on 404.
    if (msg.text().includes("404 (Not Found)") && V1_PENDING_API_RE.test(locUrl)) {
      return;
    }
    errors.push(msg.text());
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

test("desktop 1440px: v1 shell, routes, EChart smoke render, and seeded import", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto("/");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav")).toBeVisible();
  await expect(page.getByTestId("mobile-nav")).toBeHidden();
  await expect(page.getByTestId("topbar-freshness")).toContainText("Data through 2026-03-01");
  await expect(page.getByTestId("sidebar-watch")).toContainText("Synthetic Watch B");
  await expect(page.getByTestId("sidebar-watch")).toContainText("learning 9/14");

  const smokeCanvas = page.getByTestId("echart-smoke").locator("canvas");
  await expect(smokeCanvas).toBeVisible();
  const box = await smokeCanvas.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.width ?? 0) > 100 && (box?.height ?? 0) > 100).toBe(true);

  await assertNoHorizontalOverflow(page);
  await maybeShot(page, "shell-1440.png");

  // Navigate to Metrics index
  await page.getByTestId("sidebar-nav").getByRole("link", { name: copy.nav.metrics }).click();
  await expect(page).toHaveURL(/\/metrics$/);
  await expect(page.getByRole("heading", { name: copy.pages.metrics.title })).toBeVisible();

  // Navigate to Metric detail and verify URL search param sync + EChart
  await page.goto("/metrics/wrist_temp");
  await expect(page.getByTestId("metric-echart").locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "90d" }).click();
  await expect(page).toHaveURL(/range=90d/);

  // Navigate to Devices
  await page.getByTestId("sidebar-nav").getByRole("link", { name: copy.nav.devices }).click();
  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByText("Synthetic Watch B").first()).toBeVisible();

  // Navigate to Import and verify seeded fixture import
  await page.getByTestId("sidebar-nav").getByRole("link", { name: copy.nav.import }).click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByText("fixture.zip")).toBeVisible();
  await expect(page.getByText(copy.status.done).first()).toBeVisible();

  // Unknown metric + unknown route + 404 asset check
  await page.goto("/metrics/not_a_metric");
  await expect(page.getByTestId("unknown-metric")).toBeVisible();

  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { name: copy.pages.notFound.title })).toBeVisible();

  const missingAsset = await page.request.get("/assets/does-not-exist.js");
  expect(missingAsset.status()).toBe(404);

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

  await expect(page.getByTestId("echart-smoke").locator("canvas")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await maybeShot(page, "shell-390.png");

  expect(errors).toEqual([]);
});

test("B-R4 empty state renders at 1440px and 390px when no imports exist", async ({ page }) => {
  const errors = trackErrors(page);
  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(emptyChangesStub()),
    }),
  );

  // Desktop 1440px
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("topbar-freshness")).toHaveText(copy.topbar.noImports);
  await expect(page.getByRole("link", { name: copy.empty.cta })).toHaveAttribute("href", "/import");
  await assertNoHorizontalOverflow(page);
  await maybeShot(page, "empty-1440.png");

  // Phone 390px
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("mobile-nav")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await maybeShot(page, "empty-390.png");

  expect(errors).toEqual([]);
});

test("top bar importing pill, loading skeletons, and read-error retry primitive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let attempts = 0;
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
      asOfDay: "2026-03-01",
      freshness: {
        asOfDay: "2026-03-01",
        lastImportAt: "2026-03-02T08:00:00Z",
        daysSinceImport: 2,
      },
      activeImport: {
        id: 9,
        zipName: "export.zip",
        zipSize: 1024,
        status: "parsing",
        stage: "parsing",
        progress: 62,
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
});
