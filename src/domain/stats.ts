import type { CoverageBoundary, SourceSpan } from "./types";

/** Shared robust-statistics helpers; current windows are ordinal in baselines.ts. */

export const BASELINE_MIN_OFFSET_DAYS = -90; // inclusive
export const BASELINE_MAX_OFFSET_DAYS = -29; // inclusive
export const RECENT_MIN_OFFSET_DAYS = -13; // inclusive
export const RECENT_MAX_OFFSET_DAYS = 0; // anchor itself inclusive

export const NOTABLE_ABS_Z = 1.5;
export const ALERT_ABS_Z = 2.5;
/** B-F12: within rows at or past this |z| are "close to the edge" on Changes (display only). */
export const LEANING_ABS_Z = 1.0;
export const LEANING_MAX_ROWS = 3;

export const MAD_SCALE = 1.4826;
export const MAX_ABS_Z = 10;

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

/** Robust sigma is bounded below by the metric registry's measurement floor. */
export function dispersionForZ(baseline: number[], floor: number): number {
  return Math.max(scaledMAD(baseline, median(baseline)), floor);
}

export interface ZResult {
  z: number;
  baselineMedian: number;
  recentMedian: number;
  dispersion: number;
  nBaseline: number;
  nRecent: number;
}

/** Robust z from already-gated ordinal windows, capped for display and ranking. */
export function robustZ(baseline: number[], recent: number[], floor: number): ZResult | null {
  if (baseline.length === 0 || recent.length === 0) return null;
  const baselineMedian = median(baseline);
  const recentMedian = median(recent);
  const dispersion = dispersionForZ(baseline, floor);
  return {
    z: Math.max(-MAX_ABS_Z, Math.min(MAX_ABS_Z, (recentMedian - baselineMedian) / dispersion)),
    baselineMedian,
    recentMedian,
    dispersion,
    nBaseline: baseline.length,
    nRecent: recent.length,
  };
}

export function severityOf(z: number | null): "within" | "notable" | "alert" {
  if (z === null) return "within";
  if (Math.abs(z) >= ALERT_ABS_Z) return "alert";
  if (Math.abs(z) >= NOTABLE_ABS_Z) return "notable";
  return "within";
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
