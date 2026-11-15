import { describe, expect, test } from "bun:test";
import {
  ALERT_ABS_Z,
  detectBoundaries,
  dispersionForZ,
  median,
  NOTABLE_ABS_Z,
  robustZ,
  scaledMAD,
  severityOf,
} from "./stats";

describe("median, MAD and bounded z", () => {
  test("median supports odd and even unsorted input", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  test("scaled MAD is the median absolute deviation times 1.4826", () => {
    expect(scaledMAD([1, 2, 3, 4], 2.5)).toBe(median([1.5, 0.5, 0.5, 1.5]) * 1.4826);
  });
  test("B-F4 flat resp baseline uses its registry floor and caps z", () => {
    expect(dispersionForZ(Array(28).fill(12), 0.5)).toBe(0.5);
    const result = robustZ(Array(28).fill(12), Array(7).fill(20), 0.5);
    expect(result?.dispersion).toBe(0.5);
    expect(result?.z).toBe(10);
    expect(severityOf(result?.z ?? null)).toBe("alert");
    expect(severityOf(1.4)).toBe("within");
    expect(severityOf(-NOTABLE_ABS_Z)).toBe("notable");
    expect(severityOf(ALERT_ABS_Z)).toBe("alert");
  });
});

describe("detectBoundaries", () => {
  const span = (sourceName: string, firstDay: string, lastDay: string) => ({
    sourceName,
    firstDay,
    lastDay,
    sampleCount: 10,
  });
  test("overlap becomes a switch", () => {
    const out = detectBoundaries(
      "wrist_temp",
      [span("WatchA", "2026-01-10", "2026-10-05"), span("WatchB", "2026-10-05", "2026-11-07")],
      "2026-11-07",
    );
    expect(out.map((item) => item.kind)).toEqual(["switch"]);
    expect(out[0]?.counterpartSource).toBe("WatchA");
  });
  test("a hole reports its uncovered day count", () => {
    const out = detectBoundaries(
      "rhr",
      [span("WatchA", "2026-08-10", "2026-09-01"), span("WatchB", "2026-09-05", "2026-11-07")],
      "2026-11-07",
    );
    expect(out.find((item) => item.kind === "gap")?.gapDays).toBe(3);
  });
});
