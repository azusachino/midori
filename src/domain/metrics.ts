import type { TrustLabel } from "./types";

/**
 * Metric registry + trust labels (T4). Keys align with the spike's readout.
 * Trust grades summarize the 2025–2026 accuracy literature:
 * steps/HR high, HRV moderate (nightly SDNN/RMSSD trends only), energy low
 * across all brands. Wrist temperature is a trend metric, not absolute.
 */

export interface MetricSpec {
  key: string;
  /** HK type identifiers aggregated into this metric. */
  types: readonly string[];
  unit: string;
  method: "median" | "sum";
  trust: TrustLabel;
  trustNote: string;
  /** true = only 21:00–09:00 local samples count (HRV). */
  nightOnly: boolean;
}

export const METRICS: Readonly<Record<string, MetricSpec>> = {
  steps: {
    key: "steps",
    types: ["HKQuantityTypeIdentifierStepCount"],
    unit: "count",
    method: "sum",
    trust: "high",
    trustNote: "Step counts are accurate at walking paces.",
    nightOnly: false,
  },
  rhr: {
    key: "rhr",
    types: ["HKQuantityTypeIdentifierRestingHeartRate"],
    unit: "count/min",
    method: "median",
    trust: "high",
    trustNote: "Resting HR accurate at rest; less so during movement.",
    nightOnly: false,
  },
  heart_rate: {
    key: "heart_rate",
    types: ["HKQuantityTypeIdentifierHeartRate"],
    unit: "count/min",
    method: "median",
    trust: "high",
    trustNote: "Instantaneous HR accurate at rest; noisy during exercise.",
    nightOnly: false,
  },
  hrv_sdnn: {
    key: "hrv_sdnn",
    types: ["HKQuantityTypeIdentifierHeartRateVariabilitySDNN"],
    unit: "ms",
    method: "median",
    trust: "moderate",
    trustNote: "Use as a nightly trend, not an absolute value.",
    nightOnly: true,
  },
  hrv_rmssd: {
    key: "hrv_rmssd",
    types: ["HKQuantityTypeIdentifierHeartRateVariabilityRMSSD"],
    unit: "ms",
    method: "median",
    trust: "moderate",
    trustNote: "Use as a nightly trend, not an absolute value.",
    nightOnly: true,
  },
  wrist_temp: {
    key: "wrist_temp",
    types: ["HKQuantityTypeIdentifierAppleSleepingWristTemperature"],
    unit: "degC",
    method: "median",
    trust: "moderate",
    trustNote: "Trend-only metric; absolute offset differs per device.",
    nightOnly: true,
  },
  sleep_h: {
    key: "sleep_h",
    types: ["HKCategoryTypeIdentifierSleepAnalysis"],
    unit: "h",
    method: "sum",
    trust: "moderate",
    trustNote: "Stages are estimates; totals are closer than stages.",
    nightOnly: false,
  },
  deep_h: {
    key: "deep_h",
    types: ["HKCategoryTypeIdentifierSleepAnalysis"],
    unit: "h",
    method: "sum",
    trust: "moderate",
    trustNote: "Deep sleep estimation is the least reliable stage.",
    nightOnly: false,
  },
  rem_h: {
    key: "rem_h",
    types: ["HKCategoryTypeIdentifierSleepAnalysis"],
    unit: "h",
    method: "sum",
    trust: "moderate",
    trustNote: "REM estimation is moderate-reliability.",
    nightOnly: false,
  },
  resp_rate: {
    key: "resp_rate",
    types: ["HKQuantityTypeIdentifierRespiratoryRate"],
    unit: "count/min",
    method: "median",
    trust: "moderate",
    trustNote: "Overnight respiratory rate is a trend metric.",
    nightOnly: true,
  },
  spo2: {
    key: "spo2",
    types: ["HKQuantityTypeIdentifierOxygenSaturation"],
    unit: "%",
    method: "median",
    trust: "moderate",
    trustNote: "Spot checks, not medical-grade oximetry.",
    nightOnly: false,
  },
  vo2max: {
    key: "vo2max",
    types: ["HKQuantityTypeIdentifierVO2Max"],
    unit: "ml/(kg·min)",
    method: "median",
    trust: "moderate",
    trustNote: "Estimate varies with workout mix.",
    nightOnly: false,
  },
  active_kj: {
    key: "active_kj",
    types: ["HKQuantityTypeIdentifierActiveEnergyBurned"],
    unit: "kJ",
    method: "sum",
    trust: "low",
    trustNote: "Energy expenditure is inaccurate across all wearable brands.",
    nightOnly: false,
  },
};

export function trustFor(key: string): { label: TrustLabel; note: string } {
  const spec = METRICS[key];
  if (spec) return { label: spec.trust, note: spec.trustNote };
  return { label: "moderate", note: "Unreviewed metric; treat trends with caution." };
}
