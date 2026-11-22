import { expect, type Page, test } from "@playwright/test";
import { buildE2eCorpusXml, buildE2eIncrementalUpdateXml } from "../scripts/e2e/corpus";
import { buildStoredZip } from "../tests/util/mkzip";
import { copy } from "../web/src/copy";
import { snapShot } from "./shots";

test.describe.configure({ mode: "serial" });

function trackErrors(
  page: Page,
  opts?: { allow400?: boolean; allow410?: boolean; allowConnectionReset?: boolean },
): string[] {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (
      opts?.allow400 &&
      text.includes("Failed to load resource: the server responded with a status of 400")
    ) {
      return;
    }
    if (
      opts?.allow410 &&
      text.includes("Failed to load resource: the server responded with a status of 410")
    ) {
      return;
    }
    if (opts?.allowConnectionReset && text.includes("net::ERR_CONNECTION_RESET")) {
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

function zipPayload(name: string, files: Array<{ name: string; data: string | Buffer }>) {
  return {
    name,
    mimeType: "application/zip",
    buffer: buildStoredZip(files),
  };
}

test("real server 1440px: fixture upload -> summary", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto("/import");
  await expect(page.getByTestId("import-dropzone")).toBeVisible();
  const table = page.getByTestId("import-history-table");
  await expect(table).toContainText(copy.status.done);
  await expect(table).toContainText(/1[,.]?327/);
  const initialRows = await table.locator("tbody tr").count();
  await snapShot(page, "int-import-1440.png");

  const payload = zipPayload("incremental-export.zip", [
    { name: "apple_health_export/export.xml", data: buildE2eIncrementalUpdateXml("2026-08-20") },
  ]);
  await page.getByLabel(copy.pages.import.fileInputLabel).setInputFiles(payload);

  const summary = page.getByTestId("import-summary");
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary).not.toContainText(copy.pages.import.summary.nothingNew);
  await expect(summary).toContainText("new records");
  await expect(summary).toContainText("Data through Nov 14 (Sat)");
  await expect(
    summary.getByRole("link", { name: copy.pages.import.summary.seeChangesCta }),
  ).toHaveAttribute("href", "/");
  await expect(table.locator("tbody tr")).toHaveCount(initialRows + 1);

  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('real server 1440px: duplicate export -> "Nothing new"', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto("/import");
  await expect(page.getByTestId("import-dropzone")).toBeVisible();

  const duplicate = zipPayload("e2e-duplicate.zip", [
    { name: "apple_health_export/export.xml", data: buildE2eCorpusXml() },
  ]);
  await page.getByLabel(copy.pages.import.fileInputLabel).setInputFiles(duplicate);

  const summary = page.getByTestId("import-summary");
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText(copy.pages.import.summary.nothingNew);
  await expect(summary).toContainText("already known");

  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("real server 1440px: bad file (missing export.xml) -> B-I1 copy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page, { allow400: true });

  await page.goto("/import");
  await expect(page.getByTestId("import-dropzone")).toBeVisible();

  const badZip = zipPayload("no-export.zip", [{ name: "notes.txt", data: "not a health export" }]);
  await page.getByLabel(copy.pages.import.fileInputLabel).setInputFiles(badZip);

  const alert = page.getByTestId("import-error-alert");
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText(copy.pages.import.errors.notHealthExport);
  await expect(page.getByTestId("dropzone-busy")).toHaveCount(0);

  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("real server 390px: upload through file input", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = trackErrors(page);

  await page.goto("/import");
  await expect(page.getByTestId("import-dropzone")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await snapShot(page, "int-import-390.png");

  const payload = zipPayload("mobile-export.zip", [
    { name: "apple_health_export/export.xml", data: buildE2eIncrementalUpdateXml("2026-08-21") },
  ]);
  await page.getByLabel(copy.pages.import.fileInputLabel).setInputFiles(payload);

  const summary = page.getByTestId("import-summary");
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(summary).toContainText("new records");

  const table = page.getByTestId("import-history-table");
  const statusHeader = table.getByRole("columnheader", { name: copy.pages.import.rowStatus });
  const firstDone = table.locator("tbody tr").first().getByText(copy.status.done);
  await expect(statusHeader).toBeVisible();
  await expect(firstDone).toBeVisible();
  const statusBox = await statusHeader.boundingBox();
  const doneBox = await firstDone.boundingBox();
  expect(statusBox).not.toBeNull();
  expect(doneBox).not.toBeNull();
  expect((statusBox?.x ?? 0) >= 0 && (statusBox?.x ?? 0) + (statusBox?.width ?? 0) <= 390).toBe(
    true,
  );
  expect((doneBox?.x ?? 0) >= 0 && (doneBox?.x ?? 0) + (doneBox?.width ?? 0) <= 390).toBe(true);

  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("§8 states: uploading progress, running stage/progress stepper, B-I2 busy lock, and new device summary (route-intercepted)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  let releaseUpload!: () => void;
  const uploadHeld = new Promise<void>((r) => {
    releaseUpload = r;
  });
  let releaseDone!: () => void;
  const doneHeld = new Promise<void>((r) => {
    releaseDone = r;
  });

  let detailPoll = 0;
  let postStarted = false;
  let hasCompleted = false;
  const startedAt = new Date(Date.now() - 41_000).toISOString();

  const priorDoneRow = {
    id: 90,
    zipName: "seed-watch.zip",
    zipSize: 1_000_000,
    status: "done",
    stage: "deriving",
    progress: 1_000_000,
    progressTotal: 1_000_000,
    error: null,
    exportVersion: "11",
    exportDate: "2026-02-01",
    recordsSeen: 100,
    recordsInserted: 100,
    recordsDeduped: 0,
    newUsableNights: 10,
    newEpochs: [],
    olderThanStored: false,
    durationMs: 500,
    createdAt: "2026-02-01T00:00:00Z",
  };

  await page.route("**/api/imports", async (route) => {
    if (route.request().method() === "POST") {
      postStarted = true;
      await uploadHeld;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ importId: 91, status: "queued" }),
      });
      return;
    }
    if (!postStarted) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([priorDoneRow]),
      });
      return;
    }
    const row = hasCompleted
      ? {
          id: 91,
          zipName: "watch-c.zip",
          zipSize: 2_400_000,
          status: "done",
          stage: "deriving",
          progress: 1_000_000,
          progressTotal: 1_000_000,
          error: null,
          exportVersion: "11",
          exportDate: "2026-03-02",
          asOfDay: "2026-03-01",
          recordsSeen: 432,
          recordsInserted: 420,
          recordsDeduped: 12,
          newUsableNights: 3,
          newEpochs: ["Synthetic Watch C"],
          olderThanStored: false,
          durationMs: 2_300,
          createdAt: startedAt,
        }
      : {
          id: 91,
          zipName: "watch-c.zip",
          zipSize: 2_400_000,
          status: "parsing",
          stage: "parsing",
          progress: 640_000,
          progressTotal: 1_000_000,
          error: null,
          exportVersion: "11",
          recordsSeen: null,
          recordsInserted: null,
          recordsDeduped: null,
          newUsableNights: null,
          newEpochs: [],
          durationMs: null,
          createdAt: startedAt,
        };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([row, priorDoneRow]),
    });
  });

  await page.route("**/api/imports/91/diff", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        diff: {
          fromImportId: 90,
          toImportId: 91,
          fromAsOfDay: "2026-02-22",
          toAsOfDay: "2026-03-01",
          unchangedCount: 4,
          items: [
            {
              metric: "sleep_h",
              kind: "overnight",
              classification: "returned_to_usual",
              previous: {
                state: "computed",
                severity: "alert",
                direction: "lower",
                z: -2.8,
                confidence: "high",
              },
              current: {
                state: "computed",
                severity: "within",
                direction: "within",
                z: -0.4,
                confidence: "high",
              },
            },
          ],
        },
      }),
    });
  });

  await page.route("**/api/imports/91", async (route) => {
    detailPoll += 1;
    if (detailPoll === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 91,
          zipName: "watch-c.zip",
          zipSize: 2_400_000,
          status: "parsing",
          stage: "parsing",
          progress: 640_000,
          progressTotal: 1_000_000,
          error: null,
          exportVersion: "11",
          recordsSeen: null,
          recordsInserted: null,
          recordsDeduped: null,
          newUsableNights: null,
          newEpochs: [],
          durationMs: null,
          createdAt: startedAt,
        }),
      });
      return;
    }
    await doneHeld;
    hasCompleted = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 91,
        zipName: "watch-c.zip",
        zipSize: 2_400_000,
        status: "done",
        stage: "deriving",
        progress: 1_000_000,
        progressTotal: 1_000_000,
        error: null,
        exportVersion: "11",
        exportDate: "2026-03-02",
        asOfDay: "2026-03-01",
        recordsSeen: 432,
        recordsInserted: 420,
        recordsDeduped: 12,
        newUsableNights: 3,
        newEpochs: ["Synthetic Watch C"],
        olderThanStored: false,
        durationMs: 2_300,
        createdAt: startedAt,
      }),
    });
  });

  await page.goto("/import");
  await expect(page.getByTestId("import-dropzone")).toBeVisible();

  await page.getByLabel(copy.pages.import.fileInputLabel).setInputFiles({
    name: "watch-c.zip",
    mimeType: "application/zip",
    buffer: Buffer.alloc(1024, 0x50),
  });

  const uploading = page.getByTestId("import-uploading");
  await expect(uploading).toBeVisible();
  await expect(uploading).toContainText(copy.pages.import.keepTabOpen);

  releaseUpload();

  const running = page.getByTestId("import-running");
  await expect(running).toBeVisible();
  await expect(running).toContainText(copy.pages.import.stages.parsing);
  await expect(running).toContainText("64%");
  await expect(running.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "64");
  await expect(running).toContainText(copy.pages.import.canCloseTab);
  await expect(page.getByTestId("dropzone-busy")).toContainText(copy.pages.import.dropzoneDisabled);

  releaseDone();

  const summary = page.getByTestId("import-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("420 new records");
  await expect(summary).toContainText("12 already known");
  await expect(summary).toContainText("3 new usable nights");
  await expect(summary).toContainText("Data through Mar 1 (Sun)");
  await expect(summary).toContainText("New device: Synthetic Watch C");
  const diffSummary = page.getByTestId("import-diff-summary");
  await expect(diffSummary).toBeVisible();
  await expect(diffSummary).toContainText("Sleep: returned to usual");
  await expect(diffSummary).toContainText("4 metrics unchanged");
  expect(errors).toEqual([]);
});

