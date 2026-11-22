import { expect, type Page, test } from "@playwright/test";
import { changesStub } from "../web/src/api/fixtures";
import type { FindingsDiffDTO } from "../web/src/api/types";
import { copy } from "../web/src/copy";
import { snapShot } from "./shots";

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

  // Changes shows a compact note chip; deleting inside ContextSheet clears it and the check.
  await page.goto("/");
  const changesNotes = page.getByTestId("changes-notes");
  await expect(changesNotes).toBeVisible();
  await expect(changesNotes.locator('[data-testid^="note-chip-"]')).toContainText(
    "Long flight home",
  );
  await changesNotes.getByTestId("manage-notes-btn").click();
  const contextSheet = page.getByTestId("context-sheet");
  await expect(contextSheet).toBeVisible();
  const contextNotes = contextSheet.getByTestId("context-notes");
  await expect(contextNotes.locator('[data-testid^="note-row-"]')).toContainText(
    "Long flight home",
  );
  await contextNotes.locator('[data-testid^="note-delete-btn-"]').click();
  await expect(contextNotes.getByTestId("notes-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(contextSheet).toBeHidden();
  await expect(page.getByTestId("changes-notes")).toHaveCount(0);

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

  // With no recent notes the compact strip is absent; the hero trigger opens the sheet.
  await expect(page.getByTestId("open-notes-sheet")).toBeVisible();
  await expect(page.getByTestId("changes-notes")).toHaveCount(0);
});

test("B-P1: the hero ContextSheet saves and reloads the agent profile", async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByTestId("open-profile-sheet").click();
  const sheet = page.getByTestId("context-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("context-tab-profile")).toHaveAttribute("data-state", "active");
  const goals = sheet.getByTestId("profile-goals-input");
  await goals.fill("Sleep 7.5 h");
  await sheet.getByTestId("profile-routine-input").fill("Lift Mon/Wed/Fri");
  await snapShot(page, "context-sheet-1440.png");
  await sheet.getByTestId("profile-save-btn").click();
  await expect(sheet.getByTestId("profile-saved")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Reopening reads the stored row back from the server.
  await page.getByTestId("open-profile-sheet").click();
  await expect(sheet.getByTestId("profile-goals-input")).toHaveValue("Sleep 7.5 h");
  await expect(sheet.getByTestId("profile-routine-input")).toHaveValue("Lift Mon/Wed/Fri");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sheet.getByTestId("profile-goals-input")).toBeVisible();
  await snapShot(page, "context-sheet-390.png", { fullPage: false });

  expect(errors).toEqual([]);
});
