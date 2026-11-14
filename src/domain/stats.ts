import type { CoverageBoundary, SourceSpan } from "./types";

/**
 * Stats contracts (T4). Semantics ported from the 2026-11 spike (analyze.py),
 * with the baseline off-by-one fixed: the spike's range(29,90) covered -89..-29
 * while its comment claimed -90..-29; here the contract is anchor-90..anchor-29
 * INCLUSIVE (62 days), recent is anchor-13..anchor INCLUSIVE (14 days).
 */

export const BASELINE_MIN_OFFSET_DAYS = -90; // inclusive
export const BASELINE_MAX_OFFSET_DAYS = -29; // inclusive
export const RECENT_MIN_OFFSET_DAYS = -13; // inclusive
export const RECENT_MAX_OFFSET_DAYS = 0; // anchor itself inclusive

export const MIN_BASELINE_DAYS = 15;
export const MIN_RECENT_DAYS = 7;

export const NOTABLE_ABS_Z = 1.5;
export const ALERT_ABS_Z = 2.5;

export const MAD_SCALE = 1.4826;
export const ZERO_MAD_EPSILON = 1e-9;

/** Day offsets [min..max], both inclusive. Length must be max-min+1. */
export function offsetsInclusive(min: number, max: number): number[] {
  const out: number[] = [];
  for (let i = min; i <= max; i++) out.push(i);
  return out;
}

export function baselineOffsets(): number[] {
  return offsetsInclusive(BASELINE_MIN_OFFSET_DAYS, BASELINE_MAX_OFFSET_DAYS);
}

export function recentOffsets(): number[] {
  return offsetsInclusive(RECENT_MIN_OFFSET_DAYS, RECENT_MAX_OFFSET_DAYS);
}

export function median(xs: number[]): number {
  if (xs.length === 0) throw new Error("median of empty array");
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const hi = s[mid];
  const lo = s[mid - 1];
  if (hi === undefined) throw new Error("median index out of range");
  return s.length % 2 === 1 ? hi : lo === undefined ? hi : (lo + hi) / 2;
}

/** median(|x - med|) * 1.4826 — robust sigma estimate. */
export function scaledMAD(xs: number[], med: number): number {
  return median(xs.map((x) => Math.abs(x - med))) * MAD_SCALE;
}

/**
 * Dispersion used as the z denominator, port of analyze.py:110-113:
 *   mad = scaledMAD(baseline)
 *   if mad < 1e-9: mad = (max - min) / 4 or 1e-9
 * A perfectly flat baseline therefore yields 1e-9, making any nonzero recent
 * shift an alert — pinned deliberately (the spike's behavior).
 */
export function dispersionForZ(baseline: number[]): number {
  const med = median(baseline);
  let mad = scaledMAD(baseline, med);
  if (mad < ZERO_MAD_EPSILON) {
    const range = Math.max(...baseline) - Math.min(...baseline);
    mad = range / 4 || ZERO_MAD_EPSILON;
  }
  return mad;
}

export interface ZResult {
  z: number;
  baselineMedian: number;
  recentMedian: number;
  dispersion: number;
  nBaseline: number;
  nRecent: number;
}

/**
 * Robust z of recent vs baseline. Returns null when the gates fail
 * (fewer than MIN_BASELINE_DAYS baseline values or MIN_RECENT_DAYS recent values).
 */
export function robustZ(baseline: number[], recent: number[]): ZResult | null {
  if (baseline.length < MIN_BASELINE_DAYS || recent.length < MIN_RECENT_DAYS) return null;
  const baselineMedian = median(baseline);
  const recentMedian = median(recent);
  const dispersion = dispersionForZ(baseline);
  return {
    z: (recentMedian - baselineMedian) / dispersion,
    baselineMedian,
    recentMedian,
    dispersion,
    nBaseline: baseline.length,
    nRecent: recent.length,
  };
}

export function severityOf(z: number | null): "info" | "notable" | "alert" {
  if (z === null) return "info";
  if (Math.abs(z) >= ALERT_ABS_Z) return "alert";
  if (Math.abs(z) >= NOTABLE_ABS_Z) return "notable";
  return "info";
}

const DAY_MS = 86_400_000;

export function parseDay(day: string): number {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`bad day: ${day}`);
  return t;
}

export function formatDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Coverage boundaries from per-source spans (one metric's sources), earliest first.
 * Semantics (from the spike's source-check lesson):
 *  - spans within the same 62-day analysis window only; earlier spans are context
 *  - first span whose start is inside the window => series_start (new metric or
 *    first data; baseline impossible => suppress z)
 *  - next span overlapping or abutting the previous (startDay <= prevEnd + 1)
 *    => switch (recalibration; cross-source z suppressed, per-source baselines kept)
 *  - next span after a hole of >= 1 day => gap (coverage finding; z suppressed
 *    across the hole)
 */
export function detectBoundaries(
  metric: string,
  spans: SourceSpan[],
  anchorDay: string,
  windowMinOffsetDays = BASELINE_MIN_OFFSET_DAYS,
): CoverageBoundary[] {
  const windowStart = parseDay(anchorDay) + windowMinOffsetDays * DAY_MS;
  const sorted = [...spans].sort((a, b) => parseDay(a.firstDay) - parseDay(b.firstDay));
  const out: CoverageBoundary[] = [];
  let prev: SourceSpan | null = null;
  for (const span of sorted) {
    const start = parseDay(span.firstDay);
    if (prev === null) {
      if (start >= windowStart) {
        out.push({
          kind: "series_start",
          metric,
          sourceName: span.sourceName,
          counterpartSource: null,
          boundaryDay: span.firstDay,
          gapDays: null,
        });
      }
    } else {
      const prevEnd = parseDay(prev.lastDay);
      if (start <= prevEnd + DAY_MS) {
        out.push({
          kind: "switch",
          metric,
          sourceName: span.sourceName,
          counterpartSource: prev.sourceName,
          boundaryDay: span.firstDay,
          gapDays: null,
        });
      } else {
        out.push({
          kind: "gap",
          metric,
          sourceName: span.sourceName,
          counterpartSource: prev.sourceName,
          boundaryDay: span.firstDay,
          gapDays: Math.round((start - prevEnd) / DAY_MS) - 1,
        });
      }
    }
    if (prev === null || parseDay(span.lastDay) > parseDay(prev.lastDay)) {
      prev = span;
    }
  }
  return out;
}