test("§8 states: B-I4 older export warning and B-I11 upload interruption (route-intercepted)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page, { allowConnectionReset: true });

  let mode: "abort" | "older" = "abort";

  await page.route("**/api/imports", async (route) => {
    if (route.request().method() === "POST") {
      if (mode === "abort") {
        await route.abort("connectionreset");
        return;
      }
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ importId: 92, status: "queued" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/imports/92", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 92,
        zipName: "older.zip",
        zipSize: 1024,
        status: "done",
        stage: "deriving",
        progress: 1024,
        progressTotal: 1024,
        error: null,
        exportVersion: "11",
        exportDate: "2026-01-10",
        recordsSeen: 50,
        recordsInserted: 0,
        recordsDeduped: 50,
        newUsableNights: 0,
        newEpochs: [],
        olderThanStored: true,
        durationMs: 400,
        createdAt: "2026-03-02T09:00:00Z",
      }),
    });
  });

  await page.goto("/import");

  // Trigger upload interruption (B-I11)
  await page.getByLabel(copy.pages.import.fileInputLabel).setInputFiles({
    name: "older.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("zip"),
  });
  await expect(page.getByTestId("import-error-alert")).toContainText(
    copy.pages.import.errors.uploadInterrupted,
  );
  await expect(page.getByTestId("dropzone-busy")).toHaveCount(0);

  // Now complete upload with olderThanStored: true (B-I4)
  mode = "older";
  await page.getByLabel(copy.pages.import.fileInputLabel).setInputFiles({
    name: "older.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("zip"),
  });
  await expect(page.getByTestId("older-export-warning")).toContainText(
    copy.pages.import.summary.olderExportWarning,
  );
  expect(errors).toEqual([]);
});

