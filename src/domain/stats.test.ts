import { describe, expect, test } from "bun:test";
import {
  ALERT_ABS_Z,
  BASELINE_MAX_OFFSET_DAYS,
  BASELINE_MIN_OFFSET_DAYS,
  baselineOffsets,
  detectBoundaries,
  dispersionForZ,
  MIN_BASELINE_DAYS,
  MIN_RECENT_DAYS,
  median,
  NOTABLE_ABS_Z,
  offsetsInclusive,
  RECENT_MAX_OFFSET_DAYS,
  RECENT_MIN_OFFSET_DAYS,
  recentOffsets,
  robustZ,
  scaledMAD,
  severityOf,
} from "./stats";

describe("window contracts", () => {
  test("baseline window is anchor-90..anchor-29 inclusive (62 days)", () => {
    expect(BASELINE_MIN_OFFSET_DAYS).toBe(-90);
    expect(BASELINE_MAX_OFFSET_DAYS).toBe(-29);
    expect(baselineOffsets()).toHaveLength(62);
    expect(offsetsInclusive(-90, -29)[0]).toBe(-90);
    expect(baselineOffsets().at(-1)).toBe(-29);
  });

  test("recent window is anchor-13..anchor inclusive (14 days)", () => {
    expect(RECENT_MIN_OFFSET_DAYS).toBe(-13);
    expect(RECENT_MAX_OFFSET_DAYS).toBe(0);
    expect(recentOffsets()).toHaveLength(14);
  });

  test("gates and severity bands are the pinned constants", () => {
    expect(MIN_BASELINE_DAYS).toBe(15);
    expect(MIN_RECENT_DAYS).toBe(7);
    expect(NOTABLE_ABS_Z).toBe(1.5);
    expect(ALERT_ABS_Z).toBe(2.5);
  });
});

describe("median and MAD", () => {
  test("median: odd, even, unsorted", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5, 5, 5, 5])).toBe(5);
  });

  test("scaledMAD = median(|x-med|) * 1.4826", () => {
    expect(scaledMAD([1, 2, 3, 4], 2.5)).toBe(median([1.5, 0.5, 0.5, 1.5]) * 1.4826);
  });
});

describe("zero-MAD policy (ported from spike analyze.py:110-113)", () => {
  test("normal dispersion uses scaled MAD", () => {
    const b = [1, 2, 3, 4, 5, 6, 7, 8];
    const med = median(b);
    expect(dispersionForZ(b)).toBeCloseTo(scaledMAD(b, med), 12);
  });

  test("flat baseline with nonzero diff collapses to epsilon => alert-scale z", () => {
    const flat = [5, 5, 5, 5, 5];
    expect(dispersionForZ(flat)).toBe(1e-9);
    const r = robustZ([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], [6, 6, 6, 6, 6, 6, 6]);
    if (r === null) throw new Error("gates should pass");
    expect(r.dispersion).toBe(1e-9);
    expect(r.z).toBeGreaterThan(ALERT_ABS_Z);
    expect(severityOf(r.z)).toBe("alert");
  });

  test("near-flat baseline (MAD < 1e-9 after scaling) falls back to range/4", () => {
    // med 10, deviations [0,1e-12,...] -> scaledMAD < 1e-9, range = 8 -> 2
    const b = [6, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 14];
    expect(dispersionForZ(b)).toBeCloseTo(8 / 4, 12);
  });
});

describe("robustZ gates", () => {
  test("insufficient baseline days -> null", () => {
    const baseline = Array<number>(14).fill(5); // 14 < 15
    const recent = Array<number>(7).fill(6);
    expect(robustZ(baseline, recent)).toBeNull();
  });

  test("insufficient recent days -> null", () => {
    const baseline = Array<number>(15).fill(5);
    const recent = Array<number>(6).fill(6); // 6 < 7
    expect(robustZ(baseline, recent)).toBeNull();
  });

  test("exact gate boundaries pass and z is (rec - base) / dispersion", () => {
    const baseline = Array<number>(15).fill(70);
    const recent = Array<number>(7).fill(73.5);
    const r = robustZ(baseline, recent);
    if (r === null) throw new Error("gates should pass");
    expect(r.baselineMedian).toBe(70);
    expect(r.recentMedian).toBe(73.5);
    expect(r.z).toBeCloseTo(3.5 / 1e-9, -4); // flat baseline epsilon
    expect(severityOf(1.4)).toBe("info");
    expect(severityOf(-1.5)).toBe("notable");
    expect(severityOf(2.5)).toBe("alert");
    expect(severityOf(null)).toBe("info");
  });
});

describe("detectBoundaries", () => {
  const A = (firstDay: string, lastDay: string) => ({
    sourceName: "WatchA",
    firstDay,
    lastDay,
    sampleCount: 10,
  });
  const B = (firstDay: string, lastDay: string) => ({
    sourceName: "WatchB",
    firstDay,
    lastDay,
    sampleCount: 10,
  });

  test("spike scenario: overlap => switch with counterpart", () => {
    // WatchA has data since long before the -90d window (spike reality: since 2024)
    const out = detectBoundaries(
      "wrist_temp",
      [A("2026-01-10", "2026-10-05"), B("2026-10-05", "2026-11-07")],
      "2026-11-07",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("switch");
    expect(out[0]?.sourceName).toBe("WatchB");
    expect(out[0]?.counterpartSource).toBe("WatchA");
    expect(out[0]?.boundaryDay).toBe("2026-10-05");
    expect(out[0]?.metric).toBe("wrist_temp");
  });

  test("hole between spans => gap with day count", () => {
    const out = detectBoundaries(
      "wrist_temp",
      [A("2026-08-10", "2026-09-01"), B("2026-09-05", "2026-11-07")],
      "2026-11-07",
    );
    const gap = out.find((b) => b.kind === "gap");
    expect(gap?.gapDays).toBe(3);
    expect(gap?.counterpartSource).toBe("WatchA");
  });

  test("first span inside window => series_start", () => {
    const out = detectBoundaries("hrv_rmssd", [B("2026-10-10", "2026-11-07")], "2026-11-07");
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("series_start");
    expect(out[0]?.counterpartSource).toBeNull();
  });

  test("pre-window single span produces no boundary", () => {
    const out = detectBoundaries("rhr", [A("2026-01-01", "2026-03-01")], "2026-11-07");
    expect(out).toHaveLength(0);
  });
});
