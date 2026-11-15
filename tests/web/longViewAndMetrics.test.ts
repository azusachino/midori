import { describe, expect, test } from "bun:test";
import { metricSeriesStub, metricsIndexStub } from "../../web/src/api/fixtures";
import {
  buildLongViewModel,
  buildLongViewSummary,
  buildLongViewTable,
  divergingCellColor,
} from "../../web/src/lib/long-view";
import {
  buildEpochWeeklySegments,
  buildMiniChartSummary,
  buildMiniChartTable,
  resolveWeeklySeamWeek,
} from "../../web/src/lib/metrics-index";

describe("Long view calendar helpers", () => {
  test("groups multi-year series by year, computes per-stint deviation, marks partial & seam cells", () => {
    const hrv = metricSeriesStub("hrv_sdnn", "1y");
    const model = buildLongViewModel(hrv);

    expect(model.years.map((y) => y.year)).toEqual(["2025", "2026"]);
    expect(model.activeEpochs.map((e) => e.id)).toEqual([1, 2]);
    // Minor phone epoch should not appear in calendar cells
    expect(
      model.years.every((y) => y.cells.every((c) => c.epochLabel !== "Synthetic Phone App")),
    ).toBe(true);

    const year2026 = model.years.find((y) => y.year === "2026");
    expect(year2026?.seams).toHaveLength(1);
    expect(year2026?.seams[0]?.seamDay).toBe("2026-01-24");

    const seamCell = year2026?.cells.find((c) => c.day === "2026-01-24");
    expect(seamCell?.seam?.kind).toBe("offset");

    const partialCell = year2026?.cells.find((c) => c.day === "2026-03-01");
    expect(partialCell?.usable).toBe(false);
    expect(partialCell?.partialReason).toBe("export_cut");

    const summary = buildLongViewSummary("hrv_sdnn", model);
    expect(summary).toContain("HRV (SDNN) calendar across");
    expect(summary).toContain("2 years");

    const table = buildLongViewTable(hrv, model);
    expect(table.columns.map((c) => c.key)).toEqual([
      "year",
      "day",
      "value",
      "device",
      "deviation",
      "partial",
      "seam",
    ]);
    expect(table.rows.some((r) => r.partial === "export_cut")).toBe(true);
    expect(table.rows.some((r) => String(r.seam).includes("offset"))).toBe(true);
  });

  test("divergingCellColor maps below/at/above median on single blue-muted-rose scale", () => {
    const parseRgb = (css: string) => {
      const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(css);
      if (!m) throw new Error(`unexpected rgb format: ${css}`);
      return [Number(m[1]), Number(m[2]), Number(m[3])] as const;
    };

    const lowFull = parseRgb(divergingCellColor(-1));
    const lowHalf = parseRgb(divergingCellColor(-0.5));
    const atMedian = parseRgb(divergingCellColor(0));
    const highHalf = parseRgb(divergingCellColor(0.5));
    const highFull = parseRgb(divergingCellColor(1));

    // At median -> exact neutral surface-muted (#27272a)
    expect(atMedian).toEqual([39, 39, 42]);

    // Below median -> cool blue (#38bdf8 at -1; blue channel leads red)
    expect(lowFull).toEqual([56, 189, 248]);
    expect(lowHalf[2]).toBeGreaterThan(lowHalf[0]);
    expect(lowHalf[2]).toBeGreaterThan(atMedian[2]);

    // Above median -> warm rose (#fb7185 at +1; red channel leads blue and green — no brown/orange)
    expect(highFull).toEqual([251, 113, 133]);
    expect(highHalf[0]).toBeGreaterThan(highHalf[1]);
    expect(highHalf[0]).toBeGreaterThan(highHalf[2]);
    expect(highHalf[2]).toBeGreaterThanOrEqual(highHalf[1]);

    // Symmetric extremes clamp cleanly
    expect(divergingCellColor(-5)).toBe("rgb(56, 189, 248)");
    expect(divergingCellColor(5)).toBe("rgb(251, 113, 133)");
  });
});

describe("Metrics index weekly helpers", () => {
  test("segments weekly series by epoch without bridging across seams", () => {
    const index = metricsIndexStub(true);
    const hrv = index.metrics.find((m) => m.metric === "hrv_sdnn");
    if (!hrv) throw new Error("expected hrv_sdnn entry");

    const segments = buildEpochWeeklySegments(hrv.weeklySeries);
    expect(segments.length).toBe(2);
    expect(segments[0]?.colorIndex).toBe(0);
    expect(segments[1]?.colorIndex).toBe(1);

    const seamWeek = resolveWeeklySeamWeek(hrv.weeklySeries, "2026-01-24");
    expect(seamWeek).not.toBeNull();
    expect(buildMiniChartSummary(hrv)).toContain("52 weeks with 1 device seam");

    const table = buildMiniChartTable(hrv);
    expect(table.rows).toHaveLength(52);
    expect(table.rows.some((r) => r.seam !== "—")).toBe(true);

    const emptyMetric = index.metrics.find((m) => !m.hasData);
    expect(emptyMetric).toBeDefined();
    if (emptyMetric) {
      expect(buildMiniChartSummary(emptyMetric)).toContain("No data yet");
    }
  });
});
