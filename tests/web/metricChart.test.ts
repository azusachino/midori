import { describe, expect, test } from "bun:test";
import { metricSeriesStub } from "../../web/src/api/fixtures";
import {
  buildBandPolygons,
  buildBaselineSummary,
  buildCalendarDays,
  buildMetricChartSummary,
  buildMetricChartTable,
  buildRecentUnitRows,
  currentStintBandPoints,
  formatSeamLabel,
  hasEstablishedBaseline,
  nextWiderRange,
  resolveZoomWindow,
  shouldIncludeZero,
  zoomEventToDays,
} from "../../web/src/lib/metric-chart";

describe("metric-chart helpers", () => {
  test("buildCalendarDays expands missing dates continuously between first and last day", () => {
    const base = metricSeriesStub("wrist_temp", "90d");
    const u0 = base.units[0];
    const u1 = base.units[1];
    if (!u0 || !u1) throw new Error("expected fixture units");
    const sparse = {
      ...base,
      units: [
        { ...u0, day: "2026-02-01" },
        { ...u1, day: "2026-02-04" },
      ],
      band: [],
      seams: [],
    };
    expect(buildCalendarDays(sparse)).toEqual([
      "2026-02-01",
      "2026-02-02",
      "2026-02-03",
      "2026-02-04",
    ]);
  });

  test("buildBandPolygons handles negative wrist_temp coordinates and splits gaps cleanly", () => {
    const series = metricSeriesStub("wrist_temp", "180d");
    const days = buildCalendarDays(series);
    const dayIndex = new Map(days.map((d, idx) => [d, idx]));
    const d0 = days[0];
    const d1 = days[1];
    const d2 = days[2];
    const d5 = days[5];
    const d6 = days[6];
    if (!d0 || !d1 || !d2 || !d5 || !d6) throw new Error("expected calendar days");

    const negBand = [
      { day: d0, low: -0.46, high: -0.1, median: -0.28 },
      { day: d1, low: -0.44, high: -0.08, median: -0.26 },
      { day: d2, low: -0.45, high: -0.09, median: -0.27 },
    ];
    const negPolygons = buildBandPolygons(negBand, dayIndex);
    expect(negPolygons).toHaveLength(1);
    expect(negPolygons[0]?.minLow).toBeCloseTo(-0.46);
    expect(negPolygons[0]?.maxHigh).toBeCloseTo(-0.08);

    // Split across a gap in days
    const withGap = [
      { day: d0, low: -0.4, high: -0.1, median: -0.25 },
      { day: d1, low: -0.42, high: -0.12, median: -0.27 },
      { day: d5, low: 0.1, high: 0.35, median: 0.22 },
      { day: d6, low: 0.12, high: 0.38, median: 0.24 },
    ];
    const splitPolygons = buildBandPolygons(withGap, dayIndex);
    expect(splitPolygons).toHaveLength(2);
    expect(splitPolygons[0]?.points).toHaveLength(2);
    expect(splitPolygons[1]?.points).toHaveLength(2);
  });

  test("currentStintBandPoints draws band only for current stint when baseline exists", () => {
    const wt = metricSeriesStub("wrist_temp", "180d");
    expect(hasEstablishedBaseline(wt)).toBe(false);
    expect(wt.band).toEqual([]);
    expect(currentStintBandPoints(wt)).toEqual([]);

    // Even if server/stub sent an earlier-stint band while warming_up, client suppresses it
    const wtWithStaleBand = {
      ...wt,
      band: [{ day: "2026-01-15", low: -0.4, high: -0.1, median: -0.25 }],
    };
    expect(currentStintBandPoints(wtWithStaleBand)).toEqual([]);

    // Computed HRV draws band only on current Watch B stint (not Watch A before seam)
    const hrv = metricSeriesStub("hrv_sdnn", "90d");
    expect(hasEstablishedBaseline(hrv)).toBe(true);
    const currentHrvBand = currentStintBandPoints(hrv);
    expect(currentHrvBand.length).toBeGreaterThan(15);
    expect(currentHrvBand.every((b) => b.day >= "2026-01-24")).toBe(true);

    // Even if Watch A points leaked into series.band, currentStintBandPoints filters them out
    const hrvWithLeakedWatchABand = {
      ...hrv,
      band: [{ day: "2025-12-10", low: 52, high: 66, median: 60 }, ...hrv.band],
    };
    expect(
      currentStintBandPoints(hrvWithLeakedWatchABand).every((b) => b.day >= "2026-01-24"),
    ).toBe(true);
  });

  test("formatSeamLabel distinguishes offset (B-D6) from non-separable step (B-D7)", () => {
    const wt = metricSeriesStub("wrist_temp", "90d");
    const wtSeam = wt.seams[0];
    if (!wtSeam) throw new Error("expected wrist_temp seam");
    const wtLabel = formatSeamLabel(wtSeam, wt.epochs, wt.metric, wt.unit);
    expect(wtLabel).toContain("step +0.52 °C");
    expect(wtLabel).toContain("can't be separated");

    const hrv = metricSeriesStub("hrv_sdnn", "90d");
    const hrvSeam = hrv.seams[0];
    if (!hrvSeam) throw new Error("expected hrv_sdnn seam");
    const hrvLabel = formatSeamLabel(hrvSeam, hrv.epochs, hrv.metric, hrv.unit);
    expect(hrvLabel).toContain("Synthetic Watch A → Synthetic Watch B");
    expect(hrvLabel).toContain("offset −5.0 ms");
  });

  test("shouldIncludeZero only pins zero for count/volume metrics", () => {
    expect(shouldIncludeZero("steps")).toBe(true);
    expect(shouldIncludeZero("active_kj")).toBe(true);
    expect(shouldIncludeZero("wrist_temp")).toBe(false);
    expect(shouldIncludeZero("hrv_sdnn")).toBe(false);
    expect(shouldIncludeZero("sleep_hr")).toBe(false);
  });

  test("URL zoom helpers resolve and serialize day bounds symmetrically", () => {
    const series = metricSeriesStub("wrist_temp", "180d");
    const days = buildCalendarDays(series);
    const zoomed = resolveZoomWindow(days, "2026-01-15", "2026-02-20");
    expect(zoomed).not.toBeNull();
    if (!zoomed) throw new Error("expected zoom window");
    expect(days[zoomed.startValue]).toBe("2026-01-15");
    expect(days[zoomed.endValue]).toBe("2026-02-20");

    const serialized = zoomEventToDays(days, {
      start: 0,
      end: 100,
      startValue: zoomed.startValue,
      endValue: zoomed.endValue,
    });
    expect(serialized).toEqual({ zoomStart: "2026-01-15", zoomEnd: "2026-02-20" });

    // Full extent collapses to null (clean URL)
    const full = zoomEventToDays(days, {
      start: 0,
      end: 100,
      startValue: 0,
      endValue: days.length - 1,
    });
    expect(full).toBeNull();
  });

  test("buildRecentUnitRows collects 7 usable units, grays out skipped partial rows with '—' in vs usual, and suppresses z without baseline", () => {
    const hrv = metricSeriesStub("hrv_sdnn", "90d");
    const hrvWithFakePartialZ = {
      ...hrv,
      units: hrv.units.map((u) => (u.usable ? u : { ...u, z: -2.8 })),
    };
    const hrvRows = buildRecentUnitRows(hrvWithFakePartialZ, 7);
    expect(hrvRows.filter((r) => r.usable)).toHaveLength(7);
    expect(hrvRows).toHaveLength(9);

    const mar1Hrv = hrvRows.find((r) => r.day === "2026-03-01");
    expect(mar1Hrv?.usable).toBe(false);
    expect(mar1Hrv?.zText).toBe("—");
    expect(mar1Hrv?.zTone).toBe("none");
    expect(mar1Hrv?.partialNote).toBe("partial (export cut)");

    const feb24Hrv = hrvRows.find((r) => r.day === "2026-02-24");
    expect(feb24Hrv?.usable).toBe(false);
    expect(feb24Hrv?.zText).toBe("—");
    expect(feb24Hrv?.partialNote).toBe("partial (too few samples)");

    const feb25Hrv = hrvRows.find((r) => r.day === "2026-02-25");
    expect(feb25Hrv?.usable).toBe(true);
    expect(feb25Hrv?.zText).not.toBe("—");

    const wt = metricSeriesStub("wrist_temp", "180d");
    const rows = buildRecentUnitRows(wt, 7);
    expect(rows.filter((r) => r.usable)).toHaveLength(7);
    expect(rows.every((r) => r.deviceLabel !== "Synthetic Phone App")).toBe(true);
    // No established baseline on warming_up wrist_temp -> 'vs usual' is always '—'
    expect(rows.every((r) => r.zText === "—" && r.zTone === "none")).toBe(true);

    // Even if raw unit z numbers were provided during warming_up or insufficient, zText stays '—'
    const spo2 = metricSeriesStub("spo2", "90d");
    const spo2WithFakeZ = {
      ...spo2,
      units: spo2.units.map((u) => ({ ...u, z: 2.3 })),
    };
    const spo2Rows = buildRecentUnitRows(spo2WithFakeZ, 7);
    expect(spo2Rows.every((r) => r.zText === "—" && r.zTone === "none")).toBe(true);

    const mar1 = rows.find((r) => r.day === "2026-03-01");
    expect(mar1?.partialNote).toBe("partial (export cut)");
    const feb27 = rows.find((r) => r.day === "2026-02-27");
    expect(feb27?.tzChange).toBe(true);
    const feb24 = rows.find((r) => r.day === "2026-02-24");
    expect(feb24?.partialNote).toBe("partial (too few samples)");
  });

  test("baseline summary, chart summary, hidden table, and nextWiderRange reflect metric state", () => {
    const hrv = metricSeriesStub("hrv_sdnn", "90d");
    expect(buildBaselineSummary(hrv)).toContain("Baseline: 21 nights · median 55 ms (49–61)");
    expect(buildMetricChartSummary(hrv)).toContain("1 device seam (Jan 24)");
    const hrvTable = buildMetricChartTable(hrv);
    expect(hrvTable.columns.map((c) => c.key)).toEqual([
      "day",
      "value",
      "device",
      "usable",
      "bandLow",
      "bandHigh",
    ]);
    expect(hrvTable.rows.some((r) => r.device === "Synthetic Phone App")).toBe(true);

    const wt = metricSeriesStub("wrist_temp", "90d");
    expect(buildBaselineSummary(wt)).toBe("Baseline: warming up — not yet established");

    const vo2 = metricSeriesStub("vo2max", "180d");
    expect(buildBaselineSummary(vo2)).toBe("Trend only — no baseline range computed");

    expect(nextWiderRange("90d")).toBe("180d");
    expect(nextWiderRange("180d")).toBe("1y");
    expect(nextWiderRange("1y")).toBe("all");
    expect(nextWiderRange("all")).toBeNull();
  });
});
