import { describe, expect, test } from "bun:test";
import { metricSeriesStub } from "../../web/src/api/fixtures";
import {
  buildBandPolygons,
  buildBaselineSummary,
  buildCalendarDays,
  buildMetricChartSummary,
  buildMetricChartTable,
  buildRecentUnitRows,
  clampSeamLabel,
  currentStintBandPoints,
  deduplicateUnitsByDay,
  estimateLegendRows,
  formatSeamLabel,
  formatZScore,
  hasEstablishedBaseline,
  nextWiderRange,
  resolveSeamLabelLayouts,
  resolveZoomWindow,
  selectPrimaryOsUpdatesInView,
  shouldIncludeZero,
  toWeekStartMonday,
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

  test("aligns range=all weekly calendar ticks/bands and deduplicates overlapping non-minor day units", () => {
    expect(toWeekStartMonday("2026-01-24")).toBe("2026-01-19");

    const base = metricSeriesStub("hrv_sdnn", "180d");
    const weeklySeries = {
      ...base,
      range: "all" as const,
      units: [
        {
          day: "2026-01-12",
          epochId: 1,
          value: 52,
          n: 0,
          usable: true,
          partialReason: null,
          tzChange: false,
          z: null,
          isRecent: false,
        },
        {
          day: "2026-01-19",
          epochId: 1,
          value: 54,
          n: 0,
          usable: true,
          partialReason: null,
          tzChange: false,
          z: null,
          isRecent: false,
        },
        {
          day: "2026-01-19",
          epochId: 2,
          value: 55,
          n: 0,
          usable: true,
          partialReason: null,
          tzChange: false,
          z: null,
          isRecent: false,
        },
        {
          day: "2026-02-02",
          epochId: 2,
          value: 56,
          n: 0,
          usable: true,
          partialReason: null,
          tzChange: false,
          z: null,
          isRecent: false,
        },
      ],
    };

    const days = buildCalendarDays(weeklySeries);
    // Adjacent Monday ticks from 2026-01-12 to end of band/units (stepping by 7d, never daily)
    expect(days.slice(0, 4)).toEqual(["2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"]);

    const alignedBand = currentStintBandPoints(weeklySeries);
    expect(alignedBand.every((pt) => toWeekStartMonday(pt.day) === pt.day)).toBe(true);

    // Same-day overlapping non-minor records deduplicate to the covering stint epoch
    const stepsBase = metricSeriesStub("hrv_sdnn", "90d");
    const epoch1 = stepsBase.epochs[0];
    const epoch2 = stepsBase.epochs[1];
    if (!epoch1 || !epoch2) throw new Error("expected fixture epochs");
    const deduped = deduplicateUnitsByDay(
      [
        {
          day: "2026-02-20",
          epochId: epoch1.id,
          value: 2000,
          n: 2,
          usable: true,
          partialReason: null,
          tzChange: false,
          z: null,
          isRecent: true,
        },
        {
          day: "2026-02-20",
          epochId: epoch2.id,
          value: 8000,
          n: 12,
          usable: true,
          partialReason: null,
          tzChange: false,
          z: null,
          isRecent: true,
        },
      ],
      {
        epochs: [
          { ...epoch1, minor: false },
          { ...epoch2, minor: false },
        ],
        stints: [{ epochId: epoch2.id, startDay: "2026-02-01", endDay: "2026-03-01" }],
      },
    );
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.epochId).toBe(epoch2.id);
    expect(deduped[0]?.value).toBe(8000);
  });

  test("clamps out-of-window seams/bands on 90d, filters primary OS updates, and clamps long seam labels", () => {
    const base = metricSeriesStub("hrv_sdnn", "90d");
    const epoch1 = base.epochs[0];
    const epoch2 = base.epochs[1];
    if (!epoch1 || !epoch2) throw new Error("expected two fixture epochs");

    const dirtySeries = {
      ...base,
      epochs: [
        { ...epoch1, minor: false },
        { ...epoch2, minor: false },
        {
          ...epoch2,
          id: 99,
          label: "iPhone 15",
          kind: "phone" as const,
          colorIndex: null,
          minor: true,
        },
      ],
      band: [{ day: "2024-06-01", median: 45, low: 39, high: 52 }, ...base.band],
      seams: [
        {
          seamDay: "2024-06-01",
          fromEpochId: 1,
          toEpochId: 2,
          kind: "offset" as const,
          value: 2,
          nOld: 20,
          nNew: 20,
        },
        ...base.seams,
      ],
      osUpdates: [
        { day: "2024-06-15", epochId: epoch2.id, fromSw: "9.0", toSw: "10.0" },
        { day: "2026-02-26", epochId: 99, fromSw: "18.1", toSw: "18.2" }, // minor epoch -> excluded
        { day: "2026-02-26", epochId: epoch1.id, fromSw: "10.2", toSw: "10.4" }, // non-stint on Feb 26 -> excluded
        { day: "2026-02-26", epochId: epoch2.id, fromSw: "10.4", toSw: "11.0" }, // primary covering stint -> kept
      ],
    };

    const days = buildCalendarDays(dirtySeries);
    expect((days[0] ?? "") >= "2025-12-01").toBe(true);
    expect(days).not.toContain("2024-06-01");
    expect(currentStintBandPoints(dirtySeries).some((b) => b.day.startsWith("2024-"))).toBe(false);

    const osInView = selectPrimaryOsUpdatesInView(dirtySeries, days);
    expect(osInView).toHaveLength(1);
    expect(osInView[0]).toMatchObject({ epochId: epoch2.id, day: "2026-02-26", toSw: "11.0" });

    // Empty stints fallback (trendOnly) selects only latest active non-minor epoch
    const trendUpdates = selectPrimaryOsUpdatesInView({ ...dirtySeries, stints: [] }, days);
    expect(trendUpdates).toHaveLength(1);
    expect(trendUpdates[0]?.epochId).toBe(epoch2.id);

    expect(clampSeamLabel("step +0.52 °C (can't be separated)")).toBe(
      "step +0.52 °C (can't be separated)",
    );
    const longSeam = "Offset · Apple Watch Series 8 → Apple Watch Ultra 2 (+4.2 ms)";
    const clamped = clampSeamLabel(longSeam, 32);
    expect(clamped.length).toBeLessThanOrEqual(32);
    expect(clamped.endsWith("…")).toBe(true);
  });

  test("range=all recent rows and baseline summary stay anchored to daily finding while close seam labels suppress collisions", () => {
    const base = metricSeriesStub("steps", "180d");
    const epoch1 = base.epochs[0];
    const epoch2 = base.epochs[1];
    if (!epoch1 || !epoch2) throw new Error("expected two fixture epochs");

    const allWeeklySteps = {
      ...base,
      range: "all" as const,
      units: [
        {
          day: "2024-01-01",
          epochId: epoch1.id,
          value: 6100,
          n: 0,
          usable: true,
          partialReason: null,
          tzChange: false,
          z: null,
          isRecent: false,
        },
        {
          day: "2026-02-23",
          epochId: epoch2.id,
          value: 9000,
          n: 0,
          usable: true,
          partialReason: null,
          tzChange: false,
          z: null,
          isRecent: false,
        },
      ],
    };

    const allRows = buildRecentUnitRows(allWeeklySteps, 7);
    expect(allRows.map((r) => r.day)).toEqual([
      "2026-03-01",
      "2026-02-28",
      "2026-02-27",
      "2026-02-26",
      "2026-02-25",
      "2026-02-24",
      "2026-02-23",
    ]);
    expect(allRows.some((r) => r.day === "2024-01-01")).toBe(false);
    expect(allRows.every((r) => r.zText !== "—")).toBe(true);
    expect(buildBaselineSummary(allWeeklySteps)).toBe(
      "Baseline: 28 days · median 6.0k (4.5k–7.5k) · Jan 24–Feb 20",
    );

    const days100Weeks = Array.from({ length: 100 }, (_, i) => {
      const ms = Date.UTC(2024, 0, 1) + i * 7 * 86_400_000;
      return new Date(ms).toISOString().slice(0, 10);
    });
    const seamA = {
      seamDay: days100Weeks[10] ?? "2024-03-11",
      fromEpochId: epoch1.id,
      toEpochId: epoch2.id,
      kind: "step" as const,
      value: 1300,
      nOld: 20,
      nNew: 20,
    };
    const seamB = {
      seamDay: days100Weeks[14] ?? "2024-04-08", // ~32 px from seamA on 800px grid
      fromEpochId: epoch2.id,
      toEpochId: epoch1.id,
      kind: "offset" as const,
      value: 2100,
      nOld: 20,
      nNew: 20,
    };
    const seamC = {
      seamDay: days100Weeks[88] ?? "2025-09-08",
      fromEpochId: epoch1.id,
      toEpochId: epoch2.id,
      kind: "step" as const,
      value: 17,
      nOld: 20,
      nNew: 20,
    };

    const desktopLayouts = resolveSeamLabelLayouts(
      [seamA, seamB, seamC],
      base.epochs,
      days100Weeks,
      "steps",
      "count",
      { isWeekly: true, gridWidth: 800 },
    );
    expect(desktopLayouts.map((l) => l.showLabel)).toEqual([false, true, true]);
  });

  test("formatZScore truncates toward zero so |z| < 1.5 never prints +/-1.5 sigma", () => {
    expect(formatZScore(-1.46)).toBe("−1.4σ");
    expect(formatZScore(1.49)).toBe("+1.4σ");
    expect(formatZScore(-1.5)).toBe("−1.5σ");
    expect(formatZScore(-0.04)).toBe("0.0σ");
  });

  test("estimateLegendRows wraps legend items at 390 px and narrow seam layouts stay inside grid", () => {
    expect(
      estimateLegendRows(["Synthetic Watch A", "Synthetic Watch B", "Synthetic Phone"], 318),
    ).toBeGreaterThanOrEqual(2);

    const base = metricSeriesStub("hrv_sdnn", "180d");
    const epoch1 = base.epochs[0];
    const epoch2 = base.epochs[1];
    if (!epoch1 || !epoch2) throw new Error("expected 2 epochs");
    const calDays = buildCalendarDays(base);
    const narrowLayouts = resolveSeamLabelLayouts(
      [
        {
          seamDay: calDays[20] ?? base.units[10]?.day ?? "2026-01-20",
          fromEpochId: epoch1.id,
          toEpochId: epoch2.id,
          kind: "offset",
          value: -4,
          nOld: 20,
          nNew: 20,
        },
      ],
      base.epochs,
      calDays,
      "hrv_sdnn",
      "ms",
      { isWeekly: false, gridWidth: 300 },
    );
    expect(narrowLayouts).toHaveLength(1);
    for (const layout of narrowLayouts) {
      if (layout.showLabel) {
        expect(layout.spanEnd).toBeLessThanOrEqual(300);
      }
    }
  });

  test("currentStintBandPoints and buildBaselineSummary exclude 'last 7' days even if present in band (M5)", () => {
    const hrv = metricSeriesStub("hrv_sdnn", "180d");
    const injected = {
      ...hrv,
      band: [...hrv.band, { day: "2026-02-25", low: 52, high: 66, median: 59 }],
    };
    const pts = currentStintBandPoints(injected);
    expect(pts.every((b) => b.day < "2026-02-21")).toBe(true);
    expect(buildBaselineSummary(injected)).toContain("Jan 24–Feb 20");
    expect(buildBaselineSummary(injected)).not.toContain("Feb 25");
  });
});
