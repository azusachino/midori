import { describe, expect, test } from "bun:test";
import type { FindingRowDTO } from "../../web/src/api/types";
import {
  selectVitalRows,
  splitVitalReading,
  VITALS_BENTO_ORDER,
  vitalStatus,
} from "../../web/src/lib/vitals";

function makeRow(overrides: Partial<FindingRowDTO>): FindingRowDTO {
  return {
    metric: "rhr",
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
    recentMedian: 56,
    baselineMedian: 56,
    baselineLow: 52,
    baselineHigh: 60,
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

describe("vitals bento", () => {
  test("keeps the fixed bento order regardless of server ranking, and drops non-core metrics", () => {
    const rows = [
      makeRow({ metric: "spo2", unit: "%" }),
      makeRow({ metric: "deep_h", unit: "h" }),
      makeRow({ metric: "rhr" }),
      makeRow({ metric: "sleep_h", unit: "h" }),
      makeRow({ metric: "wrist_temp", unit: "degC" }),
      makeRow({ metric: "resp_rate", unit: "count/min" }),
      makeRow({ metric: "hrv_sdnn", unit: "ms" }),
    ];

    expect(VITALS_BENTO_ORDER).toEqual([
      "sleep_h",
      "rhr",
      "hrv_sdnn",
      "wrist_temp",
      "resp_rate",
      "spo2",
    ]);
    expect(selectVitalRows(rows).map((row) => row.metric)).toEqual([...VITALS_BENTO_ORDER]);
  });

  test("skips metrics missing from the read and keeps the first row per metric", () => {
    const duplicate = makeRow({ metric: "rhr", recentMedian: 61 });
    const rows = [duplicate, makeRow({ metric: "sleep_h", unit: "h" })];

    const picked = selectVitalRows(rows);
    expect(picked.map((row) => row.metric)).toEqual(["sleep_h", "rhr"]);
    expect(picked[1]?.recentMedian).toBe(61);
    expect(selectVitalRows([])).toEqual([]);
  });

  test("splits the oversized numeral from its muted unit suffix", () => {
    expect(splitVitalReading(makeRow({ metric: "rhr", recentMedian: 56 }))).toEqual({
      value: "56",
      unit: "bpm",
    });
    expect(
      splitVitalReading(makeRow({ metric: "wrist_temp", unit: "degC", recentMedian: 36.912 })),
    ).toEqual({ value: "36.91", unit: "°C" });
    expect(
      splitVitalReading(makeRow({ metric: "sleep_h", unit: "h", recentMedian: 7.25 })),
    ).toEqual({ value: "7.3", unit: "h" });
  });

  test("the fraction '%' guard yields no numeral instead of a 0-1 artifact", () => {
    expect(
      splitVitalReading(
        makeRow({ metric: "spo2", unit: "%", recentMedian: 0.97, baselineMedian: 0.98 }),
      ),
    ).toBeNull();
    expect(
      splitVitalReading(
        makeRow({ metric: "spo2", unit: "%", recentMedian: 96.5, baselineMedian: 97.2 }),
      ),
    ).toEqual({ value: "96.5", unit: "%" });
    expect(splitVitalReading(makeRow({ recentMedian: null }))).toBeNull();
  });

  test("status pill maps computed directions, learning and stale states", () => {
    expect(vitalStatus(makeRow({ direction: "within", severity: "within" }))).toBe("within");
    expect(vitalStatus(makeRow({ direction: "higher", severity: "notable" }))).toBe("higher");
    expect(vitalStatus(makeRow({ direction: "lower", severity: "alert" }))).toBe("lower");
    expect(
      vitalStatus(
        makeRow({
          state: "warming_up",
          direction: null,
          severity: "within",
          confidence: null,
          z: null,
          recentMedian: null,
          warmup: { current: 10, target: 14, estimatedReadyDay: "2026-11-18" },
        }),
      ),
    ).toBe("learning");
    expect(
      vitalStatus(
        makeRow({
          state: "insufficient",
          direction: null,
          severity: "within",
          confidence: null,
          z: null,
          recentMedian: null,
        }),
      ),
    ).toBe("learning");
    expect(
      vitalStatus(
        makeRow({
          state: "stale",
          direction: null,
          severity: "within",
          confidence: null,
          z: null,
          recentMedian: null,
        }),
      ),
    ).toBe("noRecent");
  });
});
