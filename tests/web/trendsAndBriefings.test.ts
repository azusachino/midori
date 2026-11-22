import { describe, expect, test } from "bun:test";
import { createApiClient } from "../../web/src/api/client";
import type { AlignedNightDTO, HealthContextDTO, NoteDTO } from "../../web/src/api/types";
import { buildTrendsData, seriesFor } from "../../web/src/lib/trends";

function night(date: string, overrides: Partial<AlignedNightDTO> = {}): AlignedNightDTO {
  return {
    date,
    zone: "Asia/Tokyo",
    tzChange: false,
    partialReason: null,
    sleep: { asleepH: 7.1, deepH: 1.0, remH: 1.5, coreH: 4.6 },
    metrics: { sleep_h: 7.1, hrv_sdnn: 55, rhr: 54, wrist_temp: 36.4 },
    notes: [],
    ...overrides,
  };
}

function note(overrides: Partial<NoteDTO>): NoteDTO {
  return {
    id: 1,
    startDay: "2026-02-10",
    endDay: "2026-02-10",
    category: "travel",
    label: "trip",
    createdAt: "2026-02-10T00:00:00Z",
    updatedAt: "2026-02-10T00:00:00Z",
    author: "owner",
    authorName: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<HealthContextDTO> = {}): HealthContextDTO {
  return {
    asOfDay: "2026-02-12",
    freshness: { asOfDay: "2026-02-12", lastImportAt: "2026-02-13T00:00:00Z", daysSinceImport: 0 },
    primaryWatch: null,
    profile: { goals: "", routine: "", medicalContext: "", updatedAt: null },
    summary: { standsOut: 0, closeToEdge: 0, within: 0, other: 0, sharedConfounders: [] },
    findings: [],
    sinceLastImport: null,
    // B-A5: newest first, exactly as GET /api/context returns them.
    recentNights: [night("2026-02-12"), night("2026-02-11"), night("2026-02-10")],
    recentNotes: [],
    latestBriefing: null,
    guidance: "Cite the specific nights.",
    ...overrides,
  };
}

const sleepFinding = {
  metric: "sleep_h",
  baselineMedian: 7.2,
} as unknown as HealthContextDTO["findings"][number];

describe("B-T1 trends chart data", () => {
  test("reverses newest-first recentNights into a chronological ascending axis", () => {
    const data = buildTrendsData(makeContext({ findings: [sleepFinding] }));
    expect(data.days).toEqual(["2026-02-10", "2026-02-11", "2026-02-12"]);
    expect(data.nights.map((n) => n.date)).toEqual(data.days);
    expect(data.nights[0]?.asleepH).toBe(7.1);
    expect(data.usualSleepMedian).toBe(7.2);
    expect(data.hasSleep).toBe(true);
    expect(data.hasVitals).toBe(true);
  });

  test("keeps an already-ascending feed ascending and maps every vitals column", () => {
    const data = buildTrendsData(
      makeContext({
        recentNights: [
          night("2026-02-10", { metrics: { hrv_sdnn: 48, rhr: 52, wrist_temp: 36.2 } }),
          night("2026-02-11", { metrics: { hrv_sdnn: 51, rhr: 53, wrist_temp: 36.3 } }),
        ],
      }),
    );
    expect(data.days).toEqual(["2026-02-10", "2026-02-11"]);
    expect(seriesFor(data, "hrvSdnn")).toEqual([48, 51]);
    expect(seriesFor(data, "rhr")).toEqual([52, 53]);
    expect(seriesFor(data, "wristTemp")).toEqual([36.2, 36.3]);
    expect(seriesFor(data, "deepH")).toEqual([1.0, 1.0]);
    expect(data.usualSleepMedian).toBeNull();
  });

  test("handles a missing stage breakdown as null values", () => {
    const data = buildTrendsData(
      makeContext({
        recentNights: [
          night("2026-02-12", { sleep: null, metrics: {} }),
          night("2026-02-11", { sleep: null, metrics: {} }),
        ],
      }),
    );
    expect(seriesFor(data, "asleepH")).toEqual([null, null]);
    expect(seriesFor(data, "coreH")).toEqual([null, null]);
    expect(data.hasSleep).toBe(false);
    expect(data.hasVitals).toBe(false);
  });

  test("clamps note bands to the ascending axis and drops notes outside it", () => {
    const data = buildTrendsData(
      makeContext({
        recentNotes: [
          note({ id: 1, startDay: "2026-01-20", endDay: "2026-02-11", label: "before" }),
          note({ id: 2, startDay: "2026-02-12", endDay: "2026-03-01", label: "after" }),
          note({ id: 3, startDay: "2026-03-05", endDay: "2026-03-06", label: "gone" }),
        ],
      }),
    );
    expect(data.noteBands).toEqual([
      expect.objectContaining({ id: 1, startIndex: 0, endIndex: 1, label: "before" }),
      expect.objectContaining({ id: 2, startIndex: 2, endIndex: 2, label: "after" }),
    ]);
    for (const band of data.noteBands) {
      expect(data.days[band.startIndex]).toBeDefined();
      expect(data.days[band.endIndex]).toBeDefined();
    }
  });

  test("collects partial nights and their per-night note labels", () => {
    const data = buildTrendsData(
      makeContext({
        recentNights: [
          night("2026-02-12", { partialReason: "export_cut" }),
          night("2026-02-11", { partialReason: null }),
          night("2026-02-10", {
            partialReason: null,
            notes: [{ id: 7, category: "travel", label: "flight" }],
          }),
        ],
      }),
    );
    expect(data.partialDays).toEqual(["2026-02-12"]);
    expect(data.nights.map((n) => n.noteLabels)).toEqual([["flight"], [], []]);
  });

  test("yields an empty axis for a context without nights", () => {
    const data = buildTrendsData(makeContext({ recentNights: [] }));
    expect(data.days).toEqual([]);
    expect(data.noteBands).toEqual([]);
    expect(data.usualSleepMedian).toBeNull();
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("B-B1 briefing and B-T1 context API client", () => {
  test("requests the context dossier with days and the briefing endpoints", async () => {
    const seen: Array<{ url: string; method: string }> = [];
    const briefing = {
      id: 5,
      asOfDay: "2026-02-14",
      title: "HRV lower than usual",
      summary: "Feb 8–14: HRV lower than usual.",
      citedNights: ["2026-02-14"],
      citedMetrics: ["hrv_sdnn"],
      authorName: "luna",
      createdAt: "2026-02-14T09:00:00Z",
    };
    const client = createApiClient({
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({ url, method: init?.method ?? "GET" });
        if (url.startsWith("/api/context")) return json(makeContext());
        if (init?.method === "DELETE") return json({ deleted: true });
        return json({ briefings: [briefing] });
      }) as never,
    });

    const context = await client.context(30);
    expect(context.asOfDay).toBe("2026-02-12");
    expect(await client.briefings(5)).toEqual([briefing]);
    await client.deleteBriefing(5);

    expect(seen).toEqual([
      { url: "/api/context?days=30", method: "GET" },
      { url: "/api/briefings?limit=5", method: "GET" },
      { url: "/api/briefings/5", method: "DELETE" },
    ]);
  });

  test("omits the query string when no limit is supplied", async () => {
    let seen = "";
    const client = createApiClient({
      fetch: (async (url: string) => {
        seen = url;
        return json({ briefings: [] });
      }) as never,
    });
    expect(await client.briefings()).toEqual([]);
    expect(seen).toBe("/api/briefings");
  });

  test("surfaces a 404 dismiss as an http ApiError", async () => {
    const client = createApiClient({
      fetch: (async () => json({ error: "briefing not found", retryable: false }, 404)) as never,
    });
    await expect(client.deleteBriefing(99)).rejects.toMatchObject({
      kind: "http",
      status: 404,
    });
  });
});
