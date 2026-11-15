import { describe, expect, test } from "bun:test";
import { metricSeriesStub } from "../../web/src/api/fixtures";
import {
  buildBandPolygons,
  buildBaselineSummary,
  buildCalendarDays,
  buildMetricChartSummary,
  buildMetricChartTable,
  buildRecentUnitRows,
  formatSeamLabel,
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

  test("buildBandPolygons handles negative wrist_temp values and splits gaps cleanly", () => {
    const series = metricSeriesStub("wrist_temp", "180d");
    expect(series.band.length).toBeGreaterThan(20);
    expect(series.band.every((b) => b.low < 0 && b.high < 0)).toBe(true);

    const days = buildCalendarDays(series);
    const dayIndex = new Map(days.map((d, idx) => [d, idx]));
    const polygons = buildBandPolygons(series.band, dayIndex);
    expect(polygons.length).toBe(1);
    expect(polygons[0]?.minLow).toBeLessThan(0);
    expect(polygons[0]?.maxHigh).toBeLessThan(0);

    const d0 = days[0];
    const d1 = days[1];
    const d5 = days[5];
    const d6 = days[6];
    if (!d0 || !d1 || !d5 || !d6) throw new Error("expected calendar days");

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

  test("buildRecentUnitRows skips minor epochs, preserves partial/tz flags, and limits to 7 rows", () => {
    const wt = metricSeriesStub("wrist_temp", "180d");
    const rows = buildRecentUnitRows(wt, 7);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.deviceLabel !== "Synthetic Phone App")).toBe(true);

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
    expect(buildMetricChartSummary(hrv)).toContain("1 device seam (Feb 22)");
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
