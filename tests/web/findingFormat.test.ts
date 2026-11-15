import { describe, expect, test } from "bun:test";
import type { FindingRowDTO } from "../../web/src/api/types";
import {
  buildSparklineGeometry,
  displayUnit,
  flaggedChecksFor,
  formatDayWithWeekday,
  formatRangeSpan,
  formatRecentVsBaseline,
  formatShortDay,
  isAllWithin,
  isNotableDaytime,
  rankFindingRows,
} from "../../web/src/lib/finding-format";

function makeRow(overrides: Partial<FindingRowDTO>): FindingRowDTO {
  return {
    metric: "sleep_h",
    kind: "overnight",
    unit: "h",
    trust: "moderate",
    trustNote: "Synthetic trust note.",
    epochId: 1,
    epochLabel: "Synthetic Watch",
    state: "computed",
    direction: "within",
    severity: "within",
    confidence: "high",
    z: 0,
    recentMedian: 7.0,
    baselineMedian: 7.0,
    baselineLow: 6.4,
    baselineHigh: 7.6,
    kOutside: 1,
    recentCount: 7,
    baselineCount: 28,
    warmup: null,
    onset: null,
    checks: [],
    sparkline: [],
    caveats: [],
    ...overrides,
  };
}

describe("finding-format", () => {
  test("formats calendar days and ranges deterministically in UTC", () => {
    expect(formatShortDay("2026-03-01")).toBe("Mar 1");
    expect(formatDayWithWeekday("2026-03-01")).toBe("Mar 1 (Sun)");
    expect(formatDayWithWeekday("2026-11-06")).toBe("Nov 6 (Fri)");
    expect(formatRangeSpan("2026-10-28", "2026-11-07")).toBe("Oct 28–Nov 7");
  });

  test("formats units and recent vs baseline values concisely", () => {
    expect(displayUnit("wrist_temp", "degC")).toBe("°C");
    expect(displayUnit("sleep_hr", "count/min")).toBe("bpm");
    expect(displayUnit("resp_rate", "count/min")).toBe("/min");
    expect(displayUnit("steps", "count")).toBe("");

    expect(
      formatRecentVsBaseline(
        makeRow({ metric: "hrv_sdnn", unit: "ms", recentMedian: 42, baselineMedian: 55 }),
      ),
    ).toBe("42 vs 55 ms");
    expect(
      formatRecentVsBaseline(
        makeRow({ metric: "wrist_temp", unit: "degC", recentMedian: 36.91, baselineMedian: 36.4 }),
      ),
    ).toBe("36.91 vs 36.40 °C");
    expect(
      formatRecentVsBaseline(
        makeRow({
          metric: "steps",
          kind: "daytime",
          unit: "count",
          recentMedian: 9100,
          baselineMedian: 6000,
        }),
      ),
    ).toBe("9.1k vs 6.0k");

    // Pre-9c fraction-scale '%' values (< 1.5) are suppressed; percent-scale values include '%'
    expect(
      formatRecentVsBaseline(
        makeRow({
          metric: "spo2",
          unit: "%",
          recentMedian: 0.97,
          baselineMedian: 0.98,
        }),
      ),
    ).toBeNull();
    expect(
      formatRecentVsBaseline(
        makeRow({
          metric: "spo2",
          unit: "%",
          recentMedian: 96.5,
          baselineMedian: 97.2,
        }),
      ),
    ).toBe("96.5 vs 97.2 %");
  });

  test("rankFindingRows follows B-F7: |z| capped at 10, confidence, state tiers, registry order", () => {
    const rows = [
      makeRow({ metric: "spo2", state: "insufficient", z: null, confidence: null }),
      makeRow({ metric: "wrist_temp", state: "warming_up", z: null, confidence: null }),
      makeRow({ metric: "sleep_hr", state: "computed", z: 12.0, confidence: "medium" }),
      makeRow({ metric: "rhr", state: "computed", z: 10.5, confidence: "high" }),
      makeRow({ metric: "hrv_sdnn", state: "computed", z: -3.2, confidence: "low" }),
    ];

    const ranked = rankFindingRows(rows).map((r) => r.metric);
    expect(ranked).toEqual([
      "rhr", // |z| capped at 10, high confidence beats medium
      "sleep_hr", // |z| capped at 10, medium confidence
      "hrv_sdnn", // |z| = 3.2
      "wrist_temp", // warming_up tier
      "spo2", // insufficient tier
    ]);
  });

  test("isAllWithin and isNotableDaytime reflect §4/B-F7 gating", () => {
    const withinOvernight = [makeRow({ metric: "sleep_h" }), makeRow({ metric: "rhr" })];
    const withinDay = makeRow({ metric: "active_kj", kind: "daytime", severity: "within" });
    const notableDay = makeRow({ metric: "steps", kind: "daytime", severity: "notable" });

    expect(isNotableDaytime(withinDay)).toBe(false);
    expect(isNotableDaytime(notableDay)).toBe(true);
    expect(isAllWithin(withinOvernight, [withinDay])).toBe(true);
    expect(isAllWithin(withinOvernight, [notableDay])).toBe(false);
    expect(isAllWithin([makeRow({ metric: "wrist_temp", state: "warming_up" })], [])).toBe(false);
    expect(isAllWithin([], [])).toBe(false);
  });

  test("flaggedChecksFor returns only flagged checks", () => {
    const row = makeRow({
      checks: [
        { key: "device_change", flagged: false },
        { key: "partial_nights", flagged: true, day: "2026-03-01" },
      ],
    });
    expect(flaggedChecksFor(row)).toEqual([
      { key: "partial_nights", flagged: true, day: "2026-03-01" },
    ]);
  });

  test("buildSparklineGeometry computes band, breaks at null gaps, and clips >=10 sigma points", () => {
    const points = [
      { day: "2026-02-20", value: 50, z: 0, usable: true },
      { day: "2026-02-21", value: null, z: null, usable: false },
      { day: "2026-02-22", value: 52, z: 0.4, usable: false },
      { day: "2026-02-23", value: 120, z: 11.5, usable: true },
    ];
    const geo = buildSparklineGeometry(points, 48, 56, 88, 24);
    expect(geo.bandRect).not.toBeNull();
    expect(geo.hasClipped).toBe(true);
    expect(geo.points).toHaveLength(3);
    expect(geo.points[1]?.usable).toBe(false);
    expect(geo.points[2]?.clipped).toBe("high");
    expect(geo.points[2]?.y).toBe(3); // clamped to top padding
    expect(geo.recentSegments).toHaveLength(1); // split at index 1 null gap leaves M..L segment over indices 2..3
  });
});
