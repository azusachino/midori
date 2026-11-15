import { expect, type Page, test } from "@playwright/test";
import { changesStub, epochsStub, singleEpochStub } from "../web/src/api/fixtures";
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

test("Devices /devices against real server renders timeline, newest-first epoch cards, seam labels, OS updates, collapsible occasional sources, and navigates to metric detail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto("/devices");

  await expect(page.getByRole("heading", { name: copy.pages.devices.title })).toBeVisible();
  const timelineCard = page.getByTestId("device-timeline-card");
  await expect(timelineCard).toBeVisible();

  const canvas = page.getByTestId("device-timeline-echart").locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect((box?.width ?? 0) > 200 && (box?.height ?? 0) > 100).toBe(true);

  const cards = page.getByTestId("epoch-cards-list");
  await expect(cards).toContainText("Watch7,5");
  await expect(cards).toContainText("primary for 11 metrics");
  await expect(cards).toContainText("learning 10/14");
  await expect(cards).toContainText("can't separate");
  await expect(cards).toContainText("11.0 → 11.1 on Oct 25");
  await expect(cards).toContainText("11.1 → 11.2 on Nov 9");
  await expect(cards).toContainText("Watch6,1");
  await expect(cards).toContainText("iPhone16,1");

  // Minor occasional sources collapsed by default; expand shows app fallback name "Sleep Tracker App"
  const occCard = page.getByTestId("occasional-sources-card");
  await expect(occCard).toBeVisible();
  await expect(occCard).toContainText("Occasional sources (1)");
  await expect(page.getByTestId("occasional-sources-list")).toHaveCount(0);
  await page.getByTestId("occasional-sources-toggle").click();
  await expect(page.getByTestId("occasional-sources-list")).toBeVisible();
  await expect(page.getByTestId("occasional-sources-list")).toContainText("Sleep Tracker App");
  await page.getByTestId("occasional-sources-toggle").click();
  await expect(page.getByTestId("occasional-sources-list")).toHaveCount(0);

  await assertNoHorizontalOverflow(page);
  await snapShot(page, "int-devices-1440.png");

  // Responsive 390px layout check + mobile screenshot
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await expect(cards).toContainText("Watch7,5");
  await assertNoHorizontalOverflow(page);
  await snapShot(page, "int-devices-390.png");

  // Click metric name to navigate to Metric detail at 180d
  await page.setViewportSize({ width: 1440, height: 900 });
  await cards.getByRole("link", { name: "Wrist temp" }).first().click();
  await expect(page).toHaveURL(/\/metrics\/wrist_temp\?.*range=180d/);

  expect(errors).toEqual([]);
});

test("Devices §7 states: single epoch omits seam column and occasional section, empty imports -> B-R4, error -> retry (route-intercepted)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page, { allow500: true });

  let mode: "error" | "single" | "empty" = "error";
  await page.route("**/api/changes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(changesStub()),
    }),
  );
  await page.route("**/api/epochs", (route) => {
    if (mode === "error") {
      mode = "single";
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "epochs read failed" }),
      });
    }
    if (mode === "empty") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(epochsStub(false)),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(singleEpochStub()),
    });
  });

  await page.goto("/devices");
  await expect(page.getByTestId("read-error")).toBeVisible();
  await expect(page.getByTestId("read-error")).toContainText(copy.error.devicesTitle);

  // Retry -> single epoch state
  await page.getByTestId("read-error").getByRole("button", { name: copy.error.retry }).click();
  const watchCard = page.getByTestId("epoch-card-1");
  await expect(watchCard).toBeVisible();
  await expect(watchCard).toContainText("Synthetic Watch A");
  await expect(watchCard).not.toContainText("Across");
  await expect(page.getByTestId("occasional-sources-card")).toHaveCount(0);

  // Empty imports -> B-R4 empty state
  mode = "empty";
  await page.reload();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByRole("link", { name: copy.empty.cta })).toBeVisible();

  expect(errors).toEqual([]);
});
