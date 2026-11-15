import { METRICS } from "@midori/domain/metrics";
import type { MetricKind } from "../api/types";

/**
 * Canonical metric ordering and kind classification (docs/journeys.md §2, ui-design §6).
 */
export const OVERNIGHT_ORDER = [
  "sleep_h",
  "deep_h",
  "rem_h",
  "sleep_hr",
  "hrv_sdnn",
  "hrv_rmssd",
  "rhr",
  "resp_rate",
  "wrist_temp",
  "spo2",
] as const;

export const DAYTIME_ORDER = ["steps", "active_kj", "heart_rate"] as const;
export const TREND_ONLY_ORDER = ["vo2max"] as const;

export function metricKindFor(key: string): MetricKind {
  if ((OVERNIGHT_ORDER as readonly string[]).includes(key)) return "overnight";
  if ((DAYTIME_ORDER as readonly string[]).includes(key)) return "daytime";
  return "trendOnly";
}

export function isKnownMetric(key: string): boolean {
  return key in METRICS || (OVERNIGHT_ORDER as readonly string[]).includes(key);
}