test("§8 states: empty history, B-I5/B-I10 failed job card, Retry -> done, and 410 expired retry (route-intercepted)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page, { allow410: true });

  let scenario: "empty" | "retry-ok" | "retry-410" = "empty";
  let retryCompleted = false;

  await page.route("**/api/imports", async (route) => {
    if (scenario === "empty") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    const id = scenario === "retry-ok" ? 55 : 56;
    const row =
      scenario === "retry-ok" && retryCompleted
        ? {
            id,
            zipName: "export-retry.zip",
            zipSize: 2048,
            status: "done",
            stage: "deriving",
            progress: 1_000_000,
            progressTotal: 1_000_000,
            error: null,
            exportVersion: "11",
            recordsSeen: 100,
            recordsInserted: 100,
            recordsDeduped: 0,
            newUsableNights: 2,
            newEpochs: ["First Watch"],
            durationMs: 900,
            createdAt: "2026-03-02T09:00:00Z",
          }
        : {
            id,
            zipName: scenario === "retry-ok" ? "export-retry.zip" : "export-expired.zip",
            zipSize: 2048,
            status: "failed",
            stage: "parsing",
            progress: 400_000,
            progressTotal: 1_000_000,
            error: "interrupted by restart",
            retryable: true,
            exportVersion: "11",
            recordsSeen: null,
            recordsInserted: null,
            recordsDeduped: null,
            newUsableNights: null,
            newEpochs: [],
            durationMs: null,
            createdAt: "2026-03-02T09:00:00Z",
          };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([row]),
    });
  });

  await page.route("**/api/imports/55/retry", async (route) => {
    retryCompleted = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ importId: 55, status: "queued" }),
    });
  });

  await page.route("**/api/imports/55/diff", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ diff: null }),
    });
  });

  await page.route("**/api/imports/55", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 55,
        zipName: "export-retry.zip",
        zipSize: 2048,
        status: "done",
        stage: "deriving",
        progress: 1_000_000,
        progressTotal: 1_000_000,
        error: null,
        exportVersion: "11",
        recordsSeen: 100,
        recordsInserted: 100,
        recordsDeduped: 0,
        newUsableNights: 2,
        newEpochs: ["First Watch"],
        durationMs: 900,
        createdAt: "2026-03-02T09:00:00Z",
      }),
    });
  });

  await page.route("**/api/imports/56/retry", async (route) => {
    await route.fulfill({
      status: 410,
      contentType: "application/json",
      body: JSON.stringify({ error: "upload spool expired", retryable: false }),
    });
  });

  // 1. Empty history state
  await page.goto("/import");
  await expect(page.getByText(copy.pages.import.noImportsYet)).toBeVisible();

  // 2. Failed job card + successful retry
  scenario = "retry-ok";
  await page.reload();
  const failedCard = page.getByTestId("import-failed-card");
  await expect(failedCard).toBeVisible();
  await expect(failedCard).toContainText("Parsing");
  await expect(failedCard).toContainText("interrupted by restart");

  await failedCard.getByRole("button", { name: copy.pages.import.failed.retry }).click();
  await expect(page.getByTestId("import-summary")).toBeVisible();
  await expect(page.getByTestId("import-summary")).toContainText("100 new records");
  await expect(page.getByTestId("import-summary")).not.toContainText("New device:");

  // 3. Expired retry -> 410 -> "Upload the file again."
  scenario = "retry-410";
  await page.reload();
  await expect(page.getByTestId("import-failed-card")).toBeVisible();
  await page
    .getByTestId("import-failed-card")
    .getByRole("button", { name: copy.pages.import.failed.retry })
    .click();
  await expect(page.getByTestId("import-failed-card")).toContainText(
    copy.pages.import.errors.retryExpired,
  );
  await expect(
    page
      .getByTestId("import-failed-card")
      .getByRole("button", { name: copy.pages.import.failed.retry }),
  ).toHaveCount(0);

  expect(errors).toEqual([]);
});
