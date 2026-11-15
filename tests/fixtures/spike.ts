/**
 * Synthetic regression fixture: source A and source B have different values in separate
 * windows. A correct engine avoids computing a cross-source z-score.
 *
 * Windows are relative to the fixed ANCHOR (the source's last data day in the full design):
 *   baseline: ANCHOR-90 .. ANCHOR-29 inclusive (62 days, source A only)
 *   recent:   ANCHOR-13 .. ANCHOR inclusive   (14 days, source B only)
 * Synthetic only. Values are deterministic offsets around the centre.
 */
import {
  addDays,
  buildFixture,
  type ExportSpec,
  type Fixture,
  type RecordSpec,
  seeded,
  TYPE,
} from "./model";

export const SPIKE_ANCHOR = "2026-03-01";
export const SOURCE_A = "Synthetic Watch A";
export const SOURCE_B = "Synthetic Watch B";
export const SPIKE_EXPORT_DATE = "2026-03-02 08:00:00 +0900";

export const BASELINE_CENTRE = 34.0;
export const RECENT_CENTRE = 36.0;

/** Jitter in [-0.2, +0.2], two decimals, from a fixed seed. */
function jitter(rand: () => number): string {
  const steps = Math.round(rand() * 40) - 20; // -20..20
  const v = steps / 100;
  return v.toFixed(2);
}

function centreValue(centre: number, jit: string): string {
  return (centre + Number(jit)).toFixed(2);
}

export const SPIKE_WINDOWS = {
  baselineStart: addDays(SPIKE_ANCHOR, -90),
  baselineEnd: addDays(SPIKE_ANCHOR, -29),
  recentStart: addDays(SPIKE_ANCHOR, -13),
  recentEnd: SPIKE_ANCHOR,
} as const;

function tempRecord(source: string, day: string, value: string): RecordSpec {
  const start = `${day} 03:00:00 +0900`;
  return {
    type: TYPE.wristTemp,
    sourceName: source,
    unit: "degC",
    startDate: start,
    endDate: start,
    value,
  };
}

export function spikeSpec(): ExportSpec {
  const rand = seeded(12345);
  const records: RecordSpec[] = [];
  for (let day = SPIKE_WINDOWS.baselineStart; day <= SPIKE_WINDOWS.baselineEnd; ) {
    records.push(tempRecord(SOURCE_A, day, centreValue(BASELINE_CENTRE, jitter(rand))));
    day = addDays(day, 1);
  }
  for (let day = SPIKE_WINDOWS.recentStart; day <= SPIKE_WINDOWS.recentEnd; ) {
    records.push(tempRecord(SOURCE_B, day, centreValue(RECENT_CENTRE, jitter(rand))));
    day = addDays(day, 1);
  }
  return { exportDate: SPIKE_EXPORT_DATE, records, workouts: [] };
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const lo = s[mid - 1];
  const hi = s[mid];
  if (s.length === 0 || hi === undefined) throw new Error("median of empty series");
  return s.length % 2 === 0 && lo !== undefined ? (lo + hi) / 2 : hi;
}

const spikeFull = buildFixture("spike", spikeSpec(), {});
const baselineVals = spikeFull.expected.records
  .filter((r) => r.sourceName === SOURCE_A)
  .map((r) => r.valueNumeric ?? NaN);
const recentVals = spikeFull.expected.records
  .filter((r) => r.sourceName === SOURCE_B)
  .map((r) => r.valueNumeric ?? NaN);

export const spike: Fixture = {
  ...spikeFull,
  expected: {
    ...spikeFull.expected,
    facts: {
      anchor: SPIKE_ANCHOR,
      baselineStart: SPIKE_WINDOWS.baselineStart,
      baselineEnd: SPIKE_WINDOWS.baselineEnd,
      recentStart: SPIKE_WINDOWS.recentStart,
      recentEnd: SPIKE_WINDOWS.recentEnd,
      sourceA: SOURCE_A,
      sourceB: SOURCE_B,
      baselineDays: baselineVals.length,
      recentDays: recentVals.length,
      // Source A last data day is ANCHOR-29; source B last data day is ANCHOR.
      sourceALastDay: SPIKE_WINDOWS.baselineEnd,
      sourceBLastDay: SPIKE_ANCHOR,
      baselineMedian: median(baselineVals).toFixed(2),
      recentMedian: median(recentVals).toFixed(2),
    },
  },
};
