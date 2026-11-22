import { expect, type Page, test } from "@playwright/test";
import { changesStub } from "../web/src/api/fixtures";
import type { FindingsDiffDTO } from "../web/src/api/types";
import { copy } from "../web/src/copy";

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test("B-U1–B-U4/B-C7: add a note from evidence, see user_note flagged, then delete it from Changes", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart");

  // The seventh checks row exists and starts clear.
  await expect(page.getByTestId("check-row-user_note")).toHaveAttribute("data-status", "clear");

  // Open the newest usable night and add a note through the sheet's inline form.
  await page.getByTestId("recent-row-btn-2026-11-14").click();
  const sheet = page.getByTestId("evidence-sheet");
  await expect(sheet).toBeVisible();
  const notes = sheet.getByTestId("evidence-notes");
  await expect(notes).toBeVisible();
  await notes.getByTestId("note-label-input").fill("Long flight");
  await notes.getByTestId("note-category-select").selectOption("travel");
  await notes.getByTestId("note-save-btn").click();

  const created = notes.locator('[data-testid^="note-row-"]');
  await expect(created).toHaveCount(1);
  await expect(created).toContainText("Long flight");
  await expect(created).toContainText("Travel");
  await expect(created).toContainText("2026-11-14");

  // Closing the sheet leaves the live checks panel flagged (B-C7) with an in-window day link.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("check-row-user_note")).toHaveAttribute("data-status", "flagged");
  await expect(page.getByTestId("check-day-link-user_note")).toBeVisible();

  // Edit from the sheet persists the new label.
  await page.getByTestId("recent-row-btn-2026-11-14").click();
  const row = sheet.locator('[data-testid^="note-row-"]');
  await row.locator('[data-testid^="note-edit-btn-"]').click();
  await sheet.getByTestId("note-label-input").fill("Long flight home");
  await sheet.getByTestId("note-save-btn").click();
  await expect(sheet.locator('[data-testid^="note-row-"]')).toContainText("Long flight home");
  await page.keyboard.press("Escape");

  // Changes lists recent notes and can delete them; the check returns to clear.
  await page.goto("/");
  const changesNotes = page.getByTestId("changes-notes");
  await expect(changesNotes).toBeVisible();
  await expect(changesNotes.locator('[data-testid^="note-row-"]')).toContainText(
    "Long flight home",
  );
  await changesNotes.locator('[data-testid^="note-delete-btn-"]').click();
  await expect(changesNotes.getByTestId("notes-empty")).toBeVisible();

  await page.goto("/metrics/hrv_sdnn?range=90d&tab=chart");
  await expect(page.getByTestId("check-row-user_note")).toHaveAttribute("data-status", "clear");

  expect(errors).toEqual([]);
});

test("B-F15: Changes renders the 'Since previous export' card for a supplied diff", async ({
  page,
}) => {
  const diff: FindingsDiffDTO = {
    fromImportId: 1,
    toImportId: 2,
    fromAsOfDay: "2026-02-07",
    toAsOfDay: "2026-02-14",
    unchangedCount: 3,
    items: [
      {
        metric: "hrv_sdnn",
        kind: "overnight",
        classification: "newly_notable",
        previous: {
          state: "computed",
          severity: "within",
          direction: "within",
          z: 0.3,
          confidence: "high",
        },
        current: {
          state: "computed",
          severity: "notable",
          direction: "lower",
          z: 1.8,
          confidence: "high",
        },
      },
      {
        metric: "sleep_h",
        kind: "overnight",
        classification: "returned_to_usual",
        previous: {
          state: "computed",
          severity: "alert",
          direction: "higher",
          z: 2.7,
          confidence: "high",
        },
        current: {
          state: "computed",
          severity: "within",
          direction: "within",
          z: 0.4,
          confidence: "high",
        },
      },
    ],
  };
  const stub = { ...changesStub(), sinceLastImport: diff, recentNotes: [] };
  await page.route("**/api/changes", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stub) }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const card = page.getByTestId("since-last-import");
  await expect(card).toBeVisible();
  await expect(card).toContainText(copy.diff.title);
  await expect(card).toContainText("Feb 7 → Feb 14");
  await expect(card).toContainText("HRV (SDNN): newly notable");
  await expect(card).toContainText("Sleep: returned to usual");
  await expect(card).toContainText(copy.diff.unchanged(3));

  // The notes panel is present alongside the diff.
  await expect(page.getByTestId("changes-notes")).toBeVisible();
});
