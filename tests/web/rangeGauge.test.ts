import { describe, expect, test } from "bun:test";
import type { FindingRowDTO } from "../../web/src/api/types";
import { buildRangeGaugeGeometry } from "../../web/src/lib/range-gauge";

function makeRow(overrides: Partial<FindingRowDTO>): FindingRowDTO {
  return {
    metric: "sleep_hr",
    kind: "overnight",
    unit: "count/min",
    trust: "moderate",
    trustNote: "Synthetic trust note.",
    epochId: 1,
    epochLabel: "Synthetic Watch",
    state: "computed",
    direction: "within",
    severity: "within",
    confidence: "high",
    z: 0,
    recentMedian: 55,
    baselineMedian: 55,
    baselineLow: 52,
    baselineHigh: 58,
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

describe("RangeGauge geometry (v3 plan §5 / M3)", () => {
  test("maps the usual band to the fixed middle 30%..70% with the median at 50%", () => {
    const geometry = buildRangeGaugeGeometry(
      makeRow({ recentMedian: 56, baselineMedian: 55, baselineLow: 52, baselineHigh: 58 }),
    );
    expect(geometry).not.toBeNull();
    expect(geometry?.bandLeftPct).toBe(30);
    expect(geometry?.bandWidthPct).toBe(40);
    expect(geometry?.medianPct).toBe(50);
    // half band = 3 -> 50 + (1 / 3) * 20 = 56.67
    expect(geometry?.dotPct).toBeCloseTo(56.67, 2);
    expect(geometry?.inBand).toBe(true);
  });

  test("the recent median sits exactly at 50% when it equals the baseline median", () => {
    expect(buildRangeGaugeGeometry(makeRow({ recentMedian: 55 }))?.dotPct).toBe(50);
  });

  test("clamps extreme |z| >= 10 readings into the track without squashing the band", () => {
    const high = buildRangeGaugeGeometry(
      makeRow({ recentMedian: 82, baselineMedian: 50, baselineLow: 44, baselineHigh: 56 }),
    );
    expect(high?.dotPct).toBe(96);
    expect(high?.inBand).toBe(false);
    expect(high?.bandWidthPct).toBe(40);

    const low = buildRangeGaugeGeometry(
      makeRow({ recentMedian: 10, baselineMedian: 50, baselineLow: 44, baselineHigh: 56 }),
    );
    expect(low?.dotPct).toBe(4);
  });

  test("a zero-width band cannot divide by zero or emit NaN", () => {
    const flat = buildRangeGaugeGeometry(
      makeRow({ recentMedian: 55, baselineMedian: 55, baselineLow: 55, baselineHigh: 55 }),
    );
    expect(flat?.dotPct).toBe(50);
    const moved = buildRangeGaugeGeometry(
      makeRow({ recentMedian: 56, baselineMedian: 55, baselineLow: 55, baselineHigh: 55 }),
    );
    expect(moved?.dotPct).toBe(96);
    expect(Number.isFinite(moved?.dotPct ?? Number.NaN)).toBe(true);
    const inverted = buildRangeGaugeGeometry(
      makeRow({ recentMedian: 55, baselineMedian: 55, baselineLow: 58, baselineHigh: 52 }),
    );
    expect(inverted?.dotPct).toBe(50);
  });

  test("returns null for non-computed rows, missing band values and fraction '%' readings", () => {
    expect(buildRangeGaugeGeometry(makeRow({ state: "warming_up" }))).toBeNull();
    expect(buildRangeGaugeGeometry(makeRow({ state: "insufficient" }))).toBeNull();
    expect(buildRangeGaugeGeometry(makeRow({ recentMedian: null }))).toBeNull();
    expect(buildRangeGaugeGeometry(makeRow({ baselineMedian: null }))).toBeNull();
    expect(buildRangeGaugeGeometry(makeRow({ baselineLow: null }))).toBeNull();
    expect(buildRangeGaugeGeometry(makeRow({ baselineHigh: null }))).toBeNull();
    expect(
      buildRangeGaugeGeometry(
        makeRow({ metric: "spo2", unit: "%", recentMedian: 0.97, baselineMedian: 0.98 }),
      ),
    ).toBeNull();
  });

  test("returns null instead of NaN when values are non-finite", () => {
    expect(buildRangeGaugeGeometry(makeRow({ recentMedian: Number.NaN }))).toBeNull();
    expect(buildRangeGaugeGeometry(makeRow({ baselineHigh: Number.POSITIVE_INFINITY }))).toBeNull();
  });
});
