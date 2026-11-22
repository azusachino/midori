import type { FindingRowDTO } from "../api/types";
import { isFractionPercent } from "./finding-format";

/**
 * Geometry for the Apple Vitals-style horizontal range gauge (v3 plan §5).
 *
 * The usual band `[baselineLow, baselineHigh]` always occupies the middle
 * `30%..70%` of the track, with `baselineMedian` pinned at `50%`, so gauges stay
 * comparable row to row. The recent-median dot moves relative to that fixed band
 * and is clamped inside `[PAD_PCT, 100 - PAD_PCT]`, so an extreme `|z| >= 10`
 * reading never squashes the band or produces non-finite coordinates.
 */

const BAND_START_PCT = 30;
const BAND_END_PCT = 70;
const BAND_MID_PCT = 50;
/** Keeps the dot fully on the track even with a degenerate (zero-width) band. */
const PAD_PCT = 4;

export interface RangeGaugeGeometry {
  bandLeftPct: number;
  bandWidthPct: number;
  medianPct: number;
  dotPct: number;
  inBand: boolean;
}

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildRangeGaugeGeometry(row: FindingRowDTO): RangeGaugeGeometry | null {
  if (row.state !== "computed") return null;
  const { recentMedian, baselineMedian, baselineLow, baselineHigh } = row;
  if (
    !isFiniteNumber(recentMedian) ||
    !isFiniteNumber(baselineMedian) ||
    !isFiniteNumber(baselineLow) ||
    !isFiniteNumber(baselineHigh)
  ) {
    return null;
  }
  if (isFractionPercent(row.unit, recentMedian, baselineMedian)) return null;

  const low = Math.min(baselineLow, baselineHigh);
  const high = Math.max(baselineLow, baselineHigh);
  // Floor the half-band so a zero-width or inverted band cannot divide by zero.
  const halfBand = Math.max(1e-6, (high - low) / 2);
  const rawDotPct =
    BAND_MID_PCT +
    ((recentMedian - baselineMedian) / halfBand) * ((BAND_END_PCT - BAND_START_PCT) / 2);
  if (!Number.isFinite(rawDotPct)) return null;
  const dotPct = Math.min(100 - PAD_PCT, Math.max(PAD_PCT, rawDotPct));
  return {
    bandLeftPct: BAND_START_PCT,
    bandWidthPct: BAND_END_PCT - BAND_START_PCT,
    medianPct: BAND_MID_PCT,
    dotPct: round2(dotPct),
    inBand: recentMedian >= low && recentMedian <= high,
  };
}
