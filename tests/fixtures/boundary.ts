/**
 * Boundary corpus: records at the exact night-rule and HRV-window edges (local time), plus a
 * cross-midnight sleep-stage pair that must land in one night. Synthetic only.
 *
 * Night rule: start >= 15:00 local -> that date; < 09:00 -> previous date; else nap (excluded).
 * HRV window: 21:00 inclusive through 09:00 exclusive.
 */
import { buildFixture, type ExportSpec, type RecordSpec, SLEEP_VALUE, TYPE } from "./model";

export const BOUNDARY_SOURCE = "Synthetic Watch";
export const BOUNDARY_EXPORT_DATE = "2026-01-20 08:00:00 +0900";

function stage(value: string, start: string, end: string): RecordSpec {
  return { type: TYPE.sleep, sourceName: BOUNDARY_SOURCE, startDate: start, endDate: end, value };
}

function hrv(start: string, value: string): RecordSpec {
  return {
    type: TYPE.hrv,
    sourceName: BOUNDARY_SOURCE,
    unit: "ms",
    startDate: start,
    endDate: start,
    value,
  };
}

export function boundarySpec(): ExportSpec {
  const records: RecordSpec[] = [
    // Sleep starts around the 15:00 edge on 2026-01-10.
    stage(SLEEP_VALUE.core, "2026-01-10 14:59:00 +0900", "2026-01-10 15:20:00 +0900"), // nap
    stage(SLEEP_VALUE.core, "2026-01-10 15:00:00 +0900", "2026-01-10 15:20:00 +0900"), // night 01-10
    // Sleep starts around the 09:00 edge on 2026-01-11.
    stage(SLEEP_VALUE.core, "2026-01-11 08:59:00 +0900", "2026-01-11 09:10:00 +0900"), // night 01-10
    stage(SLEEP_VALUE.core, "2026-01-11 09:00:00 +0900", "2026-01-11 09:10:00 +0900"), // nap
    // Cross-midnight pair: starts 23:55 on 01-12 and 00:05 on 01-13; both are the 01-12 night.
    stage(SLEEP_VALUE.deep, "2026-01-12 23:55:00 +0900", "2026-01-13 00:05:00 +0900"),
    stage(SLEEP_VALUE.rem, "2026-01-13 00:05:00 +0900", "2026-01-13 00:50:00 +0900"),
    // Offset edge: 14:59 local at +0100 is still a nap; 15:00 local at -0500 is a night.
    stage(SLEEP_VALUE.core, "2026-01-14 14:59:00 +0100", "2026-01-14 15:10:00 +0100"),
    stage(SLEEP_VALUE.core, "2026-01-14 15:00:00 -0500", "2026-01-14 15:10:00 -0500"),
    // HRV window edges: 20:59 out, 21:00 in, 08:59 in, 09:00 out.
    hrv("2026-01-12 20:59:00 +0900", "40.1"),
    hrv("2026-01-12 21:00:00 +0900", "41.2"),
    hrv("2026-01-13 08:59:00 +0900", "42.3"),
    hrv("2026-01-13 09:00:00 +0900", "43.4"),
  ];
  return { exportDate: BOUNDARY_EXPORT_DATE, records, workouts: [] };
}

export const boundary = buildFixture("boundary", boundarySpec(), {
  nightOf0110: 2,
  nightOf0112: 2,
  nap: 3,
  hrvInWindow: 2,
  hrvOutWindow: 2,
});
