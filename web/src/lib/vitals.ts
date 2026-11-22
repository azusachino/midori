import type { FindingRowDTO } from "../api/types";
import { displayUnit, formatMetricNumber, isFractionPercent } from "./finding-format";

/**
 * The six core Apple Vitals metrics shown in the Changes bento, in a fixed order so
 * the grid reads the same on every load regardless of how the server ranked rows.
 */
export const VITALS_BENTO_ORDER = [
  "sleep_h",
  "rhr",
  "hrv_sdnn",
  "wrist_temp",
  "resp_rate",
  "spo2",
] as const;

export type VitalStatus = "within" | "higher" | "lower" | "learning" | "noRecent";

export interface VitalReading {
  /** Numeric part, already rounded by the shared metric formatter. */
  value: string;
  /** Unit suffix shown muted beside the numeral, empty for bare counts. */
  unit: string;
}

function isVitalMetric(metric: string): boolean {
  return (VITALS_BENTO_ORDER as readonly string[]).includes(metric);
}

/**
 * Picks the vitals rows present in `changes.overnight` in the fixed bento order.
 * Metrics missing from the read are simply skipped; unknown metrics never appear.
 */
export function selectVitalRows(rows: readonly FindingRowDTO[]): FindingRowDTO[] {
  const byMetric = new Map<string, FindingRowDTO>();
  for (const row of rows) {
    if (isVitalMetric(row.metric) && !byMetric.has(row.metric)) {
      byMetric.set(row.metric, row);
    }
  }
  return VITALS_BENTO_ORDER.flatMap((metric) => {
    const row = byMetric.get(metric);
    return row ? [row] : [];
  });
}

/**
 * Splits a reading into an oversized numeral and a muted unit suffix, applying the
 * same pre-9c fraction-`%` guard as the rest of the UI: a 0–1 artifact renders as
 * no numeral rather than as a physiological value.
 */
export function splitVitalReading(row: FindingRowDTO): VitalReading | null {
  if (row.recentMedian === null) return null;
  if (isFractionPercent(row.unit, row.recentMedian, row.baselineMedian)) return null;
  return {
    value: formatMetricNumber(row.recentMedian, row.metric, row.unit),
    unit: displayUnit(row.metric, row.unit),
  };
}

/** Compact tile status: direction when computed, otherwise learning / no recent. */
export function vitalStatus(row: FindingRowDTO): VitalStatus {
  if (row.state === "stale") return "noRecent";
  if (row.state !== "computed") return "learning";
  if (row.direction === "higher" || row.direction === "lower") return row.direction;
  return "within";
}
