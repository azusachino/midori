import { expect, test } from "@playwright/test";
import { copy } from "../web/src/copy";
import { snapShot } from "./shots";

/**
 * B-T1 multi-metric graphs and B-B1 agent briefing card against the real server and the
 * hermetic e2e corpus. No route interception: both views read the same dossier/profile
 * the deployed server serves.
 */

function trackErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
}

test("desktop 1440px: /trends renders the sleep architecture and correlated vitals charts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto("/trends");

  await expect(page.getByTestId("trends-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: copy.pages.trends.title, level: 1 }),
  ).toBeVisible();

  const sleepChart = page.getByTestId("sleep-architecture-echart");
  const vitalsChart = page.getByTestId("correlated-vitals-echart");
  await expect(sleepChart).toBeVisible();
  await expect(vitalsChart).toBeVisible();
  await expect(sleepChart.locator("canvas")).toBeVisible();
  await expect(vitalsChart.locator("canvas")).toBeVisible();

  // B-T1: the accessible summary carries the ascending night count for the chosen range.
  await expect(sleepChart).toContainText("14 nights");
  await expect(vitalsChart).toContainText("14 nights");

  // 30d toggle re-reads GET /api/context?days=30 and keeps both charts.
  const contextResponse = page.waitForResponse(
    (res) => res.url().includes("/api/context?days=30") && res.status() === 200,
  );
  await page.getByTestId("trends-range-30d").click();
  await contextResponse;
  await expect(page.getByTestId("trends-range-30d")).toHaveAttribute("aria-pressed", "true");
  await expect(sleepChart).toContainText("30 nights");
  await expect(vitalsChart).toContainText("30 nights");

  await snapShot(page, "int-trends-1440.png");
  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("phone 390px: /trends keeps both charts, the range toggle, and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = trackErrors(page);

  await page.goto("/trends");
  await expect(page.getByTestId("mobile-nav")).toBeVisible();
  await expect(page.getByTestId("trends-page")).toBeVisible();
  await expect(page.getByTestId("sleep-architecture-echart").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("correlated-vitals-echart").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("trends-range-14d")).toHaveAttribute("aria-pressed", "true");

  await snapShot(page, "int-trends-390.png");
  await assertNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("B-B1 the newest briefing renders on Changes with its citations and can be dismissed", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  const created = await request.post("/api/briefings", {
    data: {
      asOfDay: "2026-11-14",
      title: "HRV lower than usual this week",
      summary:
        "Citing Nov 8–14: HRV is lower than usual. A watch change overlaps this window, so the shift may come from the device.",
      citedNights: ["2026-11-08", "2026-11-14"],
      citedMetrics: ["hrv_sdnn", "rhr"],
      authorName: "e2e-agent",
    },
  });
  expect(created.status()).toBe(201);
  const briefing = (await created.json()) as { id: number };

  await page.goto("/");
  const card = page.getByTestId("briefing-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("briefing-title")).toHaveText("HRV lower than usual this week");
  await expect(card).toContainText(copy.briefing.heading);
  await expect(card).toContainText("by e2e-agent");
  await expect(page.getByTestId("briefing-summary")).toContainText("HRV is lower than usual");
  await expect(page.getByTestId("briefing-metric-hrv_sdnn")).toBeVisible();
  await expect(page.getByTestId("briefing-cited-nights")).toContainText("Nov 8");
  await assertNoHorizontalOverflow(page);

  const dismissed = page.waitForResponse(
    (res) => res.url().includes("/api/briefings/") && res.request().method() === "DELETE",
  );
  await page.getByTestId("briefing-dismiss-btn").click();
  expect((await dismissed).status()).toBe(200);
  await expect(card).toBeHidden();

  // B-B1: the row is really gone, so a reload does not bring it back.
  await page.goto("/");
  await expect(page.getByTestId("briefing-card")).toHaveCount(0);
  const listed = (await request.get("/api/briefings")).json() as Promise<{
    briefings: Array<{ id: number }>;
  }>;
  expect((await listed).briefings.some((row) => row.id === briefing.id)).toBe(false);

  expect(errors).toEqual([]);
});

test("B-A7 an agent-written note shows the provenance badge on Changes", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  // Publish through the auditable MCP write tool: the row is tagged author "agent".
  const called = await request.post("/mcp", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "add_note",
        arguments: {
          startDay: "2026-11-12",
          endDay: "2026-11-13",
          category: "travel",
          label: "overnight flight",
          authorName: "e2e-agent",
        },
      },
    },
  });
  expect(called.status()).toBe(200);
  const body = (await called.json()) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  expect(body.result?.isError).toBeUndefined();
  const note = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as {
    id: number;
    author: string;
    authorName: string;
  };
  expect(note).toMatchObject({ author: "agent", authorName: "e2e-agent" });

  await page.goto("/");
  await expect(page.getByTestId(`note-chip-${note.id}`)).toContainText("overnight flight");
  await expect(page.getByTestId(`note-chip-${note.id}`)).toContainText(copy.notes.agentBadge);
  await assertNoHorizontalOverflow(page);

  await request.delete(`/api/notes/${note.id}`);
  expect(errors).toEqual([]);
});
